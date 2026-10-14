// Go Live settings (the lab sets them)

import type { StreamCodec } from './streamQuality'

export const settings = {
  /** the codec Go Live advertises first (streamCodec.ts): AV1, or another for the lab */
  codec: 'AV1' as StreamCodec,
  /** pad capture's frames up to the target rate (stuffing.ts; experimental) */
  steadyWireRate: false,
  /** the rate controller's changes (zeroCopy.ts), for the lab: set to collect them */
  streamLog: null as ((events: object[]) => void) | null,
}
