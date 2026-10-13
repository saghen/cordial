// The codec order Discord advertises for Go Live: the preferred codec first. A source patch on Discord's WebRTC
// connection module (mincord registers it with adapter/webpack.ts' patch; the replacement calls back through the
// `mincord` global, where the glue puts this module's exports as `mincord.screen`).

import { captureCodecs } from './cast'
import { settings } from './settings'
import { encodableCodecs } from './streamQuality'

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
 * Discord's codec list with the preferred codec first (priority = index + 1). AV1 isn't in Discord's list; it's only
 * advertised when preferred, since how the voice server and other clients handle it otherwise is unknown.
 */
export function orderCodecs(list: string[]): string[] {
  try {
    const capture = captureCodecs() ?? []
    // capture encodes H.264 but not AV1 (a GPU without AV1 encode, e.g. an RDNA2 card or an iGPU): H.264 first, on
    // capture, rather than AV1 on the CPU (Chromium's)
    const preferred =
      settings.codec === 'AV1' && capture.includes('h264') && !capture.includes('av1') ? 'H264' : settings.codec
    if (!encodableCodecs().includes(preferred)) return list
    if (preferred === 'AV1') {
      // If AV1 can't be used (a viewer's client lacks it, as stock Discord here): H.264 when capture encodes it (still
      // zero-copy on the GPU), else VP9, the next best at the same bitrate (Chromium's encoder, on the CPU)
      const next =
        capture.includes('h264') && list.includes('H264')
          ? 'H264'
          : settings.vp9Fallback && list.includes('VP9') && encodableCodecs().includes('VP9')
            ? 'VP9'
            : null
      return ['AV1', ...(next ? [next, ...list.filter((c) => c !== next)] : list)]
    }
    if (!list.includes(preferred)) return list
    return [preferred, ...list.filter((c) => c !== preferred)]
  } catch {
    return list
  }
}
