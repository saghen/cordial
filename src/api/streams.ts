// Go Live and cameras: someone's stream (Discord sends its video only to viewers: stock's watch, STREAM_WATCH; stop is
// STREAM_CLOSE then STREAM_STOP), your own (stock's start, which asks screen-capture's picker through
// getDisplayMedia), and the web engine's videos by stream id (a camera's, or a watched stream's "stream" context),
// asked for while viewed.

import type { AnyRecord } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import type { Channel, Id } from './types'
import { $ } from './store'
import { text } from './strings'

// "guild:{guildId}:{channelId}:{ownerId}" or "call:{channelId}:{ownerId}"
export const key = (stream: AnyRecord) =>
  (stream.streamType === 'call'
    ? [stream.streamType, stream.channelId, stream.ownerId]
    : [stream.streamType, stream.guildId, stream.channelId, stream.ownerId]
  ).join(':')

// the stream of a user's you're watching (connected to), in a server or a call (guildId null)
export const watching = (ownerId: Id, guildId: Id | null) =>
  $.ApplicationStreaming.getActiveStreamForUser(ownerId, guildId)
// watched, or stopped: stock's watch, without taking the focus; stock's stop
export function toggleWatch(ownerId: Id, guildId: Id | null) {
  const watched = S.ApplicationStreaming.getActiveStreamForUser(ownerId, guildId)
  if (watched) return A.streams.stop(key(watched), false)
  const stream = S.ApplicationStreaming.getStreamForUser(ownerId, guildId)
  if (stream) A.streams.watch(stream, { noFocus: true })
}

// a user's camera, or (context "stream") the stream you watch: its video's stream id
export const videoOf = (userId: Id, guildId: Id | null, context?: 'stream') =>
  $.VideoStream.getStreamId(userId, guildId, context) as string | undefined
// the quality the owner of a stream you watch announced, as stock's badge: "720p 30FPS" (or "Source 60FPS")
export function quality(userId: Id, guildId: Id | null) {
  const data = $.VideoStream.getUserStreamData(userId, guildId, 'stream')
  if (!data?.maxResolution || !data.maxFrameRate) return null
  const resolution =
    data.maxResolution.type === 'source'
      ? text('SCREENSHARE_SOURCE')
      : text('SCREENSHARE_RESOLUTION_ABBREVIATED', { resolution: data.maxResolution.height })
  return `${resolution} ${text('SCREENSHARE_FPS_ABBREVIATED', { fps: data.maxFrameRate })}`
}
// a video while shown: its MediaStream, counted as a view (the first view asks for the video, the last drops it)
export function view(streamId: string) {
  A.video.watch(streamId)
  return { stream: A.video.stream(streamId) ?? null, close: () => A.video.unwatch(streamId) }
}

// your own Go Live: on or off
export const live = () => Boolean($.ApplicationStreaming.getCurrentUserActiveStream())
export const toggleLive = (channel: Channel) =>
  S.ApplicationStreaming.getCurrentUserActiveStream()
    ? A.streams.stopOwn(false)
    : A.goLive.start(channel.guild_id, channel.id, [])
