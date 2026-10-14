// A watched stream's network health, for its LAG badge: what the network does to the stream's video at this viewer
// (loss, key frames asked for, jitter-buffer delay, freezes), from the stream connection's own stats. Any sender, any
// codec. Not its bitrate: a still screen sends little at full quality, and no target reaches a viewer. Nothing is
// hooked: the connection is found when asked.

import { host } from './host'

// judged over the last WINDOW_S; LAG holds CLEAR_S past the last bad window (packets a NACK recovers leave the loss
// count, so a window clears as soon as the link does); the first SETTLE_S of a stream, and of a new size, aren't judged
// (a start's key-frame requests and freezes are normal)
const WINDOW_S = 3
const CLEAR_S = 5
const SETTLE_S = 5
const MAX_LOSS = 0.02
const MAX_JITTER_MS = 200

export interface ReceiveHealth {
  lag: boolean
  /** packets lost over the window, a share of those sent */
  loss: number
  /** key frames asked for (PLI, FIR) over the window */
  pli: number
  /** the jitter buffer's mean delay over the window */
  jitterMs: number
  /** freezes over the window */
  freezes: number
}

interface Sample {
  time: number
  received: number
  lost: number
  pli: number
  jitterBufferDelay: number
  jitterBufferCount: number
  freezes: number
  size: string
}

const watched = new WeakMap<RTCPeerConnection, { samples: Sample[]; since: number; lagUntil: number }>()

/** The connection's RTCPeerConnection: Discord keeps it a field or two down. */
function peerConnection(value: any, depth = 2): RTCPeerConnection | undefined {
  if (value instanceof RTCPeerConnection) return value
  if (!depth || !value || typeof value !== 'object') return
  for (const field of Object.values(value)) {
    const peer = peerConnection(field, depth - 1)
    if (peer) return peer
  }
}

/** The health of `userId`'s stream as this client watches it (call once a second); null while not watching it. */
export async function receiveHealth(userId: string): Promise<ReceiveHealth | null> {
  const connection = [...(host.discord?.connections() ?? [])].find(
    (entry) =>
      entry.context === 'stream' &&
      entry.streamUserId === userId &&
      entry.streamUserId !== host.discord?.currentUser()?.id,
  )
  const peer = connection && peerConnection(connection)
  return peer ? peerHealth(peer) : null
}

/** The same for any connection's inbound video. */
export async function peerHealth(peer: RTCPeerConnection): Promise<ReceiveHealth | null> {
  const rtp = [...(await peer.getStats()).values()]
    .filter((stat) => stat.type === 'inbound-rtp' && stat.kind === 'video')
    .sort((first, second) => (second.packetsReceived ?? 0) - (first.packetsReceived ?? 0))[0]
  if (!rtp) return null
  const sample: Sample = {
    time: rtp.timestamp / 1000,
    received: rtp.packetsReceived ?? 0,
    lost: rtp.packetsLost ?? 0,
    pli: (rtp.pliCount ?? 0) + (rtp.firCount ?? 0),
    jitterBufferDelay: rtp.jitterBufferDelay ?? 0,
    jitterBufferCount: rtp.jitterBufferEmittedCount ?? 0,
    freezes: rtp.freezeCount ?? 0,
    size: `${rtp.frameWidth}x${rtp.frameHeight}`,
  }
  let state = watched.get(peer)
  const last = state?.samples.at(-1)
  // a new stream (the counters start over) or size: judged again after SETTLE_S
  if (!state || !last || sample.received < last.received || sample.size !== last.size) {
    state = { samples: [], since: sample.time, lagUntil: state?.lagUntil ?? 0 }
    watched.set(peer, state)
  }
  state.samples.push(sample)
  while (sample.time - state.samples[0].time > WINDOW_S) state.samples.shift()
  const oldest = state.samples[0]
  const lost = sample.lost - oldest.lost
  // (packets counted lost can arrive late: never under 0)
  const loss = Math.max(0, lost / Math.max(1, sample.received - oldest.received + lost))
  const pli = sample.pli - oldest.pli
  const jitterMs =
    sample.jitterBufferCount > oldest.jitterBufferCount
      ? ((sample.jitterBufferDelay - oldest.jitterBufferDelay) /
          (sample.jitterBufferCount - oldest.jitterBufferCount)) *
        1000
      : 0
  const freezes = sample.freezes - oldest.freezes
  const bad = loss > MAX_LOSS || pli > 0 || jitterMs > MAX_JITTER_MS || (freezes > 0 && lost > 0)
  if (bad && sample.time - state.since >= SETTLE_S) state.lagUntil = sample.time + CLEAR_S
  return { lag: sample.time < state.lagUntil, loss, pli, jitterMs, freezes }
}
