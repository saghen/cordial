// The renderer side of screen-capture, imported by mincord's bundle (it runs before Discord's scripts). Importing it
// installs the hooks: getDisplayMedia (here), the Go Live sender's track (cast.ts), its encoded frames (zeroCopy.ts),
// its parameters and SDP (streamQuality.ts), and AV1 streams' frames received (av1Receive.ts). mincord then sets `host` (Discord's pieces, the native bridge, the
// picker), registers `codecPatch` with its webpack patcher and puts this module on its global as `mincord.screen`.

import './av1Receive'
import { castAvailable, castDisplayMedia } from './cast'
import { logger as makeLogger } from './log'
import { settings } from './settings'
import {
  applyToStreamConnection,
  autoQuality,
  effectiveCodec,
  setCurrentStreamQuality,
  tuneStreamTrack,
} from './streamQuality'

export { av1ReceiveStats } from './av1Receive'
export { captureCodecs, castSessionFor, currentCast, probeCaptureCodecs, setPendingCast } from './cast'
export type { CastPick, CastSource, CastStart } from './cast'
export { host } from './host'
export { settings } from './settings'
export { codecConnection, codecOrders, codecPatch, orderCodecs } from './streamCodec'
export { allowedQualities, autoQuality, currentStreamQuality, encodableCodecs } from './streamQuality'
export { zeroCopyStats } from './zeroCopy'

const logger = makeLogger('mincord:display-media')

// Chromium's own capture (the portal)
async function chromiumDisplayMedia(
  original: MediaDevices['getDisplayMedia'],
  devices: MediaDevices,
  opts?: DisplayMediaStreamOptions,
) {
  // Discord asks for 1920x1080 or 1280x720 (ideal); drop that so the track starts at the source's own size, which is
  // what the quality choice below needs to know.
  if (opts?.video && typeof opts.video === 'object') {
    const { width: _w, height: _h, ...video } = opts.video
    opts = { ...opts, video }
  }
  const stream = await original.call(devices, opts)
  const track = stream.getVideoTracks()[0]
  tuneStreamTrack(track, settings.priority)

  // Now that the source's size is known, pick the stream's resolution and frame rate for it and tell Discord's encoder
  // setup too.
  const { width: sourceWidth, height: sourceHeight } = track.getSettings()
  const quality = autoQuality(
    sourceWidth && sourceHeight ? { width: sourceWidth, height: sourceHeight } : undefined,
    effectiveCodec(),
  )
  setCurrentStreamQuality(track, quality)
  try {
    applyToStreamConnection(quality)
  } catch (e) {
    logger.error('Failed to update stream connection quality', e)
  }
  logger.info(
    `Source ${sourceWidth}x${sourceHeight}: streaming ${quality.resolution}p${quality.frameRate} ${quality.codec}`,
  )

  // Capture at the stream's size and rate. Chromium reads back every frame the compositor sends and scales it on the
  // CPU, so asking for more than will be sent is pure cost.
  const frameRate = Number(quality.frameRate)
  track
    .applyConstraints({
      frameRate: { ideal: frameRate, max: frameRate },
      width: { max: quality.width },
      height: { max: quality.height },
    })
    .catch((e) => logger.error('Failed to apply constraints', e))
  return stream
}

if (navigator.userAgent.includes('Linux')) {
  const original = navigator.mediaDevices.getDisplayMedia
  navigator.mediaDevices.getDisplayMedia = async function (this: MediaDevices, opts) {
    // on niri with capture: our own capture (cast.ts), Chromium's only as its fallback
    return (await castAvailable())
      ? castDisplayMedia((o) => original.call(this, o))
      : chromiumDisplayMedia(original, this, opts)
  }
}
