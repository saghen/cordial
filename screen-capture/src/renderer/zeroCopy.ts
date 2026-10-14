// Zero-copy stream: capture encodes the Go Live video in VRAM (AV1, on the GPU that captures it, renderer/cast.ts) and
// Chromium only sends it.
//
// Chromium keeps packetization, pacing, congestion control, RTCP and Discord's DAVE encryption but encodes nothing
// that is sent: the encoded-frame stage in front of DAVE writes capture's temporal units as frames of their own.
// Chromium 150 lets a sender's encoded writable take any RTCEncodedVideoFrame, but a frame can only be made by
// cloning one (`new RTCEncodedVideoFrame(frame, { metadata })`), and the clone keeps the original's type (key/delta,
// which sets the AV1 aggregation header's N bit), payload type, SSRC and codec. So:
// - the sender encodes the Go Live track (cast.ts: capture's 1 fps preview, 2 px narrower than the stream) and its
//   newest key and delta frame are the templates for ours; Chromium's own frames are dropped;
// - each capture frame is a clone of the template of its type with its own rtpTimestamp, frameId and
//   dependencies, and capture's payload, written as it comes. The RTP timestamp is capture's capture time on
//   Chromium's RTP clock (both monotonic: one offset, taken from the first template), so the stream's timing doesn't
//   jump when Chromium's own frames take over again;
// - there is no key-frame event on this path: a viewer's PLI/FIR shows in the sender's outbound-rtp stats, polled.
// Discord's video m-line has no dependency descriptor or generic frame descriptor, so nothing of the template but
// the N bit reaches the wire.
//
// DAVE: Discord sets its encryption up per sender with RTCRtpScriptTransform when the sender has `transform`, else
// with createEncodedStreams (handing the streams to its worker). Removing `transform` from RTCRtpSender puts
// senders on that second path; video senders' streams are made by us with the swap stage in front (attachSwap), so
// it works the same with or without DAVE. Audio senders get their streams untouched.
//
// When capture goes (cast.ts falls back to Chromium's encoder on the same track) or the call is renegotiated to a
// codec capture doesn't encode (Discord's server picks VP9 when a stock viewer joins), Chromium's own frames go out
// again, from a keyframe of its re-initialised encoder (see Swap.stop).

import { CastConsumer, CastMessage, CastSession, captureAv1, castSessionFor } from './cast'
import { logger as makeLogger } from './log'
import { settings } from './settings'
import { logRate } from './streamLog'
import { startKbps } from './streamQuality'
import { fill, FillState, initialFill, stuff } from './stuffing'
import { guardTarget, initialTarget, RATE, RateState, RateWindow, updateTarget } from './targetRate'

const logger = makeLogger('cordial:zero-copy')

// (not in TypeScript's DOM types yet)
const EncodedFrame = (globalThis as any).RTCEncodedVideoFrame as new (frame: any, init?: { metadata: any }) => any

const POLL_MS = 150
// the rate controller's update (targetRate.ts updateTarget) comes from the poll at least this far apart
const RATE_MS = 1000
// while a template is missing the track gets a preview frame this often: the first at once, the next (the delta
// template) one frame later (WebRTC's frame-rate limiter drops frames closer together than 1 / maxFramerate; at a 30
// fps cap every other one goes)
const POKE_MS = 17
// no key template this long after the frame that asked for one (Chromium's encoder was already configured at this
// size, a new payload type; or it dropped the frame): a frame 2 px narrower (or back) reconfigures it, and its next
// frame is a key frame. Its first frame at 1440p (libaom's set-up and key frame) takes ~40 ms.
const KEY_TEMPLATE_WAIT_MS = 250
// a capture frame that reaches us this much later than the quickest ones did (the main process or this renderer
// was blocked, frames arrive in a burst): skip ahead to a fresh keyframe rather than send the backlog late
const MAX_LATE_MS = 300
// steady wire rate (stuffing.ts): no stuffing while the pacer holds packets longer than this (ms)
const STUFF_PAUSE_MS = 50
// the poll judges the pacer delay only over at least this many packets
const GUARD_MIN_PACKETS = 20
// Discord's cap until the sender's encoding has one, bits/s
const DEFAULT_CAP_BPS = 9e6
// RTP's video clock: 90 kHz
const RTP_TICKS_PER_MS = 90
// the sender's negotiation is checked this often, for up to NEGOTIATE_TIMEOUT_MS (negotiated)
const NEGOTIATE_POLL_MS = 10
const NEGOTIATE_TIMEOUT_MS = 10_000

class Swap implements CastConsumer {
  // idle: Chromium's frames pass; active: ours; warmup: capture is gone, Chromium's frames are dropped until its
  // re-initialised encoder's first keyframe after the fallback capture's warm-up (cast.ts)
  state: 'idle' | 'active' | 'warmup' = 'idle'
  readonly transform: TransformStream
  stats = { sent: 0, keys: 0, keyRequests: 0, late: 0, bytes: 0, stuffed: 0 }
  // capture's target (targetRate.ts) and what it's judged on
  rate: RateState = initialTarget(0)
  private bwe: number | undefined
  private cap = DEFAULT_CAP_BPS
  private recent = new RateWindow()
  private stuffing = false
  private stuffPaused = false
  private filled: FillState = initialFill()
  private fast: { packets: number; delay: number } | null = null
  private lastFastDelay = 0
  private second: { at: number; bytes: number; packets: number; delay: number } | null = null

  private session: CastSession | null = null
  private sender: RTCRtpSender | null = null
  private out: TransformStreamDefaultController | null = null
  private tpl: { key?: any; delta?: any } = {}
  private frameId = 0
  private rtpAt: { rtp: number; ms: number } | null = null // a template's RTP timestamp and when it was encoded
  private lastRtp = 0
  private needKey = true
  private keyRequested = false
  private minDelay = Infinity
  private lastPli = -1
  private lastKbps = 0
  private lastPoke = 0
  private keyAskedAt = 0
  private alt = false
  private pokeTimer: ReturnType<typeof setTimeout> | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor() {
    this.transform = new TransformStream({
      start: (c) => {
        this.out = c
      },
      transform: (f, c) => {
        if (this.state === 'idle') return c.enqueue(f)
        if (this.state === 'warmup') {
          // (a fallback's frames once it's warmed up; another track's at once)
          if (this.sender?.track === this.session?.encoder && (!this.session?.warmedUp || f.type !== 'key')) return
          this.state = 'idle'
          return c.enqueue(f)
        }
        const md = f.getMetadata()
        // renegotiated: Chromium's first frame in the new codec says so (no template of it)
        const mime = (md as { mimeType?: string }).mimeType?.toLowerCase()
        if (mime && mime !== 'video/av1') return this.codecChanged(mime)
        this.rtpAt ??= { rtp: md.rtpTimestamp, ms: performance.now() }
        if (f.type === 'key') {
          this.tpl.key = f
        } else {
          this.tpl.delta = f
        }
        // a key frame is what the next capture frame has to be (the stream's first one came before its template)
        if (this.needKey && this.tpl.key) this.requestKey()
      },
    })
  }

  /**
   * Templates missing: the capture preview goes into the track now (Chromium encodes it: the key template first,
   * then the delta), and again every POKE_MS until both are there. Every other frame is 2 px narrower (see
   * KEY_TEMPLATE_WAIT_MS).
   */
  private poke = () => {
    clearTimeout(this.pokeTimer)
    if (this.state !== 'active' || !this.session || (this.tpl.key && this.tpl.delta)) return
    const now = performance.now()
    if (now - this.lastPoke >= POKE_MS) {
      if (!this.tpl.key && this.keyAskedAt && now - this.keyAskedAt > KEY_TEMPLATE_WAIT_MS) {
        this.alt = !this.alt
        this.keyAskedAt = 0
      }
      if (this.session.writePreview(this.alt)) {
        this.lastPoke = now
        this.keyAskedAt ||= now
      }
    }
    this.pokeTimer = setTimeout(this.poke, POKE_MS)
  }

  /** The templates are missing (start, a new payload type): ask Chromium's encoder for them. */
  private needTemplates() {
    this.tpl = {}
    this.keyAskedAt = 0
    this.poke()
  }

  start(session: CastSession, sender: RTCRtpSender) {
    this.cap = sender.getParameters().encodings?.[0]?.maxBitrate ?? DEFAULT_CAP_BPS
    const kbps = startKbps(this.cap / 1000)
    Object.assign(this, {
      needKey: true,
      keyRequested: false,
      rtpAt: null,
      lastRtp: 0,
      minDelay: Infinity,
      lastPli: -1,
      lastKbps: kbps,
      rate: initialTarget(kbps * 1000),
      bwe: undefined,
      recent: new RateWindow(),
      filled: initialFill(),
      fast: null,
      lastFastDelay: 0,
      second: null,
      stuffPaused: false,
      stuffing: settings.steadyWireRate,
    })
    this.session = session
    this.sender = sender
    this.state = 'active'
    session.consumer = this
    session.send({ type: 'start', kbps })
    // capture starts on a key frame, which is dropped until Chromium's key template is out (see send)
    this.needTemplates()
    this.timer = setInterval(() => this.poll(), POLL_MS)
  }

  /** capture is gone (cast.ts' fallback, or the stream ended), or the sender has another track. */
  stop() {
    clearInterval(this.timer)
    clearTimeout(this.pokeTimer)
    if (this.state !== 'active') return
    // (the session lets go of the swap: ending later, it mustn't stop the swap for another cast)
    if (this.session?.consumer === this) this.session.consumer = null
    this.state = this.session?.state === 'fallback' ? 'warmup' : 'idle'
  }

  /** A source switch: the swap stops sending the cast that was on the sender before. */
  trackChanged() {
    if (this.state === 'active' && this.sender?.track !== this.session?.encoder) this.stop()
  }

  private codecChanged(mime: string) {
    this.session?.fallback(`the stream is now ${mime}, which capture doesn't encode`)
  }

  // changes under 4 % wait while the target moves; once it holds still it is sent whatever the step (a climb in small
  // steps otherwise leaves capture short of it for good: 3233 of 3325 kbps for 13 minutes, measured)
  private setBitrate(bps: number, settled: boolean) {
    const kbps = Math.round(bps / 1000)
    if (this.state !== 'active' || !kbps || kbps === this.lastKbps) return
    if (!settled && Math.abs(kbps - this.lastKbps) < this.lastKbps * 0.04) return
    this.lastKbps = kbps
    this.session?.send({ type: 'bitrate', kbps })
  }

  private setRate(next: RateState, wire?: number, sendDelay?: number) {
    const prev = this.rate
    this.rate = next
    this.setBitrate(next.target, next.target === prev.target)
    // the stream log (streamLog.ts, and settings.streamLog): each change of the controller's reason (a target moving
    // under the same reason isn't logged)
    if (next.reason === prev.reason) return
    logRate({ reason: next.reason, target: next.target, bwe: this.bwe, wire, queue: sendDelay })
    settings.streamLog?.([
      {
        event: 'rate',
        t: Math.round(performance.now()),
        state: next.reason,
        target: Math.round(next.target),
        bwe: this.bwe,
        wire: wire && Math.round(wire),
        sendDelay: sendDelay && Math.round(sendDelay * 10) / 10,
      },
    ])
  }

  private guard(sendDelay?: number) {
    const next = guardTarget(this.rate, {
      bwe: this.bwe,
      cap: this.cap,
      sendDelay,
      sentRate: this.recent.rate(performance.now()),
    })
    if (next !== this.rate) this.setRate(next, undefined, sendDelay)
  }

  message(m: CastMessage) {
    if (this.state !== 'active' || m.type !== 'frame') return
    this.send(m.key, m.t, m.data)
  }

  private requestKey() {
    this.stats.keyRequests++
    if (!this.keyRequested) this.session?.send({ type: 'key' })
    this.keyRequested = true
  }

  /**
   * Every POLL_MS: a renegotiation, a viewer's PLI / FIR (stream start, a viewer joining, loss: the next capture frame
   * must be a key frame), the pacer's delay (guards the target and the stuffing), and at most every RATE_MS the
   * controller's update.
   */
  private async poll() {
    const { sender } = this
    if (this.state !== 'active' || !sender) return
    if (sender.track !== this.session?.encoder) return this.trackChanged()
    // renegotiated: to another codec, or to another payload type (the templates carry theirs)
    const codec = sender.getParameters().codecs?.[0]
    if (codec && codec.mimeType.toLowerCase() !== 'video/av1') return this.codecChanged(codec.mimeType)
    if (this.tpl.key && codec && this.tpl.key.getMetadata().payloadType !== codec.payloadType) {
      this.needKey = true
      this.needTemplates()
    }
    const stats = await sender.getStats().catch(() => null)
    if (!stats || this.state !== 'active') return
    let n = 0
    let packets = 0
    let delay = 0
    let bytes = 0
    let at = 0
    let bwe: number | undefined
    stats.forEach((r: any) => {
      if (r.type === 'outbound-rtp') {
        n += (r.pliCount ?? 0) + (r.firCount ?? 0)
        packets += r.packetsSent ?? 0
        delay += r.totalPacketSendDelay ?? 0
        bytes += r.bytesSent ?? 0
        at = r.timestamp
      } else if (r.type === 'candidate-pair' && r.nominated && r.availableOutgoingBitrate)
        bwe = r.availableOutgoingBitrate
    })
    if (bwe !== undefined) this.bwe = bwe
    if (this.lastPli >= 0 && n > this.lastPli) this.requestKey()
    this.lastPli = n
    // the pacer's delay since the last poll that had enough packets
    if (!this.fast || packets < this.fast.packets) this.fast = { packets, delay }
    else if (packets - this.fast.packets >= GUARD_MIN_PACKETS) {
      const ms = ((delay - this.fast.delay) / (packets - this.fast.packets)) * 1000
      this.fast = { packets, delay }
      this.stuffPaused = ms > STUFF_PAUSE_MS
      // (two windows in a row: one key frame alone holds the pacer for ~120 ms at 9 Mbps)
      this.guard(Math.min(ms, this.lastFastDelay))
      this.lastFastDelay = ms
    }
    // capture's target (targetRate.ts): WebRTC's bandwidth estimate under Discord's cap, except where the estimate only
    // fell to our own app-limited rate (outbound-rtp's targetBitrate is the template encoder's)
    const s = this.second
    if (s && packets >= s.packets && at - s.at < RATE_MS) return
    this.second = { at, bytes, packets, delay }
    if (!s || packets < s.packets) return
    const wire = bytes >= s.bytes ? ((bytes - s.bytes) * 8) / ((at - s.at) / 1000) : undefined
    const sendDelay = packets > s.packets ? ((delay - s.delay) / (packets - s.packets)) * 1000 : undefined
    this.cap = sender.getParameters().encodings?.[0]?.maxBitrate ?? DEFAULT_CAP_BPS
    this.setRate(
      updateTarget(this.rate, { t: performance.now(), bwe, cap: this.cap, wire, sendDelay }),
      wire,
      sendDelay,
    )
  }

  private send(key: boolean, tUs: number, data: ArrayBuffer) {
    if (key) this.keyRequested = false
    // capture's capture clock (CLOCK_MONOTONIC) and performance.now() share no origin: the quickest frame so far
    // sets the offset (within its transit time, a few ms), lateness is relative to it
    const delay = performance.now() - tUs / 1000
    this.minDelay = Math.min(this.minDelay, delay)
    if (!key && delay - this.minDelay > MAX_LATE_MS) {
      this.stats.late++
      this.needKey = true
    }
    // nothing sent before a key frame (deltas before it can't be decoded by anyone)
    if (this.needKey && !key) {
      if (this.tpl.key) this.requestKey()
      return
    }
    // no template for this frame yet (the stream's start): it's dropped, and transform asks for a key frame once
    // the key template is there
    const tpl = key ? this.tpl.key : this.tpl.delta
    if (!tpl || !this.rtpAt) {
      this.needKey = true
      return
    }
    this.needKey = false
    this.recent.add(performance.now(), data.byteLength)
    this.guard()
    // steady wire rate: topped up to the target, never above the estimate
    let pad = 0
    if (this.stuffing) {
      const target = Math.min(this.rate.target, RATE.HEADROOM * (this.bwe ?? this.cap))
      const f = fill(this.filled, data.byteLength, tUs / 1000, this.stuffPaused ? 0 : target)
      this.filled = f.state
      const stuffed = stuff(new Uint8Array(data), f.pad)
      pad = stuffed.byteLength - data.byteLength
      data = stuffed.buffer as ArrayBuffer
    }
    this.stats.bytes += data.byteLength
    this.stats.stuffed += pad
    const md = tpl.getMetadata()
    // (unwrapped: kept increasing past 2^32)
    const rtp = this.rtpAt.rtp + Math.round((tUs / 1000 + this.minDelay - this.rtpAt.ms) * RTP_TICKS_PER_MS)
    this.lastRtp = Math.max(this.lastRtp + 1, rtp)
    this.frameId = Math.max(this.frameId, md.frameId ?? 0) + 1
    const frame = new EncodedFrame(tpl, {
      metadata: {
        ...md,
        rtpTimestamp: this.lastRtp >>> 0,
        frameId: this.frameId,
        dependencies: key ? [] : [this.frameId - 1],
      },
    })
    frame.data = data
    this.stats.sent++
    if (key) this.stats.keys++
    this.out?.enqueue(frame)
  }
}

const swaps = new WeakMap<RTCRtpSender, Swap>()
const senderPcs = new WeakMap<RTCRtpSender, RTCPeerConnection>()
const claims = new WeakMap<RTCRtpSender, () => { readable: ReadableStream; writable: WritableStream }>()

const senderProto = RTCRtpSender.prototype as any
const origCreate: (() => { readable: ReadableStream; writable: WritableStream }) | undefined =
  navigator.userAgent.includes('Linux') ? senderProto.createEncodedStreams : undefined

if (origCreate) {
  // Discord's DAVE on the createEncodedStreams path (see the top of the file)
  delete senderProto.transform
  senderProto.createEncodedStreams = function (this: RTCRtpSender) {
    const claim = claims.get(this)
    if (!claim) return origCreate.call(this) // audio (or a sender we never saw made): untouched
    claims.delete(this)
    return claim()
  }
}

/**
 * A video sender was made (streamQuality.ts' hooks): its encoded streams, made now (createEncodedStreams only works
 * before negotiation), with the swap stage in front. Until Discord asks for them (its DAVE worker) Chromium's frames go
 * straight back into the sender; once it asks, it gets the swap's output and the sender's writable, so its encryption
 * runs after the swap. Without DAVE nobody asks, and the swap still works.
 */
export function attachSwap(pc: RTCPeerConnection, sender: RTCRtpSender) {
  if (!origCreate || swaps.has(sender)) return
  senderPcs.set(sender, pc)
  let streams: { readable: ReadableStream; writable: WritableStream }
  try {
    streams = origCreate.call(sender)
  } catch (e) {
    logger.error("Failed to create the sender's encoded streams", e)
    return
  }
  const swap = new Swap()
  swaps.set(sender, swap)
  const out = streams.readable.pipeThrough(swap.transform).getReader()
  const ours = streams.writable.getWriter()
  const sink: { discord?: ReadableStreamDefaultController } = {}
  ;(async () => {
    for (;;) {
      const { value, done } = await out.read()
      if (done) break
      if (sink.discord) sink.discord.enqueue(value)
      else await ours.write(value)
    }
  })().catch((e) => logger.error('Encoded frame relay failed', e))
  claims.set(sender, () => ({
    readable: new ReadableStream({
      start: (c) => {
        sink.discord = c
      },
    }),
    writable: new WritableStream({ write: (f) => ours.write(f) }),
  }))
}

export const isZeroCopy = (sender: RTCRtpSender) => swaps.get(sender)?.state === 'active'
/** The swap's counters. */
export const zeroCopyStats = (sender: RTCRtpSender) => swaps.get(sender)?.stats

const sendCodec = (sender: RTCRtpSender) => sender.getParameters().codecs?.[0]?.mimeType?.toLowerCase()

/**
 * Until the sender is negotiated to send (Discord puts the track on a recvonly transceiver, sets it sendrecv and
 * renegotiates; its codecs are there from the first negotiation already, so the direction tells): checked whenever its
 * connection's signaling state changes (the answer applied), and every 10 ms besides, for up to 10 s.
 */
async function negotiated(sender: RTCRtpSender) {
  const pc = senderPcs.get(sender)
  const sending = () => {
    const dir = pc?.getTransceivers().find((t) => t.sender === sender)?.currentDirection
    return Boolean(sendCodec(sender)) && (!pc || dir === 'sendonly' || dir === 'sendrecv')
  }
  const until = performance.now() + NEGOTIATE_TIMEOUT_MS
  while (!sending() && performance.now() < until)
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        pc?.removeEventListener('signalingstatechange', done)
        resolve()
      }
      const timer = setTimeout(done, NEGOTIATE_POLL_MS)
      pc?.addEventListener('signalingstatechange', done)
    })
}

const negotiating = new WeakSet<RTCRtpSender>()

/** A Go Live track is on `sender`: send capture's video in place of Chromium's encode, if the track is a cast's. */
export async function startZeroCopy(sender: RTCRtpSender, track: MediaStreamTrack) {
  const session = castSessionFor(track)
  // (Discord can have the track before capture is up: it's handed over at once, cast.ts)
  if (session?.state === 'starting') await session.up
  if (!session || session.state !== 'cast' || session.consumer || sender.track !== track) return
  const swap = swaps.get(sender)
  swap?.trackChanged()
  if (negotiating.has(sender) || isZeroCopy(sender)) return
  if (!swap) return session.fallback('no encoded-frame stage')
  // only what capture encodes can be sent: wait for the negotiation
  negotiating.add(sender)
  await negotiated(sender)
  negotiating.delete(sender)
  const codec = sendCodec(sender)
  if (codec !== 'video/av1' || !captureAv1())
    return session.fallback(
      codec === 'video/av1' ? "capture can't encode AV1 on this GPU" : `the stream is ${codec ?? 'not negotiated'}`,
    )
  if (sender.track !== track || session.state !== 'cast') return
  swap.start(session, sender)
}
