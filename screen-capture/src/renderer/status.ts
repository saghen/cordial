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

let last: { sender: RTCRtpSender; time: number; bytes: number; frames: number; qpSum: number } | null = null

const mbps = (bps: number | undefined) => (bps === undefined || isNaN(bps) ? '?' : (bps / 1e6).toFixed(1))
const round = (value: number | undefined) => (value === undefined || isNaN(value) ? '?' : String(Math.round(value)))

/** The numbers since the last call (call it once a second); null while nothing streams. */
export async function streamStatus(): Promise<StreamStatus | null> {
  const sender = streamSender()
  const session = castSessionFor(sender?.track)
  if (!sender || !session || session.state === 'ended') return null
  const stats = [...(await sender.getStats()).values()]
  const byId = (id: string | undefined) => stats.find((stat) => stat.id === id)
  const rtp = stats.find((stat) => stat.type === 'outbound-rtp')
  if (!rtp) return null
  const pair = byId(byId(rtp.transportId)?.selectedCandidatePairId)
  const source = byId(rtp.mediaSourceId)
  const codec = byId(rtp.codecId)?.mimeType?.split('/')[1]?.toUpperCase()

  const prev = last?.sender === sender ? last : null
  last = { sender, time: rtp.timestamp, bytes: rtp.bytesSent, frames: rtp.framesEncoded ?? 0, qpSum: rtp.qpSum ?? 0 }
  const elapsed = prev ? (last.time - prev.time) / 1000 : 0
  const per = (value: number, prevValue: number | undefined) =>
    elapsed > 0 && prevValue !== undefined ? (value - prevValue) / elapsed : undefined
  const bitrate = (per(last.bytes, prev?.bytes) ?? NaN) * 8
  const frames = prev ? last.frames - prev.frames : 0

  const cast = isZeroCopy(sender) ? session.stats : null
  const shown = cast
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
        qp: prev && frames > 0 ? (last.qpSum - prev.qpSum) / frames : undefined,
        limitation: rtp.qualityLimitationReason,
      }
  const network = [`${mbps(bitrate)} / ${mbps(shown.target)} Mbps`]
  if (pair?.availableOutgoingBitrate !== undefined) network.push(`BWE ${mbps(pair.availableOutgoingBitrate)} Mbps`)
  if (pair?.currentRoundTripTime !== undefined) network.push(`RTT ${round(pair.currentRoundTripTime * 1000)} ms`)
  return {
    lines: [
      (codec ?? '?') + (shown.encoder ? ` · ${shown.encoder}` : ''),
      `${shown.width ?? '?'}×${shown.height ?? '?'} @ ${round(shown.fps)} fps${shown.captured}`,
      network.join(' · '),
      ...(shown.qp === undefined ? [] : [`QP ${round(shown.qp)} /${QP_MAX[codec ?? ''] ?? '?'}`]),
      // capture's sample: a frame once a second against what its encoder made of it
      ...(cast?.ssim === undefined ? [] : [`SSIM ${cast.ssim.toFixed(3)}`]),
      `limited by: ${shown.limitation ?? '?'}`,
    ],
    summary: `${codec ?? '?'} ${shown.height ?? '?'}p${round(shown.fps)} ${mbps(bitrate)} Mbps`,
    limited: shown.limitation === 'cpu' || shown.limitation === 'bandwidth',
  }
}
