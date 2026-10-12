// The message list's scroll container (messages.tsx). column-reverse keeps the view at the bottom
// without measuring (scrollTop 0 is the bottom). Like stock's, it reports its position to the core
// (triggers.channelDimensions), turns automatic acks on for the channel it shows (triggers.automaticAck) and asks for
// more history near either end (ai/LOG.md, 0.4): without a UI nothing else does.

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { automaticAck, channelDimensions } from "../adapter/triggers";

// stock's cap on a fetch's limit (a constant in Discord's constants module, 30 since at least 2026-10)
const MAX_FETCH = 30;

export function createScroller(scroller: HTMLElement, channel: () => Id | null) {
    // more history near either end, as stock's list does: older within 500 px of the top, newer (the ones a fetch of
    // older history truncated) within 500 px of the bottom; two of stock's pages at most 30 messages (its fetch cap),
    // truncating the other end. A channel whose messages don't fill the view never scrolls, so this also runs after
    // each render and resize.
    // While the channel has unreads stock waits until the view is past the oldest loaded message (into the placeholder
    // it draws above them): reading down from the unread line shouldn't pull in history. With no placeholder, that's
    // the top (2 px: at the top scrollTop stops 1 px short here, clientHeight is rounded).
    // Only the end the reader is heading for: a window of short rows can be near both ends at once, and loading one
    // end truncates the other
    function more(channelId: Id) {
        const ms = S.Message.getMessages(channelId);
        if (!ms.ready || ms.loadingMore || !ms.length) return;
        const fromTop = scroller.scrollHeight - scroller.clientHeight + scroller.scrollTop;
        const top = !down && ms.hasMoreBefore && fromTop <= (S.ReadState.getOldestUnreadMessageId(channelId) != null ? 2 : 500);
        if (top || down && ms.hasMoreAfter && -scroller.scrollTop <= 500)
            A.messages.fetchMessages({
                channelId, before: top ? ms.first().id : undefined, after: top ? undefined : ms.last().id,
                limit: Math.min(MAX_FETCH, 2 * A.pages.size("scrollManager.loadMore")), truncate: true
            });
    }

    function report(channelId: Id) {
        const height = scroller.scrollHeight, view = scroller.clientHeight;
        // column-reverse: scrollTop runs from 0 at the bottom to -(height - view) at the top
        const top = scroller.scrollTop > -1 ? height - view : Math.round(height - view + scroller.scrollTop);
        // while the newest messages aren't loaded (a fetch of older ones truncated them) the bottom isn't the present:
        // stock's list draws a placeholder there, counted in its height, so ReadStateStore doesn't ack
        const after = S.Message.getMessages(channelId).hasMoreAfter ? view : 0;
        channelDimensions(channelId, top, height + after, view);
    }

    // once per frame, and never inside a dispatch: lists render from store listeners. A switch scrolls to the bottom
    // there too, before paint: setting scrollTop in the render task would force a second style and layout pass.
    // After a render the position is reported at once; while scrolling, 200 ms after the last scroll event, as stock
    // does (its list debounces the report)
    let queued = false, toBottom = false, dims = false, acking: Id | null = null, timer = 0;
    function update() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            if (toBottom) scroller.scrollTop = 0;
            toBottom = false;
            const channelId = channel();
            // stock's order on a switch: acks off for the old channel, the new one's position, then acks on
            if (acking && acking !== channelId) {
                automaticAck(acking, false);
                acking = null;
            }
            if (!channelId) return;
            if (dims) report(channelId);
            dims = false;
            if (!acking && S.Message.getMessages(channelId).ready) {
                acking = channelId;
                automaticAck(channelId, true);
            }
            more(channelId);
        });
    }

    // which way the reader is going, from the wheel, keys and the scrollbar: scroll events alone also come from
    // anchoring and truncation. A wheel at either end doesn't scroll, but may still need more history
    let down = false, dragging = false, last = 0;
    scroller.addEventListener("wheel", e => {
        down = e.deltaY > 0;
        update();
    }, { passive: true });
    scroller.addEventListener("pointerdown", () => dragging = true);
    addEventListener("pointerup", () => dragging = false);
    addEventListener("keydown", e => {
        if (/^(PageDown|ArrowDown|End| )$/.test(e.key)) down = true;
        else if (/^(PageUp|ArrowUp|Home)$/.test(e.key)) down = false;
    });

    scroller.addEventListener("scroll", () => {
        if (dragging) down = scroller.scrollTop > last;
        last = scroller.scrollTop;
        clearTimeout(timer);
        timer = window.setTimeout(() => {
            const channelId = channel();
            if (channelId) report(channelId);
        }, 200);
        update();
    }, { passive: true });

    // rows settle to their real heights after rendering (content-visibility), and the window resizes: neither scrolls
    const resized = new ResizeObserver(() => {
        dims = true;
        update();
    });
    resized.observe(scroller);
    resized.observe(scroller.firstElementChild!);

    // after each render; a switch to another channel starts at the bottom
    return (switched: boolean) => {
        toBottom ||= switched;
        if (switched) down = false;
        dims = true;
        update();
    };
}
