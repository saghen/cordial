// The stream log (Liam, 2026-10-14): one logfmt file per Go Live through capture, written and rotated by the main
// process (main/streamLog.js). Every quarter second a tick: capture's numbers (its stats come every 250 ms: main/
// cast.js) and the Go Live sender's (the estimate, what went out, what Discord's server reports back); events as they
// happen: the rate controller's reasons (zeroCopy.ts), the capture method changing (cast.ts), capture's key frames
// and large frames, going over the estimate or Discord's cap, viewers, the game. Numbers, enums, the game's name and
// capture's own messages only: no ids, names, addresses or titles, so a log can be shared as it is.

import type { CastSession } from './cast'
import { host } from './host'
import { streamSender } from './streamQuality'

const TICK_MS = 250
// capture's stats older than this aren't its current ones (it stopped: the portal)
const STALE_MS = 600

type Fields = Record<string, string | number | boolean | null | undefined>

const value = (v: string | number | boolean | null) =>
  v === null
    ? 'null'
    : typeof v === 'boolean'
      ? v
        ? '1'
        : '0'
      : typeof v === 'number'
        ? String(Math.round(v * 100) / 100)
        : v === '' || /[\s"=]/.test(v)
          ? JSON.stringify(v)
          : v
const logfmt = (f: Fields) =>
  Object.entries(f)
    .filter((e): e is [string, string | number | boolean | null] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${value(v)}`)
    .join(' ')
const kbps = (bits: number, ms: number) => (ms > 0 ? Math.round(bits / ms) : undefined)

interface Sample {
  at: number
  bytes: number
  rtx: number
  packets: number
  delay: number
  frames: number
  nack: number
  pli: number
}

class StreamLog {
  private readonly t0 = performance.now()
  private readonly timer = setInterval(() => this.tick().catch(() => {}), TICK_MS)
  private prev: Sample | null = null
  private statsAt = -Infinity
  private rate = 'start'
  private method: string
  private viewers = 0
  private game: string | null
  private over: { cap: string; since: number; peak: number } | null = null

  constructor(private readonly session: CastSession) {
    const q = session.quality
    const [source] = session.pick.source.split(':')
    this.method = session.method
    this.game = host.discord?.game?.() ?? null
    host.native?.log?.(
      'open',
      logfmt({
        t: '0.00',
        k: 'start',
        v: 1,
        at: new Date().toISOString().slice(0, 19) + 'Z',
        source,
        src: `${session.pick.width}x${session.pick.height}`,
        game: this.game,
        size: `${q.width}x${q.height}`,
        fps: q.fps,
        max: q.maxBitrate / 1000,
        sound: !!session.audio,
        capture_method: this.method,
      }),
    )
    session.onInfo = (info) => this.info(info)
  }

  private line(f: Fields) {
    host.native?.log?.('line', logfmt({ t: ((performance.now() - this.t0) / 1000).toFixed(2), ...f }))
  }

  event(k: string, f: Fields) {
    this.line({ k, ...f })
  }

  /** capture's messages (cast.ts) */
  private info(i: any) {
    if (i.type === 'stats') this.statsAt = performance.now()
    else if (i.type === 'device') this.event('capture', { driver: i.driver })
    else if (i.type === 'input')
      this.event('capture', { src: `${i.width}x${i.height}`, size: `${i.encodeWidth}x${i.encodeHeight}` })
    else if (i.type === 'frame')
      this.event('frame', { seq: i.seq, bytes: i.bytes, key: i.key, why: i.why, budget_ms: i.budgetMs })
    else if (i.type === 'audio') this.event('sound', { apps: i.apps?.length ?? 0 })
    else if (i.type === 'error') this.event('error', { message: i.message })
  }

  /** the rate controller's reason changed (zeroCopy.ts) */
  rateChanged(f: { reason: string; target: number; bwe?: number; wire?: number; queue?: number }) {
    this.event('rate', {
      from: this.rate,
      to: f.reason,
      target: kbps(f.target, 1000),
      bwe: f.bwe && kbps(f.bwe, 1000),
      wire: f.wire && kbps(f.wire, 1000),
      queue: f.queue,
    })
    this.rate = f.reason
  }

  private async tick() {
    const s = this.session
    if (s.state === 'ended') return this.close(s.endWhy)
    if (s.method !== this.method) {
      this.event('capture_method', { from: this.method, to: s.method, why: s.fallbackWhy })
      this.method = s.method
    }
    const game = host.discord?.game?.() ?? null
    if (game !== this.game) this.event('game', { game: (this.game = game) })
    const viewers = host.discord?.viewers?.() ?? 0
    if (viewers !== this.viewers) this.event('viewers', { n: (this.viewers = viewers) })

    const sender = streamSender()
    const stats = sender && [...(await sender.getStats().catch(() => new Map())).values()]
    const rtp = stats?.find((r) => r.type === 'outbound-rtp')
    const remote = stats?.find((r) => r.type === 'remote-inbound-rtp')
    const pair = stats?.find((r) => r.type === 'candidate-pair' && r.nominated)
    const cur: Sample | null = rtp
      ? {
          at: rtp.timestamp,
          bytes: rtp.bytesSent ?? 0,
          rtx: rtp.retransmittedBytesSent ?? 0,
          packets: rtp.packetsSent ?? 0,
          delay: rtp.totalPacketSendDelay ?? 0,
          frames: rtp.framesSent ?? 0,
          nack: rtp.nackCount ?? 0,
          pli: (rtp.pliCount ?? 0) + (rtp.firCount ?? 0),
        }
      : null
    const p = cur && this.prev && cur.packets >= this.prev.packets ? this.prev : null
    this.prev = cur
    const ms = p && cur ? cur.at - p.at : 0
    const sent = p && cur ? kbps((cur.bytes - p.bytes) * 8, ms) : undefined
    const bwe = pair?.availableOutgoingBitrate && kbps(pair.availableOutgoingBitrate, 1000)
    const max = sender?.getParameters().encodings?.[0]?.maxBitrate
    const c = performance.now() - this.statsAt < STALE_MS ? s.stats : null

    this.line({
      k: 'tick',
      in: c?.in,
      fps: c ? c.fps : p && cur && ms > 0 ? ((cur.frames - p.frames) * 1000) / ms : undefined,
      kbps: c?.kbps,
      target: c?.target,
      size: c ? `${c.width}x${c.height}` : rtp?.frameWidth && `${rtp.frameWidth}x${rtp.frameHeight}`,
      drop: c?.dropper,
      keys: c?.keys,
      enc: c?.encodeMs,
      bwe,
      sent,
      rtx: p && cur ? kbps((cur.rtx - p.rtx) * 8, ms) : undefined,
      rtt:
        remote?.roundTripTime !== undefined
          ? remote.roundTripTime * 1000
          : pair?.currentRoundTripTime && pair.currentRoundTripTime * 1000,
      loss: remote?.fractionLost !== undefined ? remote.fractionLost * 100 : undefined,
      jitter: remote?.jitter !== undefined ? remote.jitter * 1000 : undefined,
      queue:
        p && cur && cur.packets > p.packets ? ((cur.delay - p.delay) / (cur.packets - p.packets)) * 1000 : undefined,
      nack: p && cur ? cur.nack - p.nack : undefined,
      pli: p && cur ? cur.pli - p.pli : undefined,
      limit: c ? undefined : rtp?.qualityLimitationReason,
      rate: c ? this.rate : undefined,
      viewers,
      ssim: c?.ssim,
      cpu: c?.cpu,
    })
    if (sent !== undefined) this.checkOver(sent, bwe, max && kbps(max, 1000))
  }

  /** going over the estimate or Discord's cap: once when it starts, once when it ends */
  private checkOver(sent: number, bwe: number | undefined, max: number | undefined) {
    const cap = max !== undefined && sent > max ? 'max' : bwe !== undefined && sent > bwe ? 'bwe' : null
    const now = performance.now()
    if (cap && !this.over) {
      this.over = { cap, since: now, peak: sent }
      this.event('over', { cap, sent, bwe, max })
    } else if (cap && this.over) this.over.peak = Math.max(this.over.peak, sent)
    else if (!cap && this.over) {
      this.event('over_end', { cap: this.over.cap, dur: (now - this.over.since) / 1000, peak: this.over.peak })
      this.over = null
    }
  }

  close(why: string | undefined) {
    clearInterval(this.timer)
    this.session.onInfo = null
    this.event('stop', { why })
    host.native?.log?.('close')
    if (log === this) log = null
  }
}

let log: StreamLog | null = null

/** A Go Live through capture starts: its log (cast.ts). */
export function startStreamLog(session: CastSession) {
  if (!host.native?.log) return
  log?.close('replaced')
  log = new StreamLog(session)
}

/** The rate controller's reason changed (zeroCopy.ts). */
export const logRate = (f: Parameters<StreamLog['rateChanged']>[0]) => log?.rateChanged(f)
