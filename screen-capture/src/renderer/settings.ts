// Go Live settings, with Equibop's defaults (mincord's UI sets them later)

import type { StreamCodec, StreamPriority } from './streamQuality'

export const settings = {
  /** preferred codec; resolution and frame rate are picked automatically */
  codec: 'AV1' as StreamCodec,
  /** with AV1 preferred, offer VP9 before H.264 as the fallback */
  vp9Fallback: true,
  priority: 'balanced' as StreamPriority,
  /** pad capture's frames up to the target rate (stuffing.ts; experimental) */
  steadyWireRate: false,
  /** nudge maxBitrate to make goog_cc probe while app limited (targetRate.ts; experimental) */
  bweProbeNudge: false,
  /** a floor under the Go Live connection's bandwidth estimate (streamQuality.ts; experimental) */
  goLiveMinBitrate: false,
  /** how long a fallback capture's first frames are held back, so Chromium's encoder learns their rate (cast.ts) */
  fallbackWarmupMs: 1000,
  /** the per-frame and rate trace (zeroCopy.ts), for the lab: set to collect it */
  streamLog: null as ((events: object[]) => void) | null,
}
