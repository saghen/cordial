// What Discord's UI does that its core doesn't do by itself. Without the UI nothing types, loads a channel's messages
// or subscribes to presences: we have to. Each one is checked against stock in the conformance diff (ROADMAP 0.4).

import { A, S } from "./core";
import type { Id } from "./discord";

// The composer dispatches these on input. TypingStore does the rest: throttles, POSTs /typing, applies slowmode
// cooldowns from the response.
export function startTyping(channelId: Id) {
    A.dispatcher.dispatch({ type: "TYPING_START_LOCAL", channelId });
}

export function stopTyping(channelId: Id) {
    A.dispatcher.dispatch({ type: "TYPING_STOP_LOCAL", channelId });
}

// Stock fetches a channel's messages when its chat mounts. Sending waits for that: sendMessage to a channel that was
// never loaded queues until it is, silently (ai/LOG.md, 0.1).
export function loadChannel(channelId: Id, limit = A.pages.size("MessageManager")) {
    if (!S.Message.getMessages(channelId).ready) A.messages.fetchMessages({ channelId, limit });
}

// Stock's scroller reports its position. When a message arrives, MessageStore asks DimensionStore.isAtBottom: at the
// bottom it trims the oldest loaded messages, anywhere else (or never reported) it trims the newest once more than 120
// are loaded, so a list that never reports loses the live end, the new message included (ai/LOG.md, 0.6). Stock's
// geometry: scrollTop from the top, at the bottom when scrollTop === scrollHeight - offsetHeight.
export function channelDimensions(channelId: Id, scrollTop: number, scrollHeight: number, offsetHeight: number) {
    A.dispatcher.dispatch({ type: "UPDATE_CHANNEL_DIMENSIONS", channelId, scrollTop, scrollHeight, offsetHeight });
}

// Stock's scroller turns automatic acks on for the channel it shows once its messages are ready, and off when it
// leaves. ReadStateStore does the rest: it acks only while the channel is at the bottom (DimensionStore), loaded and
// not in a fullscreen call, so the list must report its position first. windowId is Discord's id for this window.
export function automaticAck(channelId: Id, on: boolean) {
    A.dispatcher.dispatch({ type: on ? "ENABLE_AUTOMATIC_ACK" : "DISABLE_AUTOMATIC_ACK", channelId, windowId: windowId() });
}

export function windowId(): string | undefined {
    return (window as any).__DISCORD_WINDOW_ID;
}
