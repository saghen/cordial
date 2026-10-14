// The codec order Discord advertises for Go Live: the preferred codec first. A source patch on Discord's WebRTC
// connection module (cordial registers it with adapter/webpack.ts' patch; the replacement calls back through the
// `cordial` global, where the glue puts this module's exports as `cordial.screen`).

import { captureAv1 } from './cast'
import { host } from './host'
import { settings } from './settings'

export const codecPatch = {
  // WebRTC (browser) connection module: parses the local SDP into the codec list sent in select_protocol (once, when
  // the connection connects)
  find: 'Unable to find a unique rtx SSRC!',
  replace: [
    // (t?[H265,H264,VP8,VP9]:[H264,VP8,VP9]).forEach((t,n)=>{...priority:n+1...}): both lists reordered
    [
      /\?(\[[\w$]+\.[\w$]+\.H265,[\w$]+\.[\w$]+\.H264,[\w$]+\.[\w$]+\.VP8,[\w$]+\.[\w$]+\.VP9\]):(\[[\w$]+\.[\w$]+\.H264,[\w$]+\.[\w$]+\.VP8,[\w$]+\.[\w$]+\.VP9\])(?=\)\.forEach\()/,
      '?cordial.screen.orderCodecs($1):cordial.screen.orderCodecs($2)',
    ],
    // UnifiedConnection.parseLocalDescription(){...=ey(t,this.experimentFlags...)}: which connection the list is for
    [
      /(parseLocalDescription\(\)\{[\s\S]{0,300}?=)([\w$]+)(\([\w$]+,this\.experimentFlags)/,
      '$1(cordial.screen.codecConnection(this),$2)$3',
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
 * With AV1 preferred, the order is AV1 (hardware), VP9 (hardware), VP9 (CPU), H.264 (hardware), H.264 (CPU). The
 * sender's list picks the codec, and a receiver must list AV1 first to take it. So:
 * - our own Go Live connection: AV1, VP9, H.264 when capture encodes AV1; else VP9, H.264, the rest, AV1 last
 *   (Chromium encodes AV1 on the CPU: WebRtcAV1HWEncode is off);
 * - every other connection (voice and camera, watching): AV1, VP9, H.264. The camera is AV1 on the CPU then; VP9 for
 *   it would mean VP9 first for the whole voice connection.
 * VP9 and H.264 are Chromium's encoders, which take the GPU's when there is one (no AMD GPU encodes VP9).
 */
export function orderCodecs(list: string[]): string[] {
  try {
    return order(list)
  } catch {
    return list
  }
}

let encodable: Set<string> | undefined
/** Whether this client encodes video in `codec` (AV1, VP9, ...). */
const canEncode = (codec: string) =>
  (encodable ??= new Set(RTCRtpSender.getCapabilities?.('video')?.codecs.map((c) => c.mimeType.toLowerCase()))).has(
    `video/${codec.toLowerCase()}`,
  )

function order(list: string[]): string[] {
  if (settings.codec !== 'AV1') {
    if (!canEncode(settings.codec) || !list.includes(settings.codec)) return list
    return [settings.codec, ...list.filter((c) => c !== settings.codec)]
  }
  if (!canEncode('AV1')) return list
  const self = host.discord?.currentUser()?.id
  const goLive = connection?.context === 'stream' && !!self && connection.streamUserId === self
  const next = ['VP9', 'H264'].filter((c) => list.includes(c) && canEncode(c))
  const rest = list.filter((c) => !next.includes(c))
  return goLive && !captureAv1() ? [...next, ...rest, 'AV1'] : ['AV1', ...next, ...rest]
}
