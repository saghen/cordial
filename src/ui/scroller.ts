// The message list's scroll container (messages.tsx). column-reverse keeps the view at the bottom
// without measuring (scrollTop 0 is the bottom). Like stock's, it reports its position to the core
// (triggers.channelDimensions), turns automatic acks on for the channel it shows (triggers.automaticAck) and asks for
// older history near the top (ai/LOG.md, 0.4): without a UI nothing else does.

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { automaticAck, channelDimensions } from "../adapter/triggers";

// stock's cap on a fetch's limit (a constant in Discord's constants module, 30 since at least 2026-10)
const MAX_FETCH = 30;

export function createScroller(scroller: HTMLElement, channel: () => Id | null) {
    // older history near the top, as stock's list does: within 500 px of the top, two of stock's pages at most 30
    // messages (its fetch cap), truncating the other end. A channel whose messages don't fill the view never scrolls,
    // so this also runs after each render.
    // While the channel has unreads stock waits until the view is past the oldest loaded message (into the placeholder
    // it draws above them): reading down from the unread line shouldn't pull in history. With no placeholder, that's
    // the top (2 px: at the top scrollTop stops 1 px short here, clientHeight is rounded)
    function older(channelId: Id) {
        const fromTop = scroller.scrollHeight - scroller.clientHeight + scroller.scrollTop;
        if (fromTop > (S.ReadState.getOldestUnreadMessageId(channelId) != null ? 2 : 500)) return;
        const ms = S.Message.getMessages(channelId);
        if (ms.ready && ms.hasMoreBefore && !ms.loadingMore && ms.length)
            A.messages.fetchMessages({ channelId, before: ms.first().id, limit: Math.min(MAX_FETCH, 2 * A.pages.size("scrollManager.loadMore")), truncate: true });
    }

    function report(channelId: Id) {
        const height = scroller.scrollHeight, view = scroller.clientHeight;
        // column-reverse: scrollTop runs from 0 at the bottom to -(height - view) at the top
        const top = scroller.scrollTop > -1 ? height - view : Math.round(height - view + scroller.scrollTop);
        channelDimensions(channelId, top, height, view);
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
            older(channelId);
        });
    }

    scroller.addEventListener("scroll", () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => {
            const channelId = channel();
            if (channelId) report(channelId);
        }, 200);
        update();
    }, { passive: true });

    // after each render; a switch to another channel starts at the bottom
    return (switched: boolean) => {
        toBottom ||= switched;
        dims = true;
        update();
    };
}
