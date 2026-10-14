// Go Live and cameras: someone's stream (Discord sends its video only to viewers: stock's watch, STREAM_WATCH; stop is
// STREAM_CLOSE then STREAM_STOP), your own (stock's start, which asks screen-capture's picker through
// getDisplayMedia), and the web engine's videos by stream id (a camera's, or a watched stream's "stream" context),
// asked for while viewed.

import type { Rec } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import type { Channel, Id } from './records'
import { $ } from './store'

// "guild:{guildId}:{channelId}:{ownerId}" or "call:{channelId}:{ownerId}"
export const key = (s: Rec) =>
  (s.streamType === 'call'
    ? [s.streamType, s.channelId, s.ownerId]
    : [s.streamType, s.guildId, s.channelId, s.ownerId]
  ).join(':')

// the stream of a user's you're watching (connected to), in a server or a call (guildId null)
export const watching = (ownerId: Id, guildId: Id | null) =>
  $.ApplicationStreaming.getActiveStreamForUser(ownerId, guildId)
// watched, or stopped: stock's watch, without taking the focus; stock's stop
export function toggleWatch(ownerId: Id, guildId: Id | null) {
  const w = S.ApplicationStreaming.getActiveStreamForUser(ownerId, guildId)
  if (w) return A.streams.stop(key(w), false)
  const s = S.ApplicationStreaming.getStreamForUser(ownerId, guildId)
  if (s) A.streams.watch(s, { noFocus: true })
}

// a user's camera, or (context "stream") the stream you watch: its video's stream id
export const videoOf = (userId: Id, guildId: Id | null, context?: 'stream') =>
  $.VideoStream.getStreamId(userId, guildId, context) as string | undefined
// a video while shown: its MediaStream, counted as a view (the first view asks for the video, the last drops it)
export function view(streamId: string) {
  A.video.watch(streamId)
  return { stream: A.video.stream(streamId) ?? null, close: () => A.video.unwatch(streamId) }
}

// your own Go Live: on or off
export const live = () => !!$.ApplicationStreaming.getCurrentUserActiveStream()
export const toggleLive = (c: Channel) =>
  S.ApplicationStreaming.getCurrentUserActiveStream() ? A.streams.stopOwn(false) : A.goLive.start(c.guild_id, c.id, [])
