// The codec order Discord advertises for Go Live: the preferred codec first. A source patch on Discord's WebRTC
// connection module (mincord registers it with adapter/webpack.ts' patch; the replacement calls back through the
// `mincord` global, where the glue puts this module's exports as `mincord.screen`).

import { captureEncodes } from './cast'
import { host } from './host'
import { settings } from './settings'
import { encodableCodecs, StreamCodec } from './streamQuality'

export const codecPatch = {
  // WebRTC (browser) connection module: parses the local SDP into the codec list sent in select_protocol (once, when
  // the connection connects)
  find: 'Unable to find a unique rtx SSRC!',
  replace: [
    // (t?[H265,H264,VP8,VP9]:[H264,VP8,VP9]).forEach((t,n)=>{...priority:n+1...}): both lists reordered
    [
      /\?(\[[\w$]+\.[\w$]+\.H265,[\w$]+\.[\w$]+\.H264,[\w$]+\.[\w$]+\.VP8,[\w$]+\.[\w$]+\.VP9\]):(\[[\w$]+\.[\w$]+\.H264,[\w$]+\.[\w$]+\.VP8,[\w$]+\.[\w$]+\.VP9\])(?=\)\.forEach\()/,
      '?mincord.screen.orderCodecs($1):mincord.screen.orderCodecs($2)',
    ],
    // UnifiedConnection.parseLocalDescription(){...=ey(t,this.experimentFlags...)}: which connection the list is for
    [
      /(parseLocalDescription\(\)\{[\s\S]{0,300}?=)([\w$]+)(\([\w$]+,this\.experimentFlags)/,
      '$1(mincord.screen.codecConnection(this),$2)$3',
    ],
  ] as [RegExp, string][],
}

/** The connection whose local SDP is being parsed (Discord's UnifiedConnection: context, streamUserId), this task */
let connection: { context?: string; streamUserId?: string | null } | null = null
export function codecConnection(c: typeof connection) {
  connection = c
  queueMicrotask(() => (connection = null))
}

/**
 * Discord's codec list for a connection, the preferred codec first (priority = index + 1). It's sent once, when the
 * connection connects. AV1 isn't in Discord's list; with AV1 preferred it's added.
 *
 * With AV1 preferred, Liam's order (2026-10-13): "AV1 (hardware) -> VP9 (hardware) -> VP9 (cpu) -> h264 (hardware) ->
 * h264 (cpu)". The sender's list picks the codec, and a receiver must list AV1 first to take it (LOG Key finds, "The
 * codec list is also what a client receives"). So:
 * - our own Go Live connection: AV1, VP9, H.264 when capture encodes AV1; else VP9, H.264, the rest, AV1 last
 *   (Chromium encodes AV1 on the CPU: WebRtcAV1HWEncode is off);
 * - every other connection (voice and camera, watching): AV1, VP9, H.264. The camera is AV1 on the CPU then; VP9 for
 *   it would mean VP9 first for the whole voice connection (Open questions).
 * VP9 and H.264 are Chromium's encoders, which take the GPU's when there is one (no AMD GPU encodes VP9).
 */
export function orderCodecs(list: string[]): string[] {
  let out = list
  try {
    out = order(list)
  } catch {}
  codecOrders.push({ context: connection?.context, out })
  if (codecOrders.length > 20) codecOrders.shift()
  return out
}

/** The last orders given, with their connection's context (for the lab) */
export const codecOrders: { context?: string; out: string[] }[] = []

function order(list: string[]): string[] {
  const encodable = encodableCodecs()
  if (settings.codec !== 'AV1') {
    if (!encodable.includes(settings.codec) || !list.includes(settings.codec)) return list
    return [settings.codec, ...list.filter((c) => c !== settings.codec)]
  }
  if (!encodable.includes('AV1')) return list
  const self = host.discord?.currentUser()?.id
  const goLive = connection?.context === 'stream' && !!self && connection.streamUserId === self
  const next = ['VP9', 'H264'].filter((c) => list.includes(c) && encodable.includes(c as StreamCodec))
  const rest = list.filter((c) => !next.includes(c))
  return goLive && !captureEncodes('av1') ? [...next, ...rest, 'AV1'] : ['AV1', ...next, ...rest]
}
