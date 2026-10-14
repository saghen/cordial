// capture's bitrate target while it encodes the stream (zeroCopy.ts). Pure: no DOM, no imports.
//
// Why not just "target = 0.95 x the bandwidth estimate": capture's VCN encoder is CBR but puts out far less than
// its target on simple scenes (3-4 of 8.55 Mbps), and every cut of WebRTC's estimate lands at about the rate it
// last saw acknowledged (delay-based back-off is beta x the acked rate; a low probe result replaces the estimate).
// So when the sender is application limited, the estimate falls to our own rate; a target that follows it lowers
// the rate we send, and the next cut lands lower still: a ratchet (live: 4.9 Mbps -> 70 kbps). Pinning the target
// at Discord's cap instead built pacer queues of up to 1.1 s after real cuts (the pacer then drains above the
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
   * single key frame holds a quiet second's packets 160-230 ms in the bench), or one at 3x
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
  busy: { t: number; busy: boolean }[]
  /** the last ceiling (HEADROOM x min(estimate, cap)) seen */
  ceiling?: number
  /** updates in a row with the pacer delay over QUEUE_MS */
  queued?: number
}

export interface RateSample {
  /** ms (any monotonic clock) */
  t: number
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

export function initialTarget(bps: number): RateState {
  return { target: floor(bps), reason: 'start', lowSince: null, busy: [] }
}

/** Once a second, with the sender's stats. */
export function updateTarget(s: RateState, x: RateSample): RateState {
  const ceiling = ceilingOf(x.bwe, x.cap)
  const max = RATE.HEADROOM * x.cap
  const now = { t: x.t, busy: x.wire !== undefined && x.wire >= RATE.BUSY_RATIO * Math.min(s.target, max) }
  const queued = (x.sendDelay ?? 0) > RATE.QUEUE_MS ? (s.queued ?? 0) + 1 : 0
  const busy = [...s.busy.filter((b) => b.t > x.t - RATE.LOW_SECS * 1000 - 500), now]
  const next = (target: number, reason: RateReason, lowSince: number | null = null): RateState => ({
    target: floor(Math.min(target, max)),
    reason,
    lowSince,
    busy,
    ceiling,
    queued,
  })

  if (x.bwe === undefined) return next(s.target, s.target > max ? 'cap' : s.reason, s.lowSince)
  if (queued >= 2 || (x.sendDelay ?? 0) > 3 * RATE.QUEUE_MS)
    return next(Math.min(s.target, RATE.QUEUE_CUT * ceiling), 'queue')
  if (ceiling >= s.target) return next(ceiling, 'estimate')
  // the estimate is under the target: the network's, or our own app-limited rate?
  const lowSince = s.lowSince ?? x.t
  const busySecs = busy.filter((b) => b.t >= lowSince - 1000 && b.busy).length
  if (x.t - lowSince >= RATE.LOW_SECS * 1000 && busySecs >= RATE.BUSY_SECS) return next(ceiling, 'follow')
  return next(s.target, 'hold', lowSince)
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
 * builds or while our frames come out well above the estimate. Returns `s` itself when nothing changes.
 */
export function guardTarget(s: RateState, x: GuardSample): RateState {
  if (x.bwe === undefined) return s
  const ceiling = ceilingOf(x.bwe, x.cap)
  if ((x.sendDelay ?? 0) > RATE.QUEUE_MS && s.target > RATE.QUEUE_CUT * ceiling)
    return { ...s, target: floor(RATE.QUEUE_CUT * ceiling), reason: 'queue', lowSince: null, ceiling }
  if (s.target > ceiling && (x.sentRate ?? 0) > RATE.BURST_RATIO * x.bwe)
    return { ...s, target: floor(ceiling), reason: 'burst', lowSince: null, ceiling }
  return s
}

/** Bytes sent over a sliding window (guardTarget's sentRate). */
export class RateWindow {
  private items: { t: number; bytes: number }[] = []
  private total = 0
  private readonly ms: number
  constructor(ms = RATE.BURST_MS) {
    this.ms = ms
  }

  add(t: number, bytes: number) {
    this.items.push({ t, bytes })
    this.total += bytes
    while (this.items.length && this.items[0].t <= t - this.ms) this.total -= this.items.shift()!.bytes
  }

  /** bits/s over the window (undefined until it spans most of the window) */
  rate(t: number): number | undefined {
    if (!this.items.length || t - this.items[0].t < this.ms * 0.6) return
    return (this.total * 8 * 1000) / this.ms
  }
}
