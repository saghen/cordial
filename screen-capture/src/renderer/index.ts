// The renderer side of screen-capture, imported by cordial's bundle (it runs before Discord's scripts). Importing it
// installs the hooks: getDisplayMedia (here), the Go Live sender's track (cast.ts), its encoded frames (zeroCopy.ts),
// its parameters and SDP (streamQuality.ts), and AV1 streams' frames received (av1Receive.ts). cordial then sets `host`
// (Discord's pieces, the native bridge, the picker), registers `CODEC_PATCH` with its webpack patcher and puts this
// module on its global as `cordial.screen`.

import './av1Receive'
import { castAvailable, castDisplayMedia } from './cast'

export { av1ReceiveStats } from './av1Receive'
export { castSessionFor, currentCast, probeCaptureCodecs, setPendingCast } from './cast'
export type { CastPick, CastSource, CastStart } from './cast'
export { host } from './host'
export { receiveHealth } from './receiveHealth'
export type { ReceiveHealth } from './receiveHealth'
export { settings } from './settings'
export { streamStatus } from './status'
export type { StreamStatus } from './status'
export { codecConnection, CODEC_PATCH, orderCodecs } from './streamCodec'
export { currentStreamQuality } from './streamQuality'
export { zeroCopyStats } from './zeroCopy'

// with capture: our own capture (cast.ts), Chromium's only as its fallback; without capture, Discord's own
// getDisplayMedia, untouched
if (navigator.userAgent.includes('Linux')) {
  const original = navigator.mediaDevices.getDisplayMedia
  navigator.mediaDevices.getDisplayMedia = async function (this: MediaDevices, opts) {
    if (await castAvailable()) return castDisplayMedia((options) => original.call(this, options), opts)
    return original.call(this, opts)
  }
}
