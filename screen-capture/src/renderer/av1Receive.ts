// Watching a Go Live stream (or camera) behind DAVE in Chromium, AV1 above all. Two things break it on the receiving
// side, for any sender, ours or Discord's native clients:
// - Chromium's AV1 depacketizer gives every OBU of the frame a size field, but DAVE's encryptor took the last OBU's
//   out (its trailer rides at the end of that OBU) and the frame's clear ranges say so: decryption fails its tag check
//   on every AV1 frame. Before decryption the last OBU loses its size field again.
// - A frame Discord's worker gives back isn't the receiver's own (it crossed into the worker), and Chromium takes a
//   foreign frame's RTP sequence numbers to be its frame id: -1 before reference finding. With those, Chromium's
//   sequence-number reference finder (AV1 and H.264 without a dependency descriptor, which Discord's m-line doesn't
//   negotiate) never passes a delta frame, only key frames after PLIs, and its packet buffer is never cleared up to
//   what was decoded: it fills (2048 packets), clears itself and asks for a key frame, and the frames it dropped
//   decode as garbage; while the real numbers are within half the range below 65535 every packet is dropped as too
//   old (the stream stops until they wrap). So the receiver's own frame is kept while the worker has its copy, and
//   it goes back with the decrypted payload.
//
// Discord sets its decryption up per receiver with RTCRtpScriptTransform when the receiver has `transform`, else with
// createEncodedStreams (handing the streams to its worker), so `transform` goes and video receivers' streams get a
// stage on each side of Discord's worker. Anything unexpected (a frame without metadata, one the worker didn't come
// back with, a stage that throws) leaves the frame as it was: a Discord change can cost AV1 receive, not calls.

const isAv1 = (f: any) => f.getMetadata().mimeType === 'video/AV1'

/** What the receive stages did (lab): AV1 frames unsized, frames that went back as the receiver's own, and the last
 * error (the frame then goes on as it was: a stage that throws would end the receiver's stream for good). */
export const av1ReceiveStats = { unsized: 0, own: 0, errors: 0, lastError: '' }
const failed = (e: unknown) => {
  av1ReceiveStats.errors++
  av1ReceiveStats.lastError = String(e).slice(0, 200)
}

/** The frame with its last OBU's size field taken out, if it is a DAVE-encrypted AV1 frame (ends 0xFAFA) whose OBUs
 * all have one; else null. */
export function unsizeLastObu(d: Uint8Array): Uint8Array | null {
  if (d.length < 4 || d[d.length - 1] !== 0xfa || d[d.length - 2] !== 0xfa) return null
  for (let i = 0; i < d.length;) {
    const header = d[i]
    const sizeAt = i + 1 + ((header >> 2) & 1) // after the extension byte, if any
    if (!((header >> 1) & 1)) return null
    let size = 0
    let n = 0
    let b
    do {
      b = d[sizeAt + n]
      size += (b & 0x7f) * 2 ** (7 * n)
      n++
    } while (b & 0x80 && n < 8)
    const end = sizeAt + n + size
    if (end === d.length) {
      const out = new Uint8Array(d.length - n)
      out.set(d.subarray(0, sizeAt))
      out[i] = header & ~2
      out.set(d.subarray(sizeAt + n), sizeAt)
      return out
    }
    if (end > d.length) return null
    i = end
  }
  return null
}

function stages() {
  // the receiver's own frames, by RTP timestamp, while Discord's worker has their copies
  const own = new Map<number, any>()
  const before = new TransformStream({
    transform(f: any, c) {
      try {
        if (isAv1(f)) {
          const d = unsizeLastObu(new Uint8Array(f.data))
          if (d) ((f.data = d.buffer), av1ReceiveStats.unsized++)
        }
        own.set(f.getMetadata().rtpTimestamp, f)
        // (frames the worker drops)
        if (own.size > 64) own.delete(own.keys().next().value!)
      } catch (e) {
        failed(e)
      }
      c.enqueue(f)
    },
  })
  const after = new TransformStream({
    transform(f: any, c) {
      try {
        const rtp = f.getMetadata().rtpTimestamp
        const o = own.get(rtp)
        if (o && o !== f) {
          own.delete(rtp)
          o.data = f.data
          av1ReceiveStats.own++
          f = o
        }
      } catch (e) {
        failed(e)
      }
      c.enqueue(f)
    },
  })
  return { before, after }
}

// (only where Chromium has both: else Discord keeps its own path, untouched)
const proto = RTCRtpReceiver.prototype as any
const origCreate = proto.createEncodedStreams
if (typeof origCreate === 'function' && 'transform' in proto) {
  delete proto.transform
  proto.createEncodedStreams = function (this: RTCRtpReceiver) {
    const streams = origCreate.call(this)
    try {
      if (this.track?.kind !== 'video' || !streams?.readable || !streams.writable) return streams
      const { before, after } = stages()
      after.readable.pipeTo(streams.writable).catch((e) => failed('to the receiver: ' + e))
      return { readable: streams.readable.pipeThrough(before), writable: after.writable }
    } catch (e) {
      failed(e)
      return streams
    }
  }
}
