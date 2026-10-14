// What Discord's UI does that its core doesn't do by itself: without the UI, nothing else does it.

import { A } from '../adapter/needs'
import type { Id } from '../adapter/discord'

// the composer's, on input. TypingStore throttles, POSTs /typing and applies slowmode cooldowns
export function startTyping(channelId: Id) {
  A.dispatcher.dispatch({ type: 'TYPING_START_LOCAL', channelId })
}

export function stopTyping(channelId: Id) {
  A.dispatcher.dispatch({ type: 'TYPING_STOP_LOCAL', channelId })
}

// The list's position, as stock's scroller reports it (scrollTop from the top). When a message arrives, MessageStore
// trims the oldest loaded messages if the channel is at the bottom, the newest otherwise (or if never reported), so a
// list that never reports loses the new message
export function channelDimensions(channelId: Id, scrollTop: number, scrollHeight: number, offsetHeight: number) {
  A.dispatcher.dispatch({ type: 'UPDATE_CHANNEL_DIMENSIONS', channelId, scrollTop, scrollHeight, offsetHeight })
}

// Stock's list turns automatic acks on for the channel it shows once its messages are ready, and off when it leaves.
// ReadStateStore then acks while the channel is at the bottom (channelDimensions) and the window focused
export function automaticAck(channelId: Id, on: boolean) {
  A.dispatcher.dispatch({
    type: on ? 'ENABLE_AUTOMATIC_ACK' : 'DISABLE_AUTOMATIC_ACK',
    channelId,
    windowId: (window as any).__DISCORD_WINDOW_ID,
  })
}

// stock's local ack (Escape's): ReadStateStore's ack without a request, which also clears the NEW line
export function localAck(channelId: Id) {
  A.dispatcher.dispatch({ type: 'CHANNEL_LOCAL_ACK', channelId })
}
