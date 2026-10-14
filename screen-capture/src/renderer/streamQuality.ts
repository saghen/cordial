// Go Live quality: the stream's size, frame rate and bitrate for the account, held on the Go Live sender whoever
// watches, and the Go Live connection's SDP (its start and max bitrate).

import { castSessionFor, currentCast } from './cast'
import { host } from './host'
import { logger as makeLogger } from './log'
import { attachSwap, startZeroCopy } from './zeroCopy'

const logger = makeLogger('cordial:quality')

// Discord's canStreamWithSettings (host.ts): whether the account (Nitro, or the server's boost level) may stream a
// resolution and frame rate.
const PRESET_CUSTOM = 3

function canStream(height: number, fps: number): boolean {
  try {
    const discord = host.discord!
    return discord.canStreamWithSettings(
      PRESET_CUSTOM,
      height,
      fps,
      discord.currentUser(),
      discord.voiceGuildPremiumTier(),
    )
  } catch (e) {
    // Discord moved the function (or no host yet); offer everything rather than nothing.
    logger.error('canStreamWithSettings unavailable', e)
    return true
  }
}

// ---- The stream's quality ----
//
// capture's AV1 (on the GPU) streams 1080p60 on every account, past Discord's rules for an account without Nitro
// (720p30) at that account's 3.5 Mbps, and 1440p60 with Nitro at 9 Mbps. Chromium's own encoders (raw and the portal:
// VP9 on the CPU for a stock viewer, libaom when capture's encoder fails) get 1080p, at 30 fps where the account may
// not stream 1080p60: VP9 at 3.5 Mbps needs the bits per pixel, and at 1440p60 its frames take longer than the frame
// interval (14.5 ms a frame on 4 threads).

export interface StreamQuality {
  /** capture's box: 16:9 at `height`, the source fitted into it (never scaled up) */
  width: number
  height: number
  fps: number
  /** what Chromium's own encoders get */
  chromium: { height: number; fps: number }
  /** Discord's bitrate for the account, bits/s */
  maxBitrate: number
}

/** The stream's quality for the account; `captureAv1`: capture encodes AV1 here (else Chromium encodes it all). */
export function streamQuality(captureAv1: boolean): StreamQuality {
  const nitro = canStream(1440, 60)
  const sixty = nitro || canStream(1080, 60)
  const chromium = { height: 1080, fps: sixty ? 60 : 30 }
  const { height, fps } = captureAv1 ? { height: nitro ? 1440 : 1080, fps: 60 } : chromium
  return { width: Math.round((height * 16) / 9), height, fps, chromium, maxBitrate: sixty ? 9_000_000 : 3_500_000 }
}

/** The quality of the stream that's live now. */
export function currentStreamQuality() {
  const cast = currentCast()
  return cast && cast.state !== 'ended' ? cast.quality : null
}

/** Writes the max resolution and frame rate onto our Go Live connection, which Discord's encoder setup reads. */
export function applyToStreamConnection(quality: StreamQuality) {
  const discord = host.discord
  const user = discord?.currentUser()
  const connection = discord && user && [...discord.connections()].find((entry) => entry.streamUserId === user.id)
  if (!connection) return
  const params = connection.videoStreamParameters[0]
  params.maxFrameRate = quality.fps
  params.maxResolution ??= { width: 0, height: 0 }
  params.maxResolution.width = quality.width
  params.maxResolution.height = quality.height
}

// ---- The Go Live sender ----

let liveSender: RTCRtpSender | null = null

/** The sender our newest Go Live track went on (status.ts). */
export const streamSender = () => liveSender

// The stream's sound goes out at up to 96 kbps, over the 64 kbps Discord gives every sound sender (its voice rate).
// Measured, not understood: at 64 kbps WebRTC's estimate fell to about 0.9 Mbps at its first backoff, a third of a
// second into every Nitro AV1 stream, and took 35 s to reach 9 Mbps; at 96 kbps it fell to about 4.4 Mbps and reached
// 9 Mbps in 12 s (a DM call).
const SOUND_BPS = 96_000
const soundTracks = new WeakSet<MediaStreamTrack>()

/** Marks a track as the stream's sound (cast.ts). */
export const markStreamSound = (track: MediaStreamTrack) => void soundTracks.add(track)
export const isStreamSound = (track: MediaStreamTrack | null | undefined) => Boolean(track && soundTracks.has(track))

function withSoundRate(sender: RTCRtpSender, params: RTCRtpSendParameters) {
  if (isStreamSound(sender.track)) for (const encoding of params.encodings ?? []) encoding.maxBitrate = SOUND_BPS
  return params
}

// As soon as someone watches, Discord's quality manager sets the stream to about 600 kbps per megapixel at 30 fps
// (2.2 Mbps for 1440p), and a scale for a viewer that shows it small. The stream stays at its quality whoever watches;
// with that lifted the same stream runs at 7-9.6 Mbps with no loss on a live call. Discord's server still holds the
// stream to the account's rate (its feedback keeps the bandwidth estimate at it).
function withQuality(sender: RTCRtpSender, params: RTCRtpSendParameters) {
  const encoding = params.encodings?.[0]
  const quality = castSessionFor(sender.track)?.quality
  if (!encoding || !quality) return params
  params.degradationPreference = 'balanced'
  encoding.maxBitrate = quality.maxBitrate
  encoding.maxFramerate = quality.fps
  encoding.scaleResolutionDownBy = 1
  return params
}

// Discord sets maxBitrate/maxFramerate/scaleResolutionDownBy through setParameters whenever its quality manager
// updates: ours replace them.
const originalSetParameters = RTCRtpSender.prototype.setParameters
RTCRtpSender.prototype.setParameters = function (this: RTCRtpSender, params, ...rest) {
  try {
    withSoundRate(this, withQuality(this, params))
  } catch (e) {
    logger.error('Failed to set the stream quality', e)
  }
  return originalSetParameters.call(this, params, ...rest)
}

// Discord only calls setParameters when its own numbers change, so also apply ours when our track is attached to a
// sender, and send capture's video from it (zeroCopy.ts).
function applyToSender(sender: RTCRtpSender) {
  const cast = castSessionFor(sender.track)
  if (!cast && !isStreamSound(sender.track)) return
  originalSetParameters
    .call(sender, withSoundRate(sender, withQuality(sender, sender.getParameters())))
    .catch((e) => logger.error('Failed to set the stream quality', e))
  if (!cast) return
  liveSender = sender
  startZeroCopy(sender, sender.track!).catch((e) => logger.error('Zero-copy failed to start', e))
}

const originalReplaceTrack = RTCRtpSender.prototype.replaceTrack
RTCRtpSender.prototype.replaceTrack = async function (this: RTCRtpSender, track) {
  await originalReplaceTrack.call(this, track)
  applyToSender(this)
}

// (a video sender's encoded streams are made as it is: zeroCopy.ts' attachSwap)
const originalAddTrack = RTCPeerConnection.prototype.addTrack
RTCPeerConnection.prototype.addTrack = function (this: RTCPeerConnection, ...args) {
  const sender = originalAddTrack.apply(this, args)
  if (args[0].kind === 'video') attachSwap(this, sender)
  applyToSender(sender)
  return sender
}

const originalAddTransceiver = RTCPeerConnection.prototype.addTransceiver
RTCPeerConnection.prototype.addTransceiver = function (this: RTCPeerConnection, ...args) {
  const transceiver = originalAddTransceiver.apply(this, args as Parameters<typeof originalAddTransceiver>)
  if ((typeof args[0] === 'string' ? args[0] : args[0].kind) === 'video') attachSwap(this, transceiver.sender)
  applyToSender(transceiver.sender)
  return transceiver
}

// ---- The Go Live connection's SDP ----
//
// Start bitrate: Discord's browser engine writes the remote SDP itself and sets only x-google-max-bitrate, so WebRTC
// starts every stream at its default 300 kbps. Chromium's encoder picks its first resolution from that (480x270 for a
// 1080p source) and climbs back one step every few seconds; capture's target follows the estimate. Starting near the
// cap gives full resolution at once, and the bandwidth estimator still backs off within a second or two if the uplink
// can't take it.
const START_FRACTION = 0.7
const START_MAX_KBPS = 6000

/** The rate a stream starts at under a max of `maxKbps` (the SDP's, and capture's first target). */
export const startKbps = (maxKbps: number) => Math.min(START_MAX_KBPS, Math.round(maxKbps * START_FRACTION))

const withStartBitrate = (sdp: string): string =>
  sdp.replace(
    /x-google-max-bitrate=(\d+)(?![^\r\n]*x-google-start-bitrate)/g,
    (match, max: string) => `${match};x-google-start-bitrate=${startKbps(Number(max))}`,
  )

// The stream's bitrate. Discord's browser engine writes x-google-max-bitrate=2500 into every connection's SDP
// (videoBitRate), and Chromium's own encoders (raw, the portal) hold their target at it whatever the estimate allows
// (live: VP9 sent 2.5 Mbps at a 4.2 Mbps estimate). libwebrtc seeds the send stream's max from the codec's
// x-google-max-bitrate when the stream is made, before the stream's track is on the sender
// (WebRtcVideoSendChannel::AddSendStream); a later x-google-max-bitrate only moves the estimate's ceiling, and only
// b=AS reaches the stream again (max_bandwidth_bps). So on the connection that sends the stream both become the
// stream's bitrate; Discord's server still caps the estimate (its REMB), capture's encoder never reads either.
const withMaxBitrate = (sdp: string, kbps: number): string =>
  sdp
    .replace(/x-google-max-bitrate=(\d+)/g, (match, max: string) =>
      Number(max) < kbps ? `x-google-max-bitrate=${kbps}` : match,
    )
    .split(/(?=\r\nm=)/)
    .map((section) =>
      section.startsWith('\r\nm=video') && !section.includes('\r\nb=AS:')
        ? section.replace(/\r\nc=[^\r\n]*/, `$&\r\nb=AS:${kbps}`)
        : section,
    )
    .join('')

const originalSetRemoteDescription = RTCPeerConnection.prototype.setRemoteDescription
RTCPeerConnection.prototype.setRemoteDescription = function (
  this: RTCPeerConnection,
  description: RTCSessionDescriptionInit,
  ...rest: unknown[]
) {
  try {
    if (description?.sdp?.includes('x-google-max-bitrate')) {
      const quality = this.getSenders()
        .map((sender) => castSessionFor(sender.track)?.quality)
        .find((candidate) => candidate)
      let sdp = description.sdp
      if (quality) sdp = withMaxBitrate(sdp, Math.round(quality.maxBitrate / 1000))
      description = { type: description.type, sdp: withStartBitrate(sdp) }
    }
  } catch (e) {
    logger.error('Failed to set the start bitrate', e)
  }
  return (originalSetRemoteDescription as any).call(this, description, ...rest)
} as typeof originalSetRemoteDescription
