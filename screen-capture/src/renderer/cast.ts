// Go Live on niri: mincord owns the capture. getDisplayMedia shows mincord's picker (host.pick) with niri's windows and
// outputs (or skips it for "Stream <game>"), the main process starts capture on the pick (src/main/cast.js), and Discord gets a
// MediaStreamTrackGenerator as its video track. The Go Live sender gets another one in its place (the hooks at the
// bottom), the encoder track:
// - while capture streams, the encoder track carries capture's 1 fps preview, upscaled to the stream's size.
//   Chromium encodes those frames, but only as templates: zeroCopy.ts sends capture's AV1 in their place. Discord's
//   track (its own preview and thumbnail) shows the same preview;
// - if the stream's codec isn't AV1 (a stock viewer's call), or capture's encoder fails (fallback()): capture keeps
//   its cast and hands its scaled frames over instead ("raw": GPU buffers, imported by main/raw.js and
//   preload/raw.js), they're piped into the encoder track and Chromium encodes them; no second source, no dialog;
// - if capture fails to start, dies or stalls, or raw doesn't come up: a normal getDisplayMedia (the portal's dialog,
//   Chromium reading the cast) is piped into the encoder track instead. Either way Discord's track shows the same
//   frames, and neither track object ever changes.
// The track's label, settings and constraints are the session's: Discord reads the label as the source id and the
// settings for its preview's size; its constraints go to the fallback capture.
// The sound, when Discord asks for it: capture's (main/cast.js picks the apps), as a third generator track in the
// stream Discord gets, which it sends as the stream's audio. It lasts as long as capture runs (raw included); the
// portal's fallback has none.

import { host } from './host'
import { logger as makeLogger } from './log'
import {
  applyToStreamConnection,
  isStreamSound,
  markStreamSound,
  setCurrentStreamQuality,
  StreamQuality,
  streamQuality,
  tuneStreamTrack,
} from './streamQuality'

const logger = makeLogger('mincord:cast')

declare class MediaStreamTrackGenerator<T = VideoFrame> extends MediaStreamTrack {
  constructor(init: { kind: 'video' | 'audio' })
  readonly writable: WritableStream<T>
}
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack })
  readonly readable: ReadableStream<VideoFrame>
}

/** A source for the picker (src/main/cast.js): id "window:<niri id>" / "output:<name>" */
export interface CastSource {
  id: string
  kind: 'window' | 'output'
  name: string
  detail: string
  width: number
  height: number
}

/** What the main process starts capture with: size is the box it fits the source into, e.g. [2560, 1440]. */
export interface CastStart {
  source: string
  size: [number, number]
  fps: number
  /** the stream has sound: capture sends it */
  audio?: boolean
}

/** What to stream: a capture source ("window:<niri id>" / "output:<name>"). */
export interface CastPick {
  source: string
  name: string
  width: number
  height: number
}

export type CastMessage =
  | { type: 'frame'; seq: number; t: number; key: boolean; w: number; h: number; data: ArrayBuffer }
  | { type: 'preview'; t: number; w: number; h: number; data: ArrayBuffer }
  | { type: 'audio'; t: number; rate: number; channels: number; data: ArrayBuffer }
  | { type: 'info'; t: number; info: any }
  | { type: 'closed'; why: string }

/** What zeroCopy.ts hooks into a session (the injection into the Go Live sender). */
export interface CastConsumer {
  message(m: CastMessage): void
  stop(): void
}

const sessions = new WeakMap<MediaStreamTrack, CastSession>()
/** The cast session behind a Go Live track, if our capture made it. */
export const castSessionFor = (track: MediaStreamTrack | null | undefined) => (track ? sessions.get(track) : undefined)

let portWaiter: ((p: MessagePort) => void) | null = null
let rawWaiter: ((p: MessagePort | null) => void) | null = null
window.addEventListener('message', (e) => {
  if (e.source === window && e.data?.mincordCastPort && e.ports[0]) portWaiter?.(e.ports[0])
  if (e.source === window && e.data?.mincordRawPort && e.ports[0]) rawWaiter?.(e.ports[0])
})

// capture's port and its first input (the cast's format) within this, or the session falls back to the portal
const START_TIMEOUT_MS = 6000
// capture's first raw buffer (its ring set up and imported) within this, or the fallback asks the portal
const RAW_TIMEOUT_MS = 3000
// Discord's track gets a frame at most this often (30 fps: its preview tile needs no more)
const SHOW_INTERVAL_MS = 30
// how long a fallback capture's first frames are held back, so Chromium's encoder learns their rate (feed)
const FALLBACK_WARMUP_MS = 1000

export class CastSession {
  /** Discord's track: its preview, its thumbnail, the stream's id */
  readonly track = new MediaStreamTrackGenerator({ kind: 'video' })
  /** what the sender gets in place of Discord's track (or a clone of it): only this one is encoded */
  readonly encoder = new MediaStreamTrackGenerator({ kind: 'video' })
  /** the stream's sound (capture's s16 PCM), when Discord asked for it */
  readonly audio: MediaStreamTrackGenerator<AudioData> | null
  state: 'starting' | 'cast' | 'fallback' | 'ended' = 'starting'
  /** capture's full-size encode size (the stream's size) */
  width: number
  height: number
  consumer: CastConsumer | null = null
  /** capture's last per-second stats (the lab's) */
  stats: any = null
  /** the fallback capture has fed the track long enough for Chromium's encoder to see its frame rate */
  warmedUp = false

  private port: MessagePort | null = null
  private writer = this.encoder.writable.getWriter()
  private display = this.track.writable.getWriter()
  private sound: WritableStreamDefaultWriter<AudioData> | null
  private shownAt = -Infinity
  private canvas: OffscreenCanvas | null = null
  private preview: VideoFrame | null = null
  private lastTs = 0
  private constraints: MediaTrackConstraints = {}
  private fallbackTrack: MediaStreamTrack | null = null
  /** raw: capture's frames feed the encoder (the fallback without a second source); its frames come on this port */
  private rawPort: MessagePort | null = null
  private rawFailed: () => void = () => {}
  private started: (ok: boolean) => void = () => {}

  constructor(
    readonly pick: CastPick,
    readonly quality: StreamQuality,
    private readonly displayMedia: (opts: DisplayMediaStreamOptions) => Promise<MediaStream>,
    withAudio = false,
  ) {
    this.audio = withAudio ? new MediaStreamTrackGenerator<AudioData>({ kind: 'audio' }) : null
    this.sound = this.audio?.writable.getWriter() ?? null
    if (this.audio) markStreamSound(this.audio)
    sessions.set(this.track, this)
    sessions.set(this.encoder, this)
    this.width = quality.width
    this.height = quality.height
    for (const t of [this.track, this.encoder]) this.dress(t)
  }

  // both tracks look the same to Discord and to streamQuality.ts: label, settings, constraints, stop
  private dress(t: MediaStreamTrackGenerator) {
    const [kind, id] = this.pick.source.split(/:(.*)/s)
    Object.defineProperty(t, 'label', { value: kind === 'output' ? `screen:${id}:0` : `window:niri-${id}:0` })
    t.getSettings = () =>
      this.fallbackTrack?.getSettings() ?? {
        width: this.width,
        height: this.height,
        frameRate: this.quality.fps,
        aspectRatio: this.width / this.height,
        deviceId: t.label,
        displaySurface: kind === 'output' ? 'monitor' : 'window',
        resizeMode: 'none',
      }
    t.getConstraints = () => this.constraints
    t.applyConstraints = async (c) => {
      this.constraints = c ?? {}
      await this.fallbackTrack?.applyConstraints(c)
    }
    const stop = t.stop.bind(t)
    t.stop = () => {
      this.end('track stopped')
      stop()
    }
  }

  /** capture is up (true) or didn't come up (false; the session then falls back). */
  up: Promise<boolean> = Promise.resolve(false)

  /** Starts capture; false if it doesn't come up (no capture, the cast failed). */
  start() {
    return (this.up = this.run())
  }

  private async run(): Promise<boolean> {
    const deadline = performance.now() + START_TIMEOUT_MS
    const port = new Promise<MessagePort | null>((resolve) => {
      portWaiter = resolve
      setTimeout(() => resolve(null), START_TIMEOUT_MS)
    })
    const ok = await host
      .native!.start({
        source: this.pick.source,
        size: [this.quality.width, this.quality.height],
        fps: this.quality.fps,
        audio: !!this.audio,
      })
      .catch(() => false)
    this.port = ok ? await port : null
    portWaiter = null
    if (!this.port) return false
    this.port.onmessage = ({ data }) => this.message(data)
    // up once capture has the cast's format (it reports the encode size)
    const up = await new Promise<boolean>((resolve) => {
      this.started = resolve
      setTimeout(() => resolve(false), deadline - performance.now())
    })
    this.started = () => {}
    if (up && this.state === 'starting') this.state = 'cast'
    return up && this.state !== 'ended'
  }

  send(command: object) {
    this.port?.postMessage(command)
  }

  private message(m: CastMessage) {
    if (m.type === 'audio') return this.writeAudio(m)
    if (this.state === 'fallback' && this.port) {
      // raw: capture failing now means the portal after all
      if (m.type === 'closed' || (m.type === 'info' && m.info.type === 'error')) this.rawFailed()
      else if (m.type === 'info' && m.info.type === 'stats') this.stats = m.info
      else if (m.type === 'info' && m.info.type === 'ended') this.end('the cast ended')
      return
    }
    if (this.state === 'ended' || this.state === 'fallback') return
    if (m.type === 'info') {
      const { info } = m
      if (info.type === 'stats') this.stats = info
      else if (info.type !== 'stage') logger.info('capture:', info)
      if (info.type === 'input') {
        this.width = info.encodeWidth || this.width
        this.height = info.encodeHeight || this.height
        this.started(true)
      } else if (info.type === 'ended') {
        // the window closed: the stream ends with it
        this.end('the cast ended')
      } else if (info.type === 'error') {
        this.started(false)
        if (this.state === 'cast') this.fallback(`capture: ${info.message}`)
      }
    } else if (m.type === 'preview') {
      this.setPreview(m)
    } else if (m.type === 'closed') {
      this.started(false)
      if (this.state === 'cast') this.fallback(`capture ${m.why}`, 'portal')
      return
    }
    this.consumer?.message(m)
  }

  private writeAudio(m: Extract<CastMessage, { type: 'audio' }>) {
    if (!this.sound || this.state === 'ended') return
    const data = new AudioData({
      format: 's16',
      sampleRate: m.rate,
      numberOfChannels: m.channels,
      numberOfFrames: m.data.byteLength / 2 / m.channels,
      timestamp: Math.round(m.t),
      data: m.data,
    })
    this.sound.write(data).catch(() => data.close())
  }

  private setPreview(m: Extract<CastMessage, { type: 'preview' }>) {
    this.preview?.close()
    this.preview = new VideoFrame(new Uint8Array(m.data), {
      format: 'BGRX',
      codedWidth: m.w,
      codedHeight: m.h,
      timestamp: 0,
    })
    this.writePreview()
  }

  // the track's frames are the stream's size less 2 px (alt: 4 px), so that the fallback's frames (the full size)
  // make Chromium reconfigure its encoder: its first frame sent is then a key frame. zeroCopy.ts writes alt frames
  // to get a key frame for its templates.
  private frameSize(alt: boolean) {
    return { w: Math.max(16, this.width - (alt ? 4 : 2)), h: this.height }
  }

  private write(frame: VideoFrame) {
    this.show(frame.clone())
    this.writer.write(frame).catch(() => frame.close())
  }

  /** A frame for Discord's track (at most every SHOW_INTERVAL_MS; others are dropped). */
  private show(frame: VideoFrame) {
    const now = performance.now()
    if (now - this.shownAt < SHOW_INTERVAL_MS) return frame.close()
    this.shownAt = now
    this.display.write(frame).catch(() => frame.close())
  }

  private nextTs() {
    return (this.lastTs = Math.max(this.lastTs + 1, Math.round(performance.now() * 1000)))
  }

  /**
   * The last preview into the track (Discord's own preview and thumbnail), upscaled to the track's size. zeroCopy.ts
   * writes these as its warm-up frames too (its templates). False: no preview yet, nothing written.
   */
  writePreview(alt = false): boolean {
    if (!this.preview || this.state === 'fallback' || this.state === 'ended') return false
    const { w, h } = this.frameSize(alt)
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) this.canvas = new OffscreenCanvas(w, h)
    const ctx = this.canvas.getContext('2d', { alpha: false })!
    ctx.drawImage(this.preview, 0, 0, w, h)
    this.write(new VideoFrame(this.canvas, { timestamp: this.nextTs() }))
    return true
  }

  /**
   * Chromium encodes from now on: capture's own frames (raw) while it runs, else a normal getDisplayMedia capture
   * (the portal's dialog). Resolves once one of them feeds the track (or the session has ended: no capture).
   */
  async fallback(why: string, how: 'raw' | 'portal' = 'raw') {
    if (this.state === 'fallback' || this.state === 'ended') return
    logger.warn(`Falling back to Chromium's encoder: ${why}`)
    this.state = 'fallback'
    this.consumer?.stop()
    this.consumer = null
    if (how === 'raw' && (await this.raw())) return
    if (this.state === 'fallback') await this.portal()
  }

  /** capture stops; a getDisplayMedia capture (the portal's dialog) feeds the track */
  private async portal() {
    this.closeCast()
    this.rawPort?.close()
    this.rawPort = null
    const { height, fps } = this.quality.chromium
    let track: MediaStreamTrack | undefined
    try {
      track = (await this.displayMedia({ video: { frameRate: fps }, audio: false })).getVideoTracks()[0]
      if (!track) throw new Error('no video track')
    } catch (e) {
      logger.error('Fallback capture failed', e)
      this.end('no fallback capture')
      return
    }
    if (this.state !== 'fallback') return void track.stop()
    // the stream's size and rate (Chromium reads every frame back and scales it on the CPU: asking for more than
    // is sent is pure cost)
    await track
      .applyConstraints({
        frameRate: { ideal: fps, max: fps },
        width: { max: Math.round((this.quality.width * height) / this.quality.height) },
        height: { max: height },
      })
      .catch((e) => logger.error('Fallback constraints failed', e))
    this.fallbackTrack = track
    track.addEventListener('ended', () => this.end('the capture ended'))
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    const warmUntil = performance.now() + FALLBACK_WARMUP_MS
    ;(async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (this.state === 'ended') {
          value.close()
          break
        }
        await this.feed(value, warmUntil)
      }
    })().catch((e) => logger.error('Fallback relay failed', e))
  }

  /**
   * capture's frames, not encoded (its "raw" command): its NV12 buffers in VRAM, a VideoFrame per frame. False if
   * they don't come (no fd socket: no addon; capture died) within RAW_TIMEOUT_MS.
   */
  private async raw(): Promise<boolean> {
    if (!this.port) return false
    const port = await new Promise<MessagePort | null>((resolve) => {
      rawWaiter = resolve
      this.rawFailed = () => resolve(null)
      setTimeout(() => resolve(null), RAW_TIMEOUT_MS)
      const { height, fps } = this.quality.chromium
      if (height < this.quality.height) this.send({ type: 'height', height })
      this.send({ type: 'fps', fps })
      this.send({ type: 'raw' })
    })
    rawWaiter = null
    if (!port || this.state !== 'fallback') {
      port?.close()
      if (this.state === 'fallback') logger.warn("capture's frames didn't come: asking for a source")
      return false
    }
    logger.info("Chromium encodes capture's frames")
    this.rawPort = port
    const warmUntil = performance.now() + FALLBACK_WARMUP_MS
    // (writes still pending past 2: Chromium's encoder is behind, the frame is dropped)
    let pending = 0
    this.rawFailed = () => {
      if (this.state !== 'fallback' || this.rawPort !== port) return
      logger.warn('capture stopped during raw')
      this.portal()
    }
    port.onmessage = ({ data }) => {
      const frame: VideoFrame = data.frame
      if (this.state !== 'fallback' || this.rawPort !== port || pending > 2) return frame.close()
      // the track's settings say the size Chromium encodes (1080p under a 1440p quality)
      this.width = frame.displayWidth
      this.height = frame.displayHeight
      pending++
      this.feed(frame, warmUntil).finally(() => pending--)
    }
    return true
  }

  /**
   * A fallback frame into the encoder track (and, at most every SHOW_INTERVAL_MS, Discord's). Warm-up: Chromium's
   * encoder had the preview at 1 fps, and sizes its first frames by the input rate it last saw (lab: 15-35 fps
   * received for 3 s after a fallback, over the bitrate cap). So the frames before `warmUntil` go in 2 px narrower
   * and aren't sent (zeroCopy.ts); then the full size makes the encoder start over on a key frame, knowing the rate.
   */
  private feed(value: VideoFrame, warmUntil: number) {
    let frame = value
    if (!this.warmedUp && performance.now() < warmUntil && value.visibleRect && value.visibleRect.width > 16) {
      const r = value.visibleRect
      frame = new VideoFrame(value, { visibleRect: { x: r.x, y: r.y, width: r.width - 2, height: r.height } })
      value.close()
    } else this.warmedUp = true
    this.show(frame.clone())
    return this.writer.write(frame).catch(() => frame.close())
  }

  /** Ends the stream: capture stops, the track ends (Discord ends the stream). */
  end(why: string) {
    if (this.state === 'ended') return
    logger.info(`Capture ended: ${why}`)
    this.state = 'ended'
    this.started(false)
    this.closeCast()
    this.rawPort?.close()
    this.rawPort = null
    this.fallbackTrack?.stop()
    this.writer.close().catch(() => {})
    this.display.close().catch(() => {})
    this.sound?.close().catch(() => {})
  }

  private closeCast() {
    this.consumer?.stop()
    this.consumer = null
    try {
      this.port?.postMessage({ type: 'stop' })
      this.port?.close()
    } catch {}
    this.port = null
    this.preview?.close()
    this.preview = null
  }
}

// The sender gets the encoder track wherever Discord puts its track (or a clone of it) on a connection. Discord's
// clones are Discord's track.
const clones = new WeakMap<MediaStreamTrack, CastSession>()
const displayed = (t: MediaStreamTrack | null | undefined) => {
  const s = t && (sessions.get(t) ?? clones.get(t))
  return s && t !== s.encoder ? s : undefined
}
const forSender = <T extends MediaStreamTrack | null | undefined>(t: T): T => (displayed(t)?.encoder as T) ?? t

const origClone = MediaStreamTrack.prototype.clone
MediaStreamTrack.prototype.clone = function (this: MediaStreamTrack) {
  const copy = origClone.call(this)
  if (isStreamSound(this)) markStreamSound(copy)
  const s = displayed(this)
  if (s) clones.set(copy, s)
  return copy
}
const origReplaceTrack = RTCRtpSender.prototype.replaceTrack
RTCRtpSender.prototype.replaceTrack = function (this: RTCRtpSender, track) {
  return origReplaceTrack.call(this, forSender(track))
}
const origAddTrack = RTCPeerConnection.prototype.addTrack
RTCPeerConnection.prototype.addTrack = function (this: RTCPeerConnection, track, ...streams) {
  return origAddTrack.call(this, forSender(track), ...streams)
}
const origAddTransceiver = RTCPeerConnection.prototype.addTransceiver
RTCPeerConnection.prototype.addTransceiver = function (this: RTCPeerConnection, trackOrKind, init) {
  return origAddTransceiver.call(this, typeof trackOrKind === 'string' ? trackOrKind : forSender(trackOrKind), init)
}

let available: Promise<boolean> | null = null
/** Whether getDisplayMedia goes through capture (niri, capture installed, the setting on). */
export const castAvailable = () => (available ??= host.native?.available().catch(() => false) ?? Promise.resolve(false))

let codecs: string[] | null = null
/** Whether capture encodes AV1 on this machine's GPU (true while unknown: capture's own error then falls back). */
export const captureAv1 = () => codecs?.includes('av1') ?? true
/** Asks capture once, at startup (the codec order is read when a call connects). */
export const probeCaptureCodecs = () =>
  host.native?.codecs().then(
    (c) => (codecs = c),
    () => {},
  )

let latest: CastSession | null = null
/** The newest cast session (live or ended), for stats and the lab. */
export const currentCast = () => latest

let pending: { pick: CastPick; at: number } | null = null
/** The next getDisplayMedia streams this, no picker ("Stream <game>"). */
export function setPendingCast(pick: CastPick | null) {
  pending = pick ? { pick, at: Date.now() } : null
}

/** getDisplayMedia through capture: mincord's picker (or the pending pick), then a cast session. */
export async function castDisplayMedia(
  displayMedia: (opts: DisplayMediaStreamOptions) => Promise<MediaStream>,
  opts?: DisplayMediaStreamOptions,
): Promise<MediaStream> {
  const p = pending && Date.now() - pending.at < 60_000 ? pending.pick : null
  pending = null
  // (cancelled: what Chromium's getDisplayMedia throws when its picker is cancelled)
  const pick =
    p ??
    (await Promise.resolve()
      .then(async () => host.pick!(await host.native!.sources()))
      .catch(() => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }))
  const quality = streamQuality(captureAv1())
  const session = (latest = new CastSession(pick, quality, displayMedia, !!opts?.audio))
  tuneStreamTrack(session.track)
  tuneStreamTrack(session.encoder)
  setCurrentStreamQuality(session.track, quality)
  try {
    applyToStreamConnection(quality)
  } catch (e) {
    logger.error('Failed to update stream connection quality', e)
  }
  logger.info(
    `${pick.name} (${pick.source}, ${pick.width}x${pick.height}): ${quality.height}p${quality.fps}` +
      (session.audio ? ', with sound' : ''),
  )
  // the track goes to Discord at once: capture starts (~40 ms: spawn, the cast, PipeWire, VA) while Discord sets
  // the stream up on its servers (STREAM_START ... RTC_CONNECTED, hundreds of ms), and only then does the track
  // reach a sender (zeroCopy.ts waits for the session to be up). A capture that doesn't come up falls back to
  // Chromium's capture into the same track, as one that fails later does.
  session.start().then((ok) => {
    if (!ok) session.fallback("capture didn't start", 'portal')
  })
  return new MediaStream(session.audio ? [session.track, session.audio] : [session.track])
}
