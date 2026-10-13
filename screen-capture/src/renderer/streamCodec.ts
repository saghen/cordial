// The codec order Discord advertises for Go Live: the preferred codec first. A source patch on Discord's WebRTC
// connection module (mincord registers it with adapter/webpack.ts' patch; the replacement calls back through the
// `mincord` global, where the glue puts this module's exports as `mincord.screen`).

import { settings } from './settings'
import { encodableCodecs, StreamCodec } from './streamQuality'

export const codecPatch = {
  // WebRTC (browser) connection module: parses the local SDP into the codec list sent in select_protocol
  find: 'Unable to find a unique rtx SSRC!',
  // (t?[H265,H264,VP8,VP9]:[H264,VP8,VP9]).forEach((t,n)=>{...priority:n+1...}): both lists reordered
  replace: [
    /\?(\[[\w$]+\.[\w$]+\.H265,[\w$]+\.[\w$]+\.H264,[\w$]+\.[\w$]+\.VP8,[\w$]+\.[\w$]+\.VP9\]):(\[[\w$]+\.[\w$]+\.H264,[\w$]+\.[\w$]+\.VP8,[\w$]+\.[\w$]+\.VP9\])(?=\)\.forEach\()/,
    '?mincord.screen.orderCodecs($1):mincord.screen.orderCodecs($2)',
  ] as [RegExp, string],
}

/**
 * Discord's codec list with the preferred codec first (priority = index + 1). AV1 isn't in Discord's list; with AV1
 * preferred it's added, first.
 *
 * With AV1 preferred, Liam's order (2026-10-13): "AV1 (hardware) -> VP9 (hardware) -> VP9 (cpu) -> h264 (hardware) ->
 * h264 (cpu)": AV1, VP9, H.264, then the rest. VP9 and H.264 are Chromium's encoders, which take the GPU's when there
 * is one (no AMD GPU encodes VP9). AV1 stays first even without capture's AV1: the list is also what this client
 * receives, and a viewer listing AV1 last stopped receiving a mincord streamer's AV1 a second in (LOG Key finds,
 * "The codec list is also what a client receives"). So "AV1 only on hardware" isn't expressed here yet.
 */
export function orderCodecs(list: string[]): string[] {
  try {
    const encodable = encodableCodecs()
    if (settings.codec !== 'AV1') {
      if (!encodable.includes(settings.codec) || !list.includes(settings.codec)) return list
      return [settings.codec, ...list.filter((c) => c !== settings.codec)]
    }
    if (!encodable.includes('AV1')) return list
    const first = ['AV1', ...['VP9', 'H264'].filter((c) => list.includes(c) && encodable.includes(c as StreamCodec))]
    return [...first, ...list.filter((c) => !first.includes(c))]
  } catch {
    return list
  }
}
