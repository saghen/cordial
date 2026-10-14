// capture's bitrate target while it encodes the stream (zeroCopy.ts). Pure: no DOM, no imports.
//
// Why not just "target = 0.95 x the bandwidth estimate": capture's VCN encoder is CBR but puts out far less than
// its target on simple scenes (3-4 of 8.55 Mbps), and every cut of WebRTC's estimate lands at about the rate it
// last saw acknowledged (delay-based back-off is beta x the acked rate; a low probe result replaces the estimate).
// So when the sender is application limited, the estimate falls to our own rate; a target that follows it lowers
// the rate we send, and the next cut lands lower still: a ratchet (live: 4.9 Mbps -> 70 kbps). Pinning the target
// at Discord's cap instead builds pacer queues of up to 1.1 s after real cuts (the pacer then drains above the
// estimate, which cuts again).
//
// The controller:
// - follows the estimate up at once (target = HEADROOM x min(estimate, cap));
// - follows it down only when the drop is the network's: the estimate stayed under the target for LOW_SECS while
//   we really sent near the target (BUSY_RATIO, in BUSY_SECS of those seconds). An estimate that fell while we sent
//   much less than the target is our own app-limited rate: the target holds;
// - never lets a held target build a pacer queue: a pacer delay over QUEUE_MS (packets' mean time in the pacer)
//   puts the target under the estimate at once (QUEUE_CUT), and while it is held above the estimate, frames that
//   come out at more than BURST_RATIO x the estimate over BURST_MS (the content got complex) release it to the
//   estimate (guardTarget, run on every frame / fast stats poll).

export const RATE = {
  /** target = this x min(estimate, cap): room for RTP/DAVE overhead and retransmissions */
  HEADROOM: 0.95,
  /** the estimate must stay under the target this long before the target follows it down... */
  LOW_SECS: 3,
  /** ...and in this many of those seconds we must have sent at least BUSY_RATIO x the target */
  BUSY_SECS: 2,
  BUSY_RATIO: 0.8,
  /**
   * pacer delay (ms, mean per packet) above which the target goes under the estimate: two updates in a row (a
   * single key frame holds a quiet second's packets 160-230 ms), or one at 3x
   */
  QUEUE_MS: 100,
  QUEUE_CUT: 0.85,
  /** held above the estimate: our frames at more than this x the estimate over BURST_MS release the hold */
  BURST_RATIO: 1.25,
  BURST_MS: 500,
  /** never below this (capture's encoder needs something) */
  MIN_BPS: 150_000,
}

export type RateReason = 'start' | 'estimate' | 'hold' | 'follow' | 'queue' | 'burst' | 'cap'

export interface RateState {
  /** bits/s for capture */
  target: number
  reason: RateReason
  /** ms: when the estimate first went under the target (cleared when it is back or the target followed) */
  lowSince: number | null
  /** per second: when, and whether we sent near the target then */
  busy: { time: number; busy: boolean }[]
  /** the last ceiling (HEADROOM x min(estimate, cap)) seen */
  ceiling?: number
  /** updates in a row with the pacer delay over QUEUE_MS */
  queued?: number
}

export interface RateSample {
  /** ms (any monotonic clock) */
  time: number
  /** bandwidth estimate, bits/s (candidate-pair availableOutgoingBitrate); absent: unknown */
  bwe?: number
  /** Discord's cap (the encoding's maxBitrate), bits/s */
  cap: number
  /** what the video actually sent over the last second, bits/s (outbound-rtp bytesSent rate) */
  wire?: number
  /** mean pacer delay of the packets sent over the last second, ms */
  sendDelay?: number
}

const ceilingOf = (bwe: number | undefined, cap: number) => RATE.HEADROOM * Math.min(bwe ?? cap, cap)
const floor = (bps: number) => Math.max(RATE.MIN_BPS, bps)

export const initialTarget = (bps: number): RateState => ({
  target: floor(bps),
  reason: 'start',
  lowSince: null,
  busy: [],
})

/** Once a second, with the sender's stats. */
export function updateTarget(state: RateState, sample: RateSample): RateState {
  const ceiling = ceilingOf(sample.bwe, sample.cap)
  const max = RATE.HEADROOM * sample.cap
  const now = {
    time: sample.time,
    busy: sample.wire !== undefined && sample.wire >= RATE.BUSY_RATIO * Math.min(state.target, max),
  }
  const queued = (sample.sendDelay ?? 0) > RATE.QUEUE_MS ? (state.queued ?? 0) + 1 : 0
  const busy = [...state.busy.filter((entry) => entry.time > sample.time - RATE.LOW_SECS * 1000 - 500), now]
  const next = (target: number, reason: RateReason, lowSince: number | null = null): RateState => ({
    target: floor(Math.min(target, max)),
    reason,
    lowSince,
    busy,
    ceiling,
    queued,
  })

  if (sample.bwe === undefined) return next(state.target, state.target > max ? 'cap' : state.reason, state.lowSince)
  if (queued >= 2 || (sample.sendDelay ?? 0) > 3 * RATE.QUEUE_MS)
    return next(Math.min(state.target, RATE.QUEUE_CUT * ceiling), 'queue')
  if (ceiling >= state.target) return next(ceiling, 'estimate')
  // the estimate is under the target: the network's, or our own app-limited rate?
  const lowSince = state.lowSince ?? sample.time
  const busySecs = busy.filter((entry) => entry.time >= lowSince - 1000 && entry.busy).length
  if (sample.time - lowSince >= RATE.LOW_SECS * 1000 && busySecs >= RATE.BUSY_SECS) return next(ceiling, 'follow')
  return next(state.target, 'hold', lowSince)
}

export interface GuardSample {
  bwe?: number
  cap: number
  /** mean pacer delay of the packets sent since the last guard sample, ms (absent: too few packets) */
  sendDelay?: number
  /** our frames' rate over the last BURST_MS, bits/s */
  sentRate?: number
}

/**
 * Between updates (every frame or fast stats poll): the target never sits above the estimate while a pacer queue
 * builds or while our frames come out well above the estimate. Returns `state` itself when nothing changes.
 */
export function guardTarget(state: RateState, sample: GuardSample): RateState {
  if (sample.bwe === undefined) return state
  const ceiling = ceilingOf(sample.bwe, sample.cap)
  if ((sample.sendDelay ?? 0) > RATE.QUEUE_MS && state.target > RATE.QUEUE_CUT * ceiling)
    return { ...state, target: floor(RATE.QUEUE_CUT * ceiling), reason: 'queue', lowSince: null, ceiling }
  if (state.target > ceiling && (sample.sentRate ?? 0) > RATE.BURST_RATIO * sample.bwe)
    return { ...state, target: floor(ceiling), reason: 'burst', lowSince: null, ceiling }
  return state
}

/** Bytes sent over a sliding window (guardTarget's sentRate). */
export class RateWindow {
  private items: { time: number; bytes: number }[] = []
  private total = 0
  private readonly ms = RATE.BURST_MS

  add(time: number, bytes: number) {
    this.items.push({ time, bytes })
    this.total += bytes
    while (this.items.length && this.items[0].time <= time - this.ms) this.total -= this.items.shift()!.bytes
  }

  /** bits/s over the window (undefined until it spans most of the window) */
  rate(time: number): number | undefined {
    if (!this.items.length || time - this.items[0].time < this.ms * 0.6) return
    return (this.total * 8 * 1000) / this.ms
  }
}
