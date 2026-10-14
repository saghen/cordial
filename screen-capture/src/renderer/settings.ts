// Go Live settings, with Equibop's defaults (mincord's UI sets them later)

import type { StreamCodec, StreamPriority } from './streamQuality'

export const settings = {
  /** preferred codec; resolution and frame rate are picked automatically */
  codec: 'AV1' as StreamCodec,
  priority: 'balanced' as StreamPriority,
  /** pad capture's frames up to the target rate (stuffing.ts; experimental) */
  steadyWireRate: false,
  /** nudge maxBitrate to make goog_cc probe while app limited (targetRate.ts; experimental) */
  bweProbeNudge: false,
  /** a floor under the Go Live connection's bandwidth estimate (streamQuality.ts; experimental) */
  goLiveMinBitrate: false,
  /** Discord's 2.5 Mbps in the Go Live connection's SDP raised to the stream's bitrate, for Chromium's encoders
   *  (streamQuality.ts; experimental) */
  goLiveMaxBitrate: false,
  /** for the lab: Chromium's encoders keep sizes above 1080p (cast.ts, the motion scaler) */
  chromiumFullSize: false,
  /** how long a fallback capture's first frames are held back, so Chromium's encoder learns their rate (cast.ts) */
  fallbackWarmupMs: 1000,
  /** the per-frame and rate trace (zeroCopy.ts), for the lab: set to collect it */
  streamLog: null as ((events: object[]) => void) | null,
}
