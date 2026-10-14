// The stream log: one logfmt file per Go Live through capture, written and rotated by the main process
// (main/streamLog.js). Every quarter second a tick: capture's numbers (its stats come every 250 ms: main/cast.js) and
// the Go Live sender's (the estimate, what went out, what Discord's server reports back); events as they happen: the
// rate controller's reasons (zeroCopy.ts), the capture method changing (cast.ts), capture's key frames and large
// frames, going over the estimate or Discord's cap, viewers, the game. Numbers, enums, the game's name and capture's
// own messages only: no ids, names, addresses or titles, so a log can be shared as it is.

import type { CastSession } from './cast'
import { host } from './host'
import { streamSender } from './streamQuality'

const TICK_MS = 250
// capture's stats older than this aren't its current ones (it stopped: the portal)
const STALE_MS = 600

type Fields = Record<string, string | number | boolean | null | undefined>

function value(field: string | number | boolean | null) {
  if (field === null) return 'null'
  if (typeof field === 'boolean') return field ? '1' : '0'
  if (typeof field === 'number') return String(Math.round(field * 100) / 100)
  if (field === '' || /[\s"=]/.test(field)) return JSON.stringify(field)
  return field
}
const logfmt = (fields: Fields) =>
  Object.entries(fields)
    .filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined)
    .map(([key, field]) => `${key}=${value(field)}`)
    .join(' ')
const kbps = (bits: number, ms: number) => (ms > 0 ? Math.round(bits / ms) : undefined)

function overCap(sent: number, bwe: number | undefined, max: number | undefined) {
  if (max !== undefined && sent > max) return 'max'
  if (bwe !== undefined && sent > bwe) return 'bwe'
  return null
}

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
  private readonly startedAt = performance.now()
  private readonly timer = setInterval(() => this.tick().catch(() => {}), TICK_MS)
  private prev: Sample | null = null
  private statsAt = -Infinity
  private rate = 'start'
  private method: string
  private viewers = 0
  private game: string | null
  private over: { cap: string; since: number; peak: number } | null = null

  constructor(private readonly session: CastSession) {
    const quality = session.quality
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
        size: `${quality.width}x${quality.height}`,
        fps: quality.fps,
        max: quality.maxBitrate / 1000,
        sound: Boolean(session.audio),
        capture_method: this.method,
      }),
    )
    session.onInfo = (info) => this.info(info)
  }

  private line(fields: Fields) {
    host.native?.log?.('line', logfmt({ t: ((performance.now() - this.startedAt) / 1000).toFixed(2), ...fields }))
  }

  event(kind: string, fields: Fields) {
    this.line({ k: kind, ...fields })
  }

  /** capture's messages (cast.ts) */
  private info(info: any) {
    if (info.type === 'stats') this.statsAt = performance.now()
    else if (info.type === 'device') this.event('capture', { driver: info.driver })
    else if (info.type === 'input')
      this.event('capture', { src: `${info.width}x${info.height}`, size: `${info.encodeWidth}x${info.encodeHeight}` })
    else if (info.type === 'frame')
      this.event('frame', { seq: info.seq, bytes: info.bytes, key: info.key, why: info.why, budget_ms: info.budgetMs })
    else if (info.type === 'audio') this.event('sound', { apps: info.apps?.length ?? 0 })
    else if (info.type === 'error') this.event('error', { message: info.message })
  }

  /** the rate controller's reason changed (zeroCopy.ts) */
  rateChanged(change: { reason: string; target: number; bwe?: number; wire?: number; queue?: number }) {
    this.event('rate', {
      from: this.rate,
      to: change.reason,
      target: kbps(change.target, 1000),
      bwe: change.bwe && kbps(change.bwe, 1000),
      wire: change.wire && kbps(change.wire, 1000),
      queue: change.queue,
    })
    this.rate = change.reason
  }

  private async tick() {
    const session = this.session
    if (session.state === 'ended') return this.close(session.endWhy)
    if (session.method !== this.method) {
      this.event('capture_method', { from: this.method, to: session.method, why: session.fallbackWhy })
      this.method = session.method
    }
    const game = host.discord?.game?.() ?? null
    if (game !== this.game) {
      this.game = game
      this.event('game', { game })
    }
    const viewers = host.discord?.viewers?.() ?? 0
    if (viewers !== this.viewers) {
      this.viewers = viewers
      this.event('viewers', { n: viewers })
    }

    const sender = streamSender()
    const stats = sender && [...(await sender.getStats().catch(() => new Map())).values()]
    const rtp = stats?.find((stat) => stat.type === 'outbound-rtp')
    const remote = stats?.find((stat) => stat.type === 'remote-inbound-rtp')
    const pair = stats?.find((stat) => stat.type === 'candidate-pair' && stat.nominated)
    const current: Sample | null = rtp
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
    const prev = current && this.prev && current.packets >= this.prev.packets ? this.prev : null
    this.prev = current
    const ms = prev && current ? current.at - prev.at : 0
    const sent = prev && current ? kbps((current.bytes - prev.bytes) * 8, ms) : undefined
    const bwe = pair?.availableOutgoingBitrate && kbps(pair.availableOutgoingBitrate, 1000)
    const max = sender?.getParameters().encodings?.[0]?.maxBitrate
    const captureStats = performance.now() - this.statsAt < STALE_MS ? session.stats : null
    const sentFps = prev && current && ms > 0 ? ((current.frames - prev.frames) * 1000) / ms : undefined

    this.line({
      k: 'tick',
      in: captureStats?.in,
      fps: captureStats ? captureStats.fps : sentFps,
      kbps: captureStats?.kbps,
      target: captureStats?.target,
      size: captureStats
        ? `${captureStats.width}x${captureStats.height}`
        : rtp?.frameWidth && `${rtp.frameWidth}x${rtp.frameHeight}`,
      drop: captureStats?.dropper,
      keys: captureStats?.keys,
      enc: captureStats?.encodeMs,
      bwe,
      sent,
      rtx: prev && current ? kbps((current.rtx - prev.rtx) * 8, ms) : undefined,
      rtt:
        remote?.roundTripTime !== undefined
          ? remote.roundTripTime * 1000
          : pair?.currentRoundTripTime && pair.currentRoundTripTime * 1000,
      loss: remote?.fractionLost !== undefined ? remote.fractionLost * 100 : undefined,
      jitter: remote?.jitter !== undefined ? remote.jitter * 1000 : undefined,
      queue:
        prev && current && current.packets > prev.packets
          ? ((current.delay - prev.delay) / (current.packets - prev.packets)) * 1000
          : undefined,
      nack: prev && current ? current.nack - prev.nack : undefined,
      pli: prev && current ? current.pli - prev.pli : undefined,
      limit: captureStats ? undefined : rtp?.qualityLimitationReason,
      rate: captureStats ? this.rate : undefined,
      viewers,
      ssim: captureStats?.ssim,
      cpu: captureStats?.cpu,
    })
    if (sent !== undefined) this.checkOver(sent, bwe, max && kbps(max, 1000))
  }

  /** going over the estimate or Discord's cap: once when it starts, once when it ends */
  private checkOver(sent: number, bwe: number | undefined, max: number | undefined) {
    const cap = overCap(sent, bwe, max)
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
export const logRate = (change: Parameters<StreamLog['rateChanged']>[0]) => log?.rateChanged(change)
