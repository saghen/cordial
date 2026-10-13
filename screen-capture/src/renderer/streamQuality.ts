// Go Live quality: which resolution/frame-rate pairs the account may stream (Discord's own
// rules), which of them to stream at for a given source and codec, and how the stream trades
// resolution against frame rate once it's live.

import { host } from './host'
import { logger as makeLogger } from './log'
import { settings } from './settings'
import { isZeroCopy, startZeroCopy } from './zeroCopy'

const logger = makeLogger('mincord:quality')

export const StreamResolutions = ['480', '720', '1080', '1440', '2160'] as const
export const StreamFps = ['15', '30', '60'] as const
export type StreamResolution = (typeof StreamResolutions)[number]
export type StreamFps = (typeof StreamFps)[number]

/**
 * What to give up first when the encoder or the network can't keep up.
 * - balanced: drop both a little (WebRTC "balanced"), never down to a slideshow or a smear
 * - smoothness: keep the frame rate, drop resolution ("maintain-framerate")
 * - clarity: keep the resolution, drop frames ("maintain-resolution")
 */
export type StreamPriority = 'balanced' | 'smoothness' | 'clarity'

export const PriorityLabels: Record<StreamPriority, string> = {
  balanced: 'Balanced',
  smoothness: 'Smoothness',
  clarity: 'Clarity',
}

export const PriorityDescriptions: Record<StreamPriority, string> = {
  balanced: 'Lowers resolution and frame rate together when needed. Best for games.',
  smoothness: 'Keeps the frame rate; the picture goes soft when the bitrate runs short.',
  clarity: 'Keeps the picture sharp; the frame rate drops when the bitrate runs short. Best for text.',
}

const DegradationPreference: Record<StreamPriority, RTCDegradationPreference> = {
  balanced: 'balanced',
  smoothness: 'maintain-framerate',
  clarity: 'maintain-resolution',
}

// Discord's canStreamWithSettings (host.ts): its table of pairs, each free, Nitro-only, or allowed by the server's
// boost level.
const PRESET_CUSTOM = 3

// Discord calls the top resolution "source" (0); we offer it as 2160.
const discordResolution = (r: StreamResolution) => (r === '2160' ? 0 : Number(r))

export function canStream(resolution: StreamResolution, fps: StreamFps): boolean {
  try {
    const d = host.discord!
    return d.canStreamWithSettings(
      PRESET_CUSTOM,
      discordResolution(resolution),
      Number(fps),
      d.currentUser(),
      d.voiceGuildPremiumTier(),
    )
  } catch (e) {
    // Discord moved the function (or no host yet); offer everything rather than nothing.
    logger.error('canStreamWithSettings unavailable', e)
    return true
  }
}

export interface QualityChoice {
  resolution: StreamResolution
  frameRate: StreamFps
}

// Every account may stream 1080p30 (Liam, 2026-10-13: "Go with 1080p30 for both codecs"), past Discord's own rules for
// an account without Nitro (720p30), at Discord's bitrate for that account (3.5 Mbps). At 3.5 Mbps, 1080p30 beat
// 720p30 for AV1 on every lab clip and for VP9 on still content, even on games (LOG Key finds, "What 3.5 Mbps buys").
const ALWAYS: QualityChoice = { resolution: '1080', frameRate: '30' }
const always = (r: StreamResolution, f: StreamFps) => r === ALWAYS.resolution && f === ALWAYS.frameRate

/** Every allowed pair, by resolution: Discord's, and 1080p30. */
export function allowedQualities(): Map<StreamResolution, StreamFps[]> {
  const out = new Map<StreamResolution, StreamFps[]>()
  for (const r of StreamResolutions) {
    const fps = StreamFps.filter((f) => canStream(r, f) || always(r, f))
    if (fps.length) out.set(r, fps)
  }
  return out
}

// ---- Automatic resolution / frame rate ----

export const StreamCodecs = ['AV1', 'H264', 'VP9', 'VP8'] as const
export type StreamCodec = (typeof StreamCodecs)[number]

export const CodecNames: Record<StreamCodec, string> = { AV1: 'AV1', H264: 'H.264', VP9: 'VP9', VP8: 'VP8' }

let encodable: StreamCodec[] | undefined

/** Codecs this client can encode video in, in StreamCodecs order. */
export function encodableCodecs(): StreamCodec[] {
  if (encodable) return encodable
  try {
    const mimes = new Set(RTCRtpSender.getCapabilities?.('video')?.codecs.map((c) => c.mimeType.toLowerCase()))
    encodable = StreamCodecs.filter((c) => mimes.has(`video/${c.toLowerCase()}`))
  } catch (e) {
    logger.error('Failed to read video encoder capabilities', e)
    encodable = []
  }
  return encodable
}

/** The codec the stream will (most likely) be sent in: the preferred one if this client can encode it. */
export function effectiveCodec(preferred: StreamCodec = settings.codec): StreamCodec {
  const codecs = encodableCodecs()
  if (codecs.includes(preferred)) return preferred
  // Discord's own order otherwise leads with H.264
  return (['H264', 'VP8', 'VP9'] as const).find((c) => codecs.includes(c)) ?? 'H264'
}

// Discord's per-stream bitrate cap (web bundle constants): 9 Mbps above 720p, above 30 fps or at
// source resolution, else 3.5 Mbps.
const HIGH_MAX_BITRATE = 9_000_000
const LOW_MAX_BITRATE = 3_500_000

export function discordMaxBitrate(resolution: StreamResolution, frameRate: StreamFps): number {
  return resolution === '2160' || Number(resolution) > 720 || Number(frameRate) > 30
    ? HIGH_MAX_BITRATE
    : LOW_MAX_BITRATE
}

// Fewest bits per pixel per frame (at Discord's cap for the pair) worth streaming at. Measured on
// Deadlock footage at Discord's 9 Mbps cap, scored against the 4K original (Equibop lab/runs/res4k):
// - AV1 (libaom): 1440p60 (0.041 bpp) 34.0 dB / SSIM 0.923 at 3.9 cores vs 1080p60 (0.072 bpp)
//   33.7 dB / 0.928 at 2.9 cores on fast motion, but on a still desktop 1440p60 is far better
//   (0.950 vs 0.914; lab/runs/desktop). So AV1 streams 1440p60 and the motion scaler below sends
//   1080p while the motion is too much for the bitrate.
// - H.264 (VA-API): 1080p60 32.8 dB / 0.916; asked for 1440p60 it degrades to 960p (29.1 dB),
//   for 4K60 to 720p.
// 30 fps raises per-frame quality 1.5-2 dB but judders on game motion (Equibop lab/runs/codec1), so 60 fps
// is preferred whenever a 60 fps pair clears the floor.
const AV1_MIN_BPP = 0.04
const VP9_MIN_BPP = 0.055
const H264_MIN_BPP = 0.06
const VP8_MIN_BPP = 0.06

const MinBitsPerPixel: Record<StreamCodec, number> = {
  AV1: AV1_MIN_BPP,
  VP9: VP9_MIN_BPP,
  H264: H264_MIN_BPP,
  VP8: VP8_MIN_BPP,
}

export interface Size {
  width: number
  height: number
}

export interface AutoQuality extends QualityChoice {
  codec: StreamCodec
  /** Largest capture size: what the track constraints and Discord's maxResolution get. */
  width: number
  height: number
  /** Discord's bitrate cap for this pair (for 1080p30 past Discord's rules: the account's own, 3.5 Mbps), in bits/s */
  maxBitrate: number
  /** the pair is past Discord's rules for the account (1080p30 without Nitro): its maxBitrate is a ceiling too */
  pastDiscord: boolean
  /** Bits per encoded pixel per frame at that cap. */
  bitsPerPixel: number
}

/** Assumed source when its size isn't known yet (the picker, before getDisplayMedia resolves). */
export const UNKNOWN_SOURCE: Size = { width: 3840, height: 2160 }

/** The biggest box a resolution allows: 16:9 at that height, or the source's own size for "source". */
function captureBox(resolution: StreamResolution, source: Size): Size {
  if (resolution === '2160') return { width: source.width, height: source.height }
  const height = Number(resolution)
  return { width: Math.round(height * (16 / 9)), height }
}

/** Pixels actually encoded: the source scaled down (never up) to fit the box, keeping its aspect. */
function encodedPixels(box: Size, source: Size): number {
  const scale = Math.min(1, box.width / source.width, box.height / source.height)
  return Math.round(source.width * scale) * Math.round(source.height * scale)
}

/**
 * Picks the resolution and frame rate for a stream: among the pairs the account may stream, 60 fps
 * at the highest resolution whose bits per pixel at Discord's cap clear the codec's floor, never
 * above the source; else the same at 30 fps; else the lowest allowed pair.
 */
export function autoQuality(
  source: Size | undefined,
  codec: StreamCodec,
  allowed: Map<StreamResolution, StreamFps[]> = allowedQualities(),
): AutoQuality {
  const src = source?.width && source.height ? source : UNKNOWN_SOURCE
  // The source's height rounded down to a tier; anything below 480 still streams at the 480 tier.
  const sourceTier = StreamResolutions.filter((r) => Number(r) <= src.height).at(-1) ?? StreamResolutions[0]

  const describe = (resolution: StreamResolution, frameRate: StreamFps): AutoQuality => {
    const box = captureBox(resolution, src)
    const pastDiscord = always(resolution, frameRate) && !canStream(resolution, frameRate)
    const maxBitrate = pastDiscord ? LOW_MAX_BITRATE : discordMaxBitrate(resolution, frameRate)
    const bitsPerPixel = maxBitrate / (encodedPixels(box, src) * Number(frameRate))
    return { resolution, frameRate, codec, ...box, maxBitrate, bitsPerPixel, pastDiscord }
  }

  const pairs = [...allowed]
    .filter(([r]) => Number(r) <= Number(sourceTier))
    .flatMap(([r, fps]) => fps.map((f) => describe(r, f)))
  const byResolution = (a: AutoQuality, b: AutoQuality) => Number(a.resolution) - Number(b.resolution)

  for (const fps of ['60', '30'] as const) {
    const best = pairs
      .filter((p) => p.frameRate === fps && p.bitsPerPixel >= MinBitsPerPixel[codec])
      .sort(byResolution)
      .at(-1)
    if (best) return best
  }

  const lowestResolution = [...allowed.keys()].sort((a, b) => Number(a) - Number(b))[0]
  if (!lowestResolution) return describe('720', '30')
  const lowestFps = [...allowed.get(lowestResolution)!].sort((a, b) => Number(a) - Number(b))[0]
  return describe(lowestResolution, lowestFps)
}

/** e.g. "1440p60" (the source's own height at source resolution). */
export const qualityLabel = (q: AutoQuality) => `${q.height}p${q.frameRate}`

let current: AutoQuality | null = null

/** The quality of the stream that's live now, as chosen once its source size was known. */
export const currentStreamQuality = () => current

/** Records the live stream's quality until its track ends. */
export function setCurrentStreamQuality(track: MediaStreamTrack, q: AutoQuality) {
  current = q
  track.addEventListener('ended', () => {
    if (current === q) current = null
  })
}

/** Writes the max resolution and frame rate onto our Go Live connection, which Discord's encoder setup reads. */
export function applyToStreamConnection(q: AutoQuality): boolean {
  const d = host.discord
  const user = d?.currentUser()
  const conn = d && user && [...d.connections()].find((connection) => connection.streamUserId === user.id)
  if (!conn) return false
  const params = conn.videoStreamParameters[0]
  params.maxFrameRate = Number(q.frameRate)
  params.maxResolution ??= { width: 0, height: 0 }
  params.maxResolution.width = q.width
  params.maxResolution.height = q.height
  return true
}

// ---- Live stream tuning ----

let priority: StreamPriority = 'balanced'
const streamTracks = new WeakSet<MediaStreamTrack>()

/** Whether a track is a Go Live track we set up (for stats, overlays). */
export const isStreamTrack = (track: MediaStreamTrack | null | undefined) => !!track && streamTracks.has(track)

const streamAudio = new WeakSet<MediaStreamTrack>()
/** Marks a track as the stream's sound (cast.ts): its sender gets STREAM_OPUS_KBPS. */
export const markStreamAudio = (track: MediaStreamTrack) => void streamAudio.add(track)
export const isStreamAudio = (track: MediaStreamTrack | null | undefined) => !!track && streamAudio.has(track)

// Discord caps the sender at 64 kbps (its voice rate) whatever the fmtp's maxaveragebitrate says
function withAudioRate(sender: RTCRtpSender, params: RTCRtpSendParameters) {
  if (isStreamAudio(sender.track)) for (const e of params.encodings ?? []) e.maxBitrate = STREAM_OPUS_KBPS * 1000
  return params
}

/** Marks a getDisplayMedia track as ours and sets how it degrades. */
export function tuneStreamTrack(track: MediaStreamTrack, p: StreamPriority) {
  priority = p
  streamTracks.add(track)
  // "motion" keeps WebRTC out of screen-content mode (QP floor, aggressive frame dropping).
  // "detail" is what clarity wants: screen-content mode suits text.
  track.contentHint = p === 'clarity' ? 'detail' : 'motion'
}

function withPreference(sender: RTCRtpSender, params: RTCRtpSendParameters) {
  if (isStreamTrack(sender.track)) {
    params.degradationPreference = DegradationPreference[priority]
    // As soon as someone watches, Discord's quality manager sets the stream to about 600 kbps per
    // megapixel at 30 fps (2.2 Mbps for 1440p), far under the 9 Mbps and 60 fps the plan allows; on a
    // live call (2026-10-11) the same stream ran at 7-9.6 Mbps with no loss once this was lifted.
    // Discord's server still holds the stream to the plan: its feedback keeps the bandwidth
    // estimate at exactly 9 Mbps, so a higher maxBitrate gains nothing.
    const enc = params.encodings?.[0]
    const q = currentStreamQuality()
    if (enc && q) {
      if (enc.maxBitrate != null && enc.maxBitrate < q.maxBitrate) enc.maxBitrate = q.maxBitrate
      // (Discord sizes the bitrate for the 1080p it's told: the account's own cap still holds)
      if (q.pastDiscord && (enc.maxBitrate == null || enc.maxBitrate > q.maxBitrate)) enc.maxBitrate = q.maxBitrate
      if (enc.maxFramerate != null && enc.maxFramerate < Number(q.frameRate)) enc.maxFramerate = Number(q.frameRate)
    }
  }
  return params
}

// ---- Motion scaling ----
//
// Above 1080p (AV1's 1440p60), fast game motion looks better at 1080p for the same bitrate and
// anything calmer much better at full size (see AV1_MIN_BPP). So while the encoder's QP (AV1
// qindex 0-255; Deadlock at 1440p runs 160-205, at 1080p 140-185) stays high, the stream is sent at
// 1080p through scaleResolutionDownBy, and at full size again once it settles. Each switch costs a
// keyframe, hence the dwell. On a desktop-then-Deadlock clip (Equibop lab/runs/motion) this beats fixed
// 1440p on both parts: shown SSIM 0.9877 / 0.9406 vs 0.9855 / 0.9336. WebRTC's own quality scaler,
// even retuned (WebRTC-Video-BalancedDegradationSettings), reacts ~5 s late and backs off after
// climbing back, ending below fixed 1440p (0.9735 / 0.9313). Not for "clarity", which keeps the
// resolution by definition. Equibop lab/bench's cfg.motionScale runs the same numbers.
const MOTION = { down: 185, up: 145, downSecs: 3, upSecs: 6, dwell: 8, warmup: 5 }
const MOTION_HEIGHT = 1080

// Per sender: our extra downscale (1: full size)
const motion = new WeakMap<RTCRtpSender, { factor: number; running?: boolean }>()

/**
 * Only our scale: Discord's own scaleResolutionDownBy (viewers who want fewer pixels) is dropped, the stream stays
 * at the quality's size whoever watches (Liam, 2026-10-13: "We always want to stream the max quality, regardless of
 * size of the viewer"). The track is already at that size (capture's --size, the fallback's constraints).
 */
function withMotionScale(sender: RTCRtpSender, params: RTCRtpSendParameters) {
  const enc = params.encodings?.[0]
  if (!enc || !isStreamTrack(sender.track)) return params
  let m = motion.get(sender)
  if (!m) motion.set(sender, (m = { factor: 1 }))
  enc.scaleResolutionDownBy = m.factor
  return params
}

// Only Chromium's own encoder (libaom: no capture, or its fallback)
function startMotionScaler(sender: RTCRtpSender) {
  withMotionScale(sender, sender.getParameters())
  const m = motion.get(sender)
  if (!m || m.running) return
  m.running = true
  let tick = 0
  let since = 0
  let qps: number[] = []
  let prev: { qpSum: number; framesEncoded: number } | null = null

  const setFast = (fast: boolean, why: string) => {
    // from the capture's real height: it can be smaller than the chosen quality (a small window), and scaling a
    // 1080p capture by 1440/1080 would send 810p
    const height = sender.track?.getSettings().height ?? 0
    const factor = fast && height > MOTION_HEIGHT ? height / MOTION_HEIGHT : 1
    if (m.factor === factor) return
    m.factor = factor
    since = tick
    qps = []
    logger.info(`Motion scaling: ${fast ? `${MOTION_HEIGHT}p` : 'full size'} (${why})`)
    origSetParameters
      .call(sender, withMotionScale(sender, withPreference(sender, sender.getParameters())))
      .catch((e) => logger.error('Failed to apply motion scaling', e))
  }
  const reset = (why: string) => {
    prev = null
    setFast(false, why)
  }

  const timer = setInterval(async () => {
    const { track } = sender
    if (!track || !isStreamTrack(track) || track.readyState === 'ended') {
      clearInterval(timer)
      m.running = false
      return
    }
    if (isZeroCopy(sender)) return reset('capture encodes')
    tick++
    let out: any
    let codec: string | undefined
    try {
      const stats = await sender.getStats()
      stats.forEach((s) => {
        if (s.type === 'outbound-rtp' && s.kind === 'video') out = s
      })
      codec = out?.codecId ? stats.get(out.codecId)?.mimeType : undefined
    } catch {
      return // a renegotiation in progress; the next tick tries again
    }
    if (!out || !currentStreamQuality() || (track.getSettings().height ?? 0) <= MOTION_HEIGHT || priority === 'clarity')
      return reset('not above 1080p')
    // The QP thresholds are AV1's; another codec (a viewer without AV1) can't hold 1440p60 at 9 Mbps anyway.
    if (codec && codec !== 'video/AV1') return setFast(true, `${codec} negotiated`)
    const cur = { qpSum: out.qpSum ?? 0, framesEncoded: out.framesEncoded ?? 0 }
    const frames = prev ? cur.framesEncoded - prev.framesEncoded : 0
    if (prev && frames > 0) qps.push((cur.qpSum - prev.qpSum) / frames)
    prev = cur
    if (!frames || tick < MOTION.warmup || tick - since < MOTION.dwell) return
    const mean = (n: number) => qps.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, qps.length)
    if (m.factor === 1 && qps.length >= MOTION.downSecs && mean(MOTION.downSecs) > MOTION.down)
      setFast(true, `QP ${mean(MOTION.downSecs).toFixed(0)}`)
    else if (m.factor !== 1 && qps.length >= MOTION.upSecs && mean(MOTION.upSecs) < MOTION.up)
      setFast(false, `QP ${mean(MOTION.upSecs).toFixed(0)}`)
  }, 1000)
}

// Discord sets maxBitrate/maxFramerate/scaleResolutionDownBy through setParameters whenever its
// quality manager updates; ride along: degradation preference, bitrate cap, motion scale.
const origSetParameters = RTCRtpSender.prototype.setParameters
RTCRtpSender.prototype.setParameters = function (this: RTCRtpSender, params, ...rest) {
  try {
    withAudioRate(this, withMotionScale(this, withPreference(this, params)))
  } catch (e) {
    logger.error('Failed to set degradation preference', e)
  }
  return origSetParameters.call(this, params, ...rest)
}

// ---- Start bitrate ----
//
// Discord's browser engine writes the remote SDP itself and sets only x-google-max-bitrate, so
// WebRTC starts every stream at its default 300 kbps. The encoder picks its first resolution
// from that (480x270 for a 1080p source) and climbs back one step every few seconds: the first
// half minute of every stream is a smear. Starting near the cap gives full resolution at once,
// and the bandwidth estimator still backs off within a second or two if the uplink can't take it.
const START_FRACTION = 0.7
const START_MAX_KBPS = 6000

export function withStartBitrate(sdp: string): string {
  return sdp.replace(/x-google-max-bitrate=(\d+)(?![^\r\n]*x-google-start-bitrate)/g, (match, max: string) => {
    const start = Math.min(START_MAX_KBPS, Math.round(Number(max) * START_FRACTION))
    return `${match};x-google-start-bitrate=${start}`
  })
}

// Setting "goLiveMinBitrate" (experimental, off): a floor under the Go Live connection's bandwidth estimate,
// x-google-min-bitrate next to Discord's x-google-max-bitrate (WebRTC's min bitrate, which bounds the estimate from
// below: MinAllocAsLowerBound), so an estimate cut can't fall to a still screen's rate (live: 4.9 Mbps -> 70 kbps).
// Only on the connection that sends the stream (its track is on a sender when Discord renegotiates to send it), so
// voice and cameras are untouched. A real uplink under the floor then queues: zeroCopy.ts' pacer-delay guard cuts
// capture's target, but the estimate (and the pacing rate) stay at the floor.
const MIN_FRACTION = 0.5

export function withMinBitrate(sdp: string): string {
  return sdp.replace(/x-google-max-bitrate=(\d+)(?![^\r\n]*x-google-min-bitrate)/g, (match, max: string) => {
    return `${match};x-google-min-bitrate=${Math.round(Number(max) * MIN_FRACTION)}`
  })
}

// ---- The stream's sound in stereo ----
//
// Discord's browser engine writes no stereo for Opus: the stream's sound (cast.ts, capture's) went out mono at 64 kbps,
// and a viewer decodes mono. libwebrtc's Opus encoder takes its channels and rate from the remote description's
// fmtp, the decoder its channels from the local one. So on Go Live connections only (Discord's context "stream":
// ours, sending, and those we watch), stereo=1 both ways and 96 kbps for what we send; voice keeps Discord's mono.
const STREAM_OPUS_KBPS = 96

/** Discord's context of a connection ("default" for voice, "stream" for Go Live): the one holding `pc`, a level down. */
function contextOf(pc: RTCPeerConnection): string | undefined {
  for (const c of host.discord?.connections() ?? [])
    for (const v of Object.values(c ?? {}))
      if (v === pc || (v && typeof v === 'object' && Object.values(v).includes(pc))) return c.context
  return undefined
}

const stereoLogged = new WeakSet<RTCPeerConnection>()
function stereo<T extends RTCLocalSessionDescriptionInit>(pc: RTCPeerConnection, desc: T, kbps?: number): T {
  if (!desc.sdp || contextOf(pc) !== 'stream') return desc
  if (!stereoLogged.has(pc)) logger.info('Go Live connection: Opus in stereo')
  stereoLogged.add(pc)
  return { ...desc, sdp: withStereo(desc.sdp, kbps) }
}

/** Opus's fmtp lines with stereo (both ways) and, when given, its average rate: every m-section's (a stream's
 * connection has two audio sections on the same payload type, the stream's sound in the second) */
export function withStereo(sdp: string, kbps?: number): string {
  const pts = new Set([...sdp.matchAll(/a=rtpmap:(\d+) opus\/48000\/2/gi)].map(([, pt]) => pt))
  for (const pt of pts) {
    sdp = sdp.replace(new RegExp(`(a=fmtp:${pt} )([^\r\n]*)`, 'g'), (_, head: string, params: string) => {
      const set: Record<string, string> = { stereo: '1', 'sprop-stereo': '1' }
      if (kbps) set.maxaveragebitrate = String(kbps * 1000)
      const kept = params.split(';').filter((kv) => kv && !(kv.split('=')[0] in set))
      return head + [...kept, ...Object.entries(set).map(([k, v]) => `${k}=${v}`)].join(';')
    })
  }
  return sdp
}

const origSetLocalDescription = RTCPeerConnection.prototype.setLocalDescription
RTCPeerConnection.prototype.setLocalDescription = function (
  this: RTCPeerConnection,
  desc?: RTCLocalSessionDescriptionInit,
  ...rest: unknown[]
) {
  try {
    if (desc) desc = stereo(this, desc)
  } catch (e) {
    logger.error('Failed to set stereo', e)
  }
  return (origSetLocalDescription as any).call(this, desc, ...rest)
} as typeof origSetLocalDescription

const origSetRemoteDescription = RTCPeerConnection.prototype.setRemoteDescription
RTCPeerConnection.prototype.setRemoteDescription = function (
  this: RTCPeerConnection,
  desc: RTCSessionDescriptionInit,
  ...rest: unknown[]
) {
  try {
    if (desc?.sdp?.includes('x-google-max-bitrate')) desc = { type: desc.type, sdp: withStartBitrate(desc.sdp) }
    if (
      desc?.sdp?.includes('x-google-max-bitrate') &&
      settings.goLiveMinBitrate &&
      this.getSenders().some((s) => isStreamTrack(s.track))
    ) {
      desc = { type: desc.type, sdp: withMinBitrate(desc.sdp!) }
      logger.info('Go Live connection: bandwidth estimate floor at', MIN_FRACTION, "x Discord's max bitrate")
    }
    if (desc) desc = stereo(this, desc, STREAM_OPUS_KBPS)
  } catch (e) {
    logger.error('Failed to set start bitrate', e)
  }
  return (origSetRemoteDescription as any).call(this, desc, ...rest)
} as typeof origSetRemoteDescription

// Discord only calls setParameters when its own numbers change, so also apply the preference
// when our track is attached to a sender.
function applyToSender(sender: RTCRtpSender) {
  if (isStreamAudio(sender.track))
    origSetParameters
      .call(sender, withAudioRate(sender, sender.getParameters()))
      .catch((e) => logger.error('Failed to set the sound bitrate', e))
  if (!sender.track || !streamTracks.has(sender.track)) return
  origSetParameters
    .call(sender, withMotionScale(sender, withPreference(sender, sender.getParameters())))
    .catch((e) => logger.error('Failed to set degradation preference', e))
  startMotionScaler(sender)
  startZeroCopy(sender, sender.track).catch((e) => logger.error('Zero-copy failed to start', e))
}

const origReplaceTrack = RTCRtpSender.prototype.replaceTrack
RTCRtpSender.prototype.replaceTrack = async function (this: RTCRtpSender, track) {
  await origReplaceTrack.call(this, track)
  applyToSender(this)
}

const origAddTrack = RTCPeerConnection.prototype.addTrack
RTCPeerConnection.prototype.addTrack = function (this: RTCPeerConnection, ...args) {
  const sender = origAddTrack.apply(this, args)
  applyToSender(sender)
  return sender
}

const origAddTransceiver = RTCPeerConnection.prototype.addTransceiver
RTCPeerConnection.prototype.addTransceiver = function (this: RTCPeerConnection, ...args) {
  const transceiver = origAddTransceiver.apply(this, args as Parameters<typeof origAddTransceiver>)
  applyToSender(transceiver.sender)
  return transceiver
}
