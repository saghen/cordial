/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The message list's scroll container, shared by every list variant. column-reverse keeps the view at the bottom
// without measuring (scrollTop 0 is the bottom). Like stock's, it reports its position to the core
// (triggers.channelDimensions) and asks for older history near the top (LOG.md, 0.4): without a UI nothing else does.

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { channelDimensions } from "../adapter/triggers";

export function createScroller(host: HTMLElement, channel: () => Id | null) {
    const scroller = document.createElement("div");
    scroller.className = "mc-scroller";
    scroller.dataset.mc = "messages";
    const inner = document.createElement("div");
    inner.className = "mc-messages";
    scroller.append(inner);
    host.append(scroller);

    // older history near the top, as stock's list does; a channel whose messages don't fill the view never scrolls,
    // so this also runs after each render
    function older(channelId: Id) {
        const fromTop = scroller.scrollHeight - scroller.clientHeight + scroller.scrollTop;
        if (fromTop > 400) return;
        const ms = S.Message.getMessages(channelId);
        if (ms.ready && ms.hasMoreBefore && !ms.loadingMore && ms.length)
            A.messages.fetchMessages({ channelId, before: ms.first().id, limit: 50 });
    }

    // once per frame, and never inside a dispatch: lists render from store listeners
    let queued = false;
    function update() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            const channelId = channel();
            if (!channelId) return;
            const height = scroller.scrollHeight, view = scroller.clientHeight;
            // column-reverse: scrollTop runs from 0 at the bottom to -(height - view) at the top
            const top = scroller.scrollTop > -1 ? height - view : Math.round(height - view + scroller.scrollTop);
            channelDimensions(channelId, top, height, view);
            older(channelId);
        });
    }

    scroller.addEventListener("scroll", update, { passive: true });

    return {
        scroller, inner,
        // after each render; a switch to another channel starts at the bottom
        rendered(switched: boolean) {
            if (switched) scroller.scrollTop = 0;
            update();
        }
    };
}
