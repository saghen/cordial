// The codec order Discord advertises for Go Live: the preferred codec first. A source patch on Discord's WebRTC
// connection module (mincord registers it with adapter/webpack.ts' patch; the replacement calls back through the
// `mincord` global, where the glue puts this module's exports as `mincord.screen`).

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
    const preferred = settings.codec
    if (!encodableCodecs().includes(preferred)) return list
    if (preferred === 'AV1') {
      // If AV1 can't be used (a viewer's client lacks it), VP9 is the next best at the same bitrate
      const vp9First = settings.vp9Fallback && list.includes('VP9') && encodableCodecs().includes('VP9')
      return ['AV1', ...(vp9First ? ['VP9', ...list.filter((c) => c !== 'VP9')] : list)]
    }
    if (!list.includes(preferred)) return list
    return [preferred, ...list.filter((c) => c !== preferred)]
  } catch {
    return list
  }
}
