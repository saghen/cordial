/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Discord's UI does that its core doesn't do by itself. Without the UI nothing types, loads a channel's messages
// or subscribes to presences: we have to. Each one is checked against stock in the conformance diff (ROADMAP 0.4).

import { FluxDispatcher } from "@equicord/types/webpack/common";

import { A, S } from "./core";
import type { Id } from "./discord";

// The composer dispatches these on input. TypingStore does the rest: throttles, POSTs /typing, applies slowmode
// cooldowns from the response.
export function startTyping(channelId: Id) {
    FluxDispatcher.dispatch({ type: "TYPING_START_LOCAL", channelId });
}

export function stopTyping(channelId: Id) {
    FluxDispatcher.dispatch({ type: "TYPING_STOP_LOCAL", channelId });
}

// Stock fetches a channel's messages when its chat mounts. Sending waits for that: sendMessage to a channel that was
// never loaded queues until it is, silently (LOG.md, 0.1).
export function loadChannel(channelId: Id, limit = 50) {
    if (!S.Message.getMessages(channelId).ready) A.messages.fetchMessages({ channelId, limit });
}

// Stock's scroller reports its position. When a message arrives, MessageStore asks DimensionStore.isAtBottom: at the
// bottom it trims the oldest loaded messages, anywhere else (or never reported) it trims the newest once more than 120
// are loaded, so a list that never reports loses the live end, the new message included (LOG.md, 0.6). Stock's
// geometry: scrollTop from the top, at the bottom when scrollTop === scrollHeight - offsetHeight.
export function channelDimensions(channelId: Id, scrollTop: number, scrollHeight: number, offsetHeight: number) {
    FluxDispatcher.dispatch({ type: "UPDATE_CHANNEL_DIMENSIONS", channelId, scrollTop, scrollHeight, offsetHeight });
}
