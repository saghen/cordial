// Zero-copy stream: capture encodes the Go Live video in VRAM (AV1 or H.264, the call's codec, on the GPU that
// captures it, renderer/cast.ts) and Chromium only sends it.
//
// Chromium keeps packetization, pacing, congestion control, RTCP and Discord's DAVE encryption but encodes nothing
// that is sent: the encoded-frame stage in front of DAVE writes capture's temporal units as frames of their own.
// Chromium 150 lets a sender's encoded writable take any RTCEncodedVideoFrame, but a frame can only be made by
// cloning one (`new RTCEncodedVideoFrame(frame, { metadata })`), and the clone keeps the original's type (key/delta,
// which sets the AV1 aggregation header's N bit), payload type, SSRC and codec. So:
// - the sender encodes the Go Live track (cast.ts: capture's 1 fps preview, at the stream's size) and its newest
//   key and delta frame are the templates for ours; Chromium's own frames are dropped;
// - each capture frame is a clone of the template of its type with its own rtpTimestamp, frameId and
//   dependencies, and capture's payload, written as it comes. The RTP timestamp is capture's capture time on
//   Chromium's RTP clock (both monotonic: one offset, taken from the first template), so the stream's timing doesn't
//   jump when Chromium's own frames take over again (a jump of up to a second, the age of the template, made the
//   receiver hold frames back for seconds after a fallback);
// - there is no key-frame event on this path: a viewer's PLI/FIR shows in the sender's outbound-rtp stats, polled.
// Discord's video m-line has no dependency descriptor or generic frame descriptor, so nothing of the template but
// the N bit reaches the wire.
//
// DAVE: Discord sets its encryption up per sender with RTCRtpScriptTransform when the sender has `transform`, else
// with createEncodedStreams (handing the streams to its worker). Removing `transform` from RTCRtpSender puts
// senders on that second path; video senders' streams are made by us with the swap stage in front (attachSwap), so
// it works the same with or without DAVE. Audio senders get their streams untouched.
//
// H.264: capture's access units are Annex B, as Chromium's encoder hands them to this stage (its packetizer splits
// the NAL units itself); SPS and PPS come with each IDR. The steady wire rate stuffs it with filler NAL units.
//
// When capture goes (cast.ts falls back to a normal capture into the same track) or the stream is neither AV1 nor
// H.264, Chromium's own frames go out again, from a keyframe of its re-initialised encoder (see Swap.stop).

import { CastConsumer, CastMessage, CastSession, captureEncodes, castSessionFor } from './cast'
import { logger as makeLogger } from './log'
import { settings } from './settings'
import { fill, FillState, initialFill, stuff } from './stuffing'
import { guardTarget, initialTarget, RATE, RateState, RateWindow, updateTarget } from './targetRate'

const logger = makeLogger('mincord:zero-copy')

// (not in TypeScript's DOM types yet)
const EncodedFrame = (globalThis as any).RTCEncodedVideoFrame as new (frame: any, init?: { metadata: any }) => any

const KEY_POLL_MS = 150
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
// steady wire rate (stuffing.ts): no stuffing while the pacer holds packets longer than this (fast poll, ms)
const STUFF_PAUSE_MS = 50
// the fast stats poll (KEY_POLL_MS) judges the pacer delay only over at least this many packets
const GUARD_MIN_PACKETS = 20

// Per-frame trace (diagnosing a bandwidth estimate that falls with no loss): one "inject" line per frame we write, and
// one summary line a second ({"event":"inject","sec":1,...}), to settings.streamLog.
const TRACE_TICK_MS = 1000

// one injected frame, as the stream log gets it: dt/cs/seq when capture delivered it, wt/qw when its write began
interface InjectLine {
  event: 'inject'
  /** renderer performance.now() when capture delivered the frame, ms */
  dt: number
  /** capture's capture time (CLOCK_MONOTONIC), ms */
  cs: number
  seq: number
  type: 'key' | 'delta'
  bytes: number
  rtp: number
  frameId: number
  /** frames waiting between the swap and the sender's pipe when this one was made */
  qr: number
  /** template state: 1 key template, 2 delta template, 4 needKey, 8 wantTemplates */
  tpl: number
  /** renderer performance.now() when the frame was written into the sender's writable, ms */
  wt?: number
  /** frames queued in the writable when this one was written */
  qw?: number
  /** ms since the previous write */
  gap?: number
  /** bytes of stuffing added (steady wire rate) */
  stuff?: number
}

// the per-frame trace only with a stream log to write to
const traceLog = () => !!settings.streamLog

class Swap implements CastConsumer {
  // idle: Chromium's frames pass; active: ours; warmup: capture is gone, Chromium's frames are dropped until its
  // re-initialised encoder's first keyframe after the fallback capture's warm-up (cast.ts)
  state: 'idle' | 'active' | 'warmup' = 'idle'
  readonly transform: TransformStream
  stats = { sent: 0, keys: 0, keyRequests: 0, late: 0, bytes: 0, stuffed: 0 }
  // capture's target (targetRate.ts) and what it's judged on
  rate: RateState = initialTarget(0)
  private bwe: number | undefined
  private cap = 9e6
  private recent = new RateWindow()
  private stuffing = false
  private stuffPaused = false
  private filled: FillState = initialFill()
  private fast: { packets: number; delay: number } | null = null
  private lastFastDelay = 0

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
  private wantTemplates = false
  private timers: ReturnType<typeof setInterval>[] = []
  // per-frame trace (see TRACE_TICK_MS)
  private traceOut: object[] = []
  private traced = new WeakMap<object, InjectLine>()
  private inSeq = 0
  private inAt = 0
  private delivered = 0
  private written = 0
  private maxGap = 0
  private prevWrite = 0

  constructor() {
    this.transform = new TransformStream({
      start: (c) => void (this.out = c),
      transform: (f, c) => {
        if (this.state === 'idle') return c.enqueue(f)
        if (this.state === 'warmup') {
          if (!this.session?.warmedUp || f.type !== 'key') return
          this.state = 'idle'
          logger.info("Chromium's frames go out again")
          return c.enqueue(f)
        }
        const md = f.getMetadata()
        this.rtpAt ??= { rtp: md.rtpTimestamp, ms: performance.now() }
        // renegotiated to the other codec: Chromium's first frame in it says so, before startZeroCopy's poll would
        const codec = SWAP_CODECS[(md as { mimeType?: string }).mimeType?.toLowerCase() ?? '']
        if (codec && codec !== this.session?.codec && captureEncodes(codec)) this.setCodec(codec)
        if (f.type === 'key') {
          this.tpl.key = f
        } else {
          this.tpl.delta = f
        }
        if (this.wantTemplates && this.tpl.key && this.tpl.delta) {
          this.wantTemplates = false
          clearTimeout(this.pokeTimer)
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
    if (this.state !== 'active' || !this.session || !this.wantTemplates) return
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
    this.wantTemplates = true
    this.poke()
  }

  start(session: CastSession, sender: RTCRtpSender, kbps: number, codec: SwapCodec) {
    Object.assign(this, {
      needKey: true,
      keyRequested: false,
      rtpAt: null,
      lastRtp: 0,
      minDelay: Infinity,
      lastPli: -1,
      prevWrite: 0,
      lastKbps: Math.round(kbps),
      rate: initialTarget(kbps * 1000),
      bwe: undefined,
      recent: new RateWindow(),
      filled: initialFill(),
      fast: null,
      lastFastDelay: 0,
      stuffPaused: false,
      stuffing: settings.steadyWireRate,
    })
    this.session = session
    this.sender = sender
    this.state = 'active'
    session.consumer = this
    session.setCodec(codec)
    session.send({ type: 'start', kbps: Math.round(kbps), codec })
    // capture starts on a key frame, which is dropped until Chromium's key template is out (see send)
    this.needTemplates()
    this.timers.push(setInterval(() => this.pollKeyRequests(), KEY_POLL_MS))
    this.timers.push(setInterval(() => this.traceTick(), TRACE_TICK_MS))
  }

  /** the call was renegotiated to the other codec: capture re-opens its encoder (a key frame), new templates */
  setCodec(codec: SwapCodec) {
    if (this.state !== 'active' || !this.session || this.session.codec === codec) return
    this.session.setCodec(codec)
    this.session.send({ type: 'start', kbps: this.lastKbps, codec })
    this.needKey = true
    this.needTemplates()
  }

  private traceTick() {
    if (!traceLog()) {
      this.traceOut = []
      return
    }
    this.traceOut.push({
      event: 'inject',
      sec: 1,
      delivered: this.delivered,
      written: this.written,
      maxGap: Math.round(this.maxGap * 1000) / 1000,
    })
    settings.streamLog?.(this.traceOut)
    this.traceOut = []
    this.delivered = 0
    this.written = 0
    this.maxGap = 0
  }

  /** The relay is about to write one of our frames into the sender's writable (`queued`: frames waiting there). */
  wrote(line: InjectLine, queued: number) {
    const now = performance.now()
    line.wt = now
    line.qw = queued
    line.gap = this.prevWrite ? now - this.prevWrite : 0
    this.maxGap = Math.max(this.maxGap, line.gap)
    this.prevWrite = now
    this.written++
    this.traceOut.push(line)
  }

  /** The trace's line of a frame the relay is writing, if it is one of ours. */
  lineOf(frame: object) {
    return this.traced.get(frame)
  }

  /** the rate capture was last asked for */
  get kbps() {
    return this.lastKbps
  }

  /** capture is gone (cast.ts' fallback, or the stream ended). */
  stop() {
    this.timers.forEach(clearInterval)
    this.timers = []
    clearTimeout(this.pokeTimer)
    if (this.state === 'active') this.state = 'warmup'
  }

  private setBitrate(bps: number) {
    const kbps = Math.round(bps / 1000)
    if (this.state !== 'active' || !kbps || Math.abs(kbps - this.lastKbps) < this.lastKbps * 0.04) return
    this.lastKbps = kbps
    this.session?.send({ type: 'bitrate', kbps })
  }

  /** Once a second (startZeroCopy): the estimate, Discord's cap, what we sent and the pacer delay. */
  updateRate(bwe: number | undefined, cap: number, wire: number | undefined, sendDelay: number | undefined) {
    this.bwe = bwe
    this.cap = cap
    this.setRate(updateTarget(this.rate, { t: performance.now(), bwe, cap, wire, sendDelay }), wire, sendDelay)
    if (this.rate.probe && settings.bweProbeNudge) this.nudge()
  }

  private setRate(next: RateState, wire?: number, sendDelay?: number) {
    const prev = this.rate
    this.rate = next
    this.setBitrate(next.target)
    // the stream log: every change of the controller's state, and every probe asked for
    if ((next.reason !== prev.reason || next.probe) && traceLog())
      this.traceOut.push({
        event: 'rate',
        t: Math.round(performance.now()),
        state: next.reason,
        target: Math.round(next.target),
        bwe: this.bwe,
        wire: wire && Math.round(wire),
        sendDelay: sendDelay && Math.round(sendDelay * 10) / 10,
        probe: next.probe || undefined,
      })
  }

  // bweProbeNudge: the encoding's maxBitrate 1 bps down (or back up): goog_cc probes when the max allocated
  // bitrate changes while the sender is app limited (targetRate.ts)
  private nudged = false
  private nudge() {
    const { sender } = this
    if (!sender) return
    const p = sender.getParameters()
    const e = p.encodings?.[0]
    if (!e?.maxBitrate) return
    e.maxBitrate += this.nudged ? 1 : -1
    this.nudged = !this.nudged
    sender.setParameters(p).catch((err) => logger.warn('maxBitrate nudge failed', err))
  }

  private guard(sendDelay?: number) {
    const next = guardTarget(this.rate, {
      bwe: this.bwe,
      cap: this.cap,
      sendDelay,
      sentRate: this.recent.rate(performance.now()),
    })
    if (next === this.rate) return
    this.setRate(next, undefined, sendDelay)
  }

  /** The controller's state for the stream log. */
  rateInfo() {
    return {
      target: Math.round(this.rate.target),
      state: this.rate.reason,
      ceiling: this.rate.ceiling && Math.round(this.rate.ceiling),
      stuffing: this.stuffing ? !this.stuffPaused : undefined,
    }
  }

  setHeight(height: number) {
    if (this.state === 'active') this.session?.send({ type: 'height', height })
  }

  message(m: CastMessage) {
    if (this.state !== 'active' || m.type !== 'frame') return
    this.delivered++
    this.inAt = performance.now()
    this.inSeq = m.seq
    this.send(m.key, m.t, m.data)
  }

  private requestKey() {
    this.stats.keyRequests++
    if (!this.keyRequested) this.session?.send({ type: 'key' })
    this.keyRequested = true
  }

  // a viewer's PLI / FIR (stream start, a viewer joining, loss): the next capture frame must be a key frame
  private async pollKeyRequests() {
    if (this.state !== 'active' || !this.sender) return
    let n = 0
    let packets = 0
    let delay = 0
    ;(await this.sender.getStats().catch(() => new Map())).forEach((r: any) => {
      if (r.type === 'outbound-rtp') {
        n += (r.pliCount ?? 0) + (r.firCount ?? 0)
        packets += r.packetsSent ?? 0
        delay += r.totalPacketSendDelay ?? 0
      } else if (r.type === 'candidate-pair' && r.nominated && r.availableOutgoingBitrate)
        this.bwe = r.availableOutgoingBitrate
    })
    if (this.lastPli >= 0 && n > this.lastPli) this.requestKey()
    this.lastPli = n
    // the pacer's delay since the last poll that had enough packets: guards the target (and the stuffing)
    if (!this.fast || packets < this.fast.packets) this.fast = { packets, delay }
    else if (packets - this.fast.packets >= GUARD_MIN_PACKETS) {
      const ms = ((delay - this.fast.delay) / (packets - this.fast.packets)) * 1000
      this.fast = { packets, delay }
      this.stuffPaused = ms > STUFF_PAUSE_MS
      // (two windows in a row: one key frame alone holds the pacer for ~120 ms at 9 Mbps)
      this.guard(Math.min(ms, this.lastFastDelay))
      this.lastFastDelay = ms
    }
    // renegotiated to another payload type: the templates (which carry theirs) are stale
    const pt = this.sender.getParameters().codecs?.[0]?.payloadType
    if (this.tpl.key && pt != null && this.tpl.key.getMetadata().payloadType !== pt) {
      this.needKey = true
      this.needTemplates()
    }
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
    if (!this.ready(key)) {
      this.needKey = true
      return
    }
    this.write(key, tUs, data)
  }

  private ready(key: boolean) {
    return !!this.rtpAt && !!(key ? this.tpl.key : this.tpl.delta)
  }

  private write(key: boolean, tUs: number, data: ArrayBuffer) {
    const tpl = key ? this.tpl.key : this.tpl.delta
    if (!tpl || !this.rtpAt) return
    this.needKey = false
    const now = performance.now()
    this.recent.add(now, data.byteLength)
    this.guard()
    // steady wire rate: topped up to the target, never above the estimate
    let pad = 0
    if (this.stuffing) {
      const target = Math.min(this.rate.target, RATE.HEADROOM * (this.bwe ?? this.cap))
      const f = fill(this.filled, data.byteLength, tUs / 1000, this.stuffPaused ? 0 : target)
      this.filled = f.state
      if (f.pad) {
        const stuffed = stuff(new Uint8Array(data), f.pad, this.session?.codec)
        pad = stuffed.byteLength - data.byteLength
        if (pad) data = stuffed.buffer as ArrayBuffer
      }
    }
    this.stats.bytes += data.byteLength
    this.stats.stuffed += pad
    const md = tpl.getMetadata()
    // (unwrapped: kept increasing past 2^32)
    const rtp = this.rtpAt.rtp + Math.round((tUs / 1000 + this.minDelay - this.rtpAt.ms) * 90)
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
    if (traceLog())
      this.traced.set(frame, {
        event: 'inject',
        dt: this.inAt,
        cs: tUs / 1000,
        seq: this.inSeq,
        type: key ? 'key' : 'delta',
        bytes: data.byteLength,
        rtp: this.lastRtp >>> 0,
        frameId: this.frameId,
        stuff: pad || undefined,
        qr: Math.max(0, -(this.out?.desiredSize ?? 0)),
        tpl: (this.tpl.key ? 1 : 0) | (this.tpl.delta ? 2 : 0) | (this.needKey ? 4 : 0) | (this.wantTemplates ? 8 : 0),
      })
    this.out?.enqueue(frame)
  }
}

const swaps = new WeakMap<RTCRtpSender, Swap>()
const senderPcs = new WeakMap<RTCRtpSender, RTCPeerConnection>()
const claims = new WeakMap<RTCRtpSender, () => { readable: ReadableStream; writable: WritableStream }>()

// A video sender's encoded streams, made by us as soon as the sender exists (createEncodedStreams only works before
// negotiation), with the swap stage in front. Until Discord asks for them (its DAVE worker) Chromium's frames go
// straight back into the sender; once it asks, it gets the swap's output and the sender's writable, so its
// encryption runs after the swap. Without DAVE nobody asks, and the swap still works.
function attachSwap(sender: RTCRtpSender, create: () => { readable: ReadableStream; writable: WritableStream }) {
  if (swaps.has(sender)) return
  let streams: { readable: ReadableStream; writable: WritableStream }
  try {
    streams = create.call(sender)
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
      const line = swap.lineOf(value)
      if (line) swap.wrote(line, 1 - ((sink.discord ? sink.discord.desiredSize : ours.desiredSize) ?? 1))
      if (sink.discord) sink.discord.enqueue(value)
      else await ours.write(value)
    }
  })().catch((e) => logger.error('Encoded frame relay failed', e))
  claims.set(sender, () => ({
    readable: new ReadableStream({ start: (c) => void (sink.discord = c) }),
    writable: new WritableStream({ write: (f) => ours.write(f) }),
  }))
}

if (navigator.userAgent.includes('Linux')) {
  // Discord's DAVE on the createEncodedStreams path (see the top of the file)
  delete (RTCRtpSender.prototype as any).transform
  const origCreate = (RTCRtpSender.prototype as any).createEncodedStreams

  const origAddTransceiver = RTCPeerConnection.prototype.addTransceiver
  RTCPeerConnection.prototype.addTransceiver = function (this: RTCPeerConnection, ...args: any[]) {
    const t = (origAddTransceiver as any).apply(this, args) as RTCRtpTransceiver
    if ((typeof args[0] === 'string' ? args[0] : args[0]?.kind) === 'video') {
      senderPcs.set(t.sender, this)
      attachSwap(t.sender, origCreate)
    }
    return t
  }
  const origAddTrack = RTCPeerConnection.prototype.addTrack
  RTCPeerConnection.prototype.addTrack = function (this: RTCPeerConnection, ...args: any[]) {
    const s = (origAddTrack as any).apply(this, args) as RTCRtpSender
    if (args[0]?.kind === 'video') {
      senderPcs.set(s, this)
      attachSwap(s, origCreate)
    }
    return s
  }

  ;(RTCRtpSender.prototype as any).createEncodedStreams = function (this: RTCRtpSender) {
    const claim = claims.get(this)
    if (!claim) return origCreate.call(this) // audio (or a sender we never saw made): untouched
    claims.delete(this)
    return claim()
  }
}

const active = new WeakSet<RTCRtpSender>()
export const isZeroCopy = (sender: RTCRtpSender) => active.has(sender)
/** The swap's counters (lab/bench). */
export const zeroCopyStats = (sender: RTCRtpSender) => swaps.get(sender)?.stats
/** capture's target controller (targetRate.ts), for the stream log. */
export const zeroCopyRate = (sender: RTCRtpSender) => (active.has(sender) ? swaps.get(sender)?.rateInfo() : undefined)

const sendCodec = (sender: RTCRtpSender) => sender.getParameters().codecs?.[0]?.mimeType?.toLowerCase()

export type SwapCodec = 'av1' | 'h264'
/** the codecs capture encodes, by the sender's negotiated mime type */
const SWAP_CODECS: Record<string, SwapCodec> = { 'video/av1': 'av1', 'video/h264': 'h264' }
const CODEC_NAMES: Record<SwapCodec, string> = { av1: 'AV1', h264: 'H.264' }
const swapCodec = (sender: RTCRtpSender): SwapCodec | undefined => SWAP_CODECS[sendCodec(sender) ?? '']

/**
 * Until the sender is negotiated to send (Discord puts the track on a recvonly transceiver, sets it sendrecv and
 * renegotiates; its codecs are there from the first negotiation already, so the direction tells): checked whenever its
 * connection's signaling state changes (the answer applied), and every 10 ms besides, for up to 10 s.
 */
async function negotiated(sender: RTCRtpSender) {
  const pc = senderPcs.get(sender)
  const sending = () => {
    const dir = pc?.getTransceivers().find((t) => t.sender === sender)?.currentDirection
    return !!sendCodec(sender) && (!pc || dir === 'sendonly' || dir === 'sendrecv')
  }
  const until = performance.now() + 10_000
  while (!sending() && performance.now() < until)
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        pc?.removeEventListener('signalingstatechange', done)
        resolve()
      }
      const timer = setTimeout(done, 10)
      pc?.addEventListener('signalingstatechange', done)
    })
}

/**
 * A Go Live track is on `sender`: send capture's video in place of Chromium's encode, if the track is a cast's.
 * `kbps`: the rate to start at (a resume after capture was started again keeps the one it had).
 */
export async function startZeroCopy(sender: RTCRtpSender, track: MediaStreamTrack, kbps?: number) {
  const session = castSessionFor(track)
  const swap = swaps.get(sender)
  // (Discord can have the track before capture is up: it's handed over at once, cast.ts)
  if (session?.state === 'starting') await session.up
  if (!session || session.state !== 'cast' || session.consumer || active.has(sender) || sender.track !== track) return
  if (!swap || swap.state === 'active') {
    logger.info("Not sending capture's video: no encoded-frame stage on this sender")
    return session.fallback('no encoded-frame stage')
  }
  active.add(sender)
  // only what capture encodes can be sent: wait for the negotiation
  await negotiated(sender)
  const codec = swapCodec(sender)
  if (!codec || !captureEncodes(codec)) {
    active.delete(sender)
    return session.fallback(
      codec
        ? `the stream is ${CODEC_NAMES[codec]}, which capture can't encode on this GPU`
        : `the stream is ${sendCodec(sender) ?? 'not negotiated'}, not AV1 or H.264`,
    )
  }
  if (sender.track !== track || session.state !== 'cast') return active.delete(sender)
  const max = sender.getParameters().encodings?.[0]?.maxBitrate ?? 9e6
  swap.start(session, sender, kbps ?? Math.min(6000, (max * 0.7) / 1000), codec)
  logger.info(`Streaming capture's ${CODEC_NAMES[codec]} (zero-copy)`)
  // capture was started again (cast.ts' recast): the same sender, the rate it had
  session.resume = () => {
    clearInterval(timer)
    active.delete(sender)
    startZeroCopy(sender, track, swap.kbps)
  }
  let lastHeight = 0 // capture starts at its --size (0); a scale Discord set before the session is sent at once
  let prev: { at: number; bytes: number; packets: number; delay: number } | null = null
  const timer = setInterval(async () => {
    if (swap.state !== 'active' || sender.track !== track) {
      clearInterval(timer)
      active.delete(sender)
      if (swap.state === 'active') swap.stop()
      return
    }
    const now = swapCodec(sender)
    if (!now || !captureEncodes(now)) return session.fallback(`the codec is now ${sendCodec(sender)}`)
    swap.setCodec(now)
    try {
      // capture's target (targetRate.ts): WebRTC's bandwidth estimate under Discord's cap, except where the
      // estimate only fell to our own app-limited rate (outbound-rtp's targetBitrate is the template encoder's)
      let bwe: number | undefined
      let bytes = 0
      let packets = 0
      let delay = 0
      let at = 0
      ;(await sender.getStats()).forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && r.availableOutgoingBitrate) bwe = r.availableOutgoingBitrate
        if (r.type === 'outbound-rtp') {
          bytes += r.bytesSent ?? 0
          packets += r.packetsSent ?? 0
          delay += r.totalPacketSendDelay ?? 0
          at = r.timestamp
        }
      })
      const dt = prev && at > prev.at ? (at - prev.at) / 1000 : 0
      const wire = dt && bytes >= prev!.bytes ? ((bytes - prev!.bytes) * 8) / dt : undefined
      const sendDelay =
        prev && packets > prev.packets ? ((delay - prev.delay) / (packets - prev.packets)) * 1000 : undefined
      prev = { at, bytes, packets, delay }
      const enc = sender.getParameters().encodings?.[0]
      swap.updateRate(bwe, enc?.maxBitrate ?? 9e6, wire, sendDelay)
      // the encoding's scale is only ever ours (streamQuality.ts drops Discord's, the viewers'): capture's size limit
      const scale = enc?.scaleResolutionDownBy ?? 1
      const height = scale > 1 ? Math.round(session.height / scale) : 0
      if (height !== lastHeight) {
        swap.setHeight(height)
        lastHeight = height
      }
    } catch {}
  }, 1000)
}
