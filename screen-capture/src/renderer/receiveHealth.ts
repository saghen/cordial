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
  t: number
  received: number
  lost: number
  pli: number
  jbDelay: number
  jbCount: number
  freezes: number
  size: string
}

const watched = new WeakMap<RTCPeerConnection, { samples: Sample[]; since: number; lagUntil: number }>()

/** The connection's RTCPeerConnection: Discord keeps it a field or two down. */
function peerConnection(o: any, depth = 2): RTCPeerConnection | undefined {
  if (o instanceof RTCPeerConnection) return o
  if (!depth || !o || typeof o !== 'object') return
  for (const v of Object.values(o)) {
    const pc = peerConnection(v, depth - 1)
    if (pc) return pc
  }
}

/** The health of `userId`'s stream as this client watches it (call once a second); null while not watching it. */
export async function receiveHealth(userId: string): Promise<ReceiveHealth | null> {
  const conn = [...(host.discord?.connections() ?? [])].find(
    (c) => c.context === 'stream' && c.streamUserId === userId && c.streamUserId !== host.discord?.currentUser()?.id,
  )
  const pc = conn && peerConnection(conn)
  return pc ? pcHealth(pc) : null
}

/** The same for any connection's inbound video (the lab's bench). */
export async function pcHealth(pc: RTCPeerConnection): Promise<ReceiveHealth | null> {
  const rtp = [...(await pc.getStats()).values()]
    .filter((s) => s.type === 'inbound-rtp' && s.kind === 'video')
    .sort((a, b) => (b.packetsReceived ?? 0) - (a.packetsReceived ?? 0))[0]
  if (!rtp) return null
  const s: Sample = {
    t: rtp.timestamp / 1000,
    received: rtp.packetsReceived ?? 0,
    lost: rtp.packetsLost ?? 0,
    pli: (rtp.pliCount ?? 0) + (rtp.firCount ?? 0),
    jbDelay: rtp.jitterBufferDelay ?? 0,
    jbCount: rtp.jitterBufferEmittedCount ?? 0,
    freezes: rtp.freezeCount ?? 0,
    size: `${rtp.frameWidth}x${rtp.frameHeight}`,
  }
  let w = watched.get(pc)
  const last = w?.samples.at(-1)
  // a new stream (the counters start over) or size: judged again after SETTLE_S
  if (!w || !last || s.received < last.received || s.size !== last.size)
    watched.set(pc, (w = { samples: [], since: s.t, lagUntil: w?.lagUntil ?? 0 }))
  w.samples.push(s)
  while (s.t - w.samples[0].t > WINDOW_S) w.samples.shift()
  const a = w.samples[0]
  const lost = s.lost - a.lost
  // (packets counted lost can arrive late: never under 0)
  const loss = Math.max(0, lost / Math.max(1, s.received - a.received + lost))
  const pli = s.pli - a.pli
  const jitterMs = s.jbCount > a.jbCount ? ((s.jbDelay - a.jbDelay) / (s.jbCount - a.jbCount)) * 1000 : 0
  const freezes = s.freezes - a.freezes
  const bad = loss > MAX_LOSS || pli > 0 || jitterMs > MAX_JITTER_MS || (freezes > 0 && lost > 0)
  if (bad && s.t - w.since >= SETTLE_S) w.lagUntil = s.t + CLEAR_S
  return { lag: s.t < w.lagUntil, loss, pli, jitterMs, freezes }
}
