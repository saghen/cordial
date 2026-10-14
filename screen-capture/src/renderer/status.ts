// The stream's status: what goes to Discord, from the sender's stats once a second. When capture encodes (zeroCopy.ts)
// the encoder's numbers are capture's: Chromium's encoder only makes the frames capture's replace.

import { castSessionFor } from './cast'
import { streamSender } from './streamQuality'
import { isZeroCopy } from './zeroCopy'

const QP_MAX: Record<string, number> = { AV1: 255, VP9: 255, VP8: 127, H264: 51 }

export interface StreamStatus {
  lines: string[]
  /** one line: codec, height, fps, Mbps */
  summary: string
  /** held back by the CPU or the bandwidth */
  limited: boolean
}

let last: { sender: RTCRtpSender; t: number; bytes: number; frames: number; qpSum: number } | null = null

const mbps = (bps: number | undefined) => (bps === undefined || isNaN(bps) ? '?' : (bps / 1e6).toFixed(1))
const round = (n: number | undefined) => (n === undefined || isNaN(n) ? '?' : String(Math.round(n)))

/** The numbers since the last call (call it once a second); null while nothing streams. */
export async function streamStatus(): Promise<StreamStatus | null> {
  const sender = streamSender()
  const session = castSessionFor(sender?.track)
  if (!sender || !session || session.state === 'ended') return null
  const stats = [...(await sender.getStats()).values()]
  const byId = (id: string | undefined) => stats.find((s) => s.id === id)
  const rtp = stats.find((s) => s.type === 'outbound-rtp')
  if (!rtp) return null
  const pair = byId(byId(rtp.transportId)?.selectedCandidatePairId)
  const source = byId(rtp.mediaSourceId)
  const codec = byId(rtp.codecId)?.mimeType?.split('/')[1]?.toUpperCase()

  const prev = last?.sender === sender ? last : null
  last = { sender, t: rtp.timestamp, bytes: rtp.bytesSent, frames: rtp.framesEncoded ?? 0, qpSum: rtp.qpSum ?? 0 }
  const dt = prev ? (last.t - prev.t) / 1000 : 0
  const per = (n: number, p: number | undefined) => (dt > 0 && p !== undefined ? (n - p) / dt : undefined)
  const bitrate = (per(last.bytes, prev?.bytes) ?? NaN) * 8
  const frames = prev ? last.frames - prev.frames : 0

  const cast = isZeroCopy(sender) ? session.stats : null
  const s = cast
    ? {
        encoder: 'capture (VA-API)',
        width: cast.width,
        height: cast.height,
        fps: cast.fps,
        captured: ` (captured @ ${round(cast.in)})`,
        target: cast.target * 1000,
        qp: undefined,
        limitation: cast.dropper || cast.outDrops ? 'bandwidth' : 'none',
      }
    : {
        // (Chromium only says which without a camera or microphone permission)
        encoder:
          rtp.encoderImplementation && rtp.encoderImplementation + (rtp.powerEfficientEncoder ? ' (HW)' : ' (SW)'),
        width: rtp.frameWidth,
        height: rtp.frameHeight,
        fps: per(last.frames, prev?.frames),
        captured: source?.width
          ? ` (captured ${source.width}×${source.height} @ ${round(source.framesPerSecond)})`
          : '',
        target: rtp.targetBitrate,
        qp: frames > 0 ? (last.qpSum - prev!.qpSum) / frames : undefined,
        limitation: rtp.qualityLimitationReason,
      }
  const network = [`${mbps(bitrate)} / ${mbps(s.target)} Mbps`]
  if (pair?.availableOutgoingBitrate !== undefined) network.push(`BWE ${mbps(pair.availableOutgoingBitrate)} Mbps`)
  if (pair?.currentRoundTripTime !== undefined) network.push(`RTT ${round(pair.currentRoundTripTime * 1000)} ms`)
  return {
    lines: [
      (codec ?? '?') + (s.encoder ? ` · ${s.encoder}` : ''),
      `${s.width ?? '?'}×${s.height ?? '?'} @ ${round(s.fps)} fps${s.captured}`,
      network.join(' · '),
      ...(s.qp === undefined ? [] : [`QP ${round(s.qp)} /${QP_MAX[codec!] ?? '?'}`]),
      // capture's sample: a frame once a second against what its encoder made of it
      ...(cast?.ssim === undefined ? [] : [`SSIM ${cast.ssim.toFixed(3)}`]),
      `limited by: ${s.limitation ?? '?'}`,
    ],
    summary: `${codec ?? '?'} ${s.height ?? '?'}p${round(s.fps)} ${mbps(bitrate)} Mbps`,
    limited: s.limitation === 'cpu' || s.limitation === 'bandwidth',
  }
}
