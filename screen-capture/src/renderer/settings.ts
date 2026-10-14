// Go Live settings (scripts set them, through `cordial.screen.settings`)

export const settings = {
  /** the codec Go Live advertises first (streamCodec.ts): AV1, or another for testing */
  codec: 'AV1' as string,
  /** pad capture's frames up to the target rate (stuffing.ts; experimental) */
  steadyWireRate: false,
  /** the rate controller's changes (zeroCopy.ts): set to collect them */
  streamLog: null as ((events: object[]) => void) | null,
}
