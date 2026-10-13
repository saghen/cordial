// Watching an AV1 Go Live stream (or camera) behind DAVE in Chromium. Two things break it on the receiving side, for
// any AV1 sender, ours or Discord's native clients:
// - Chromium's AV1 depacketizer gives every OBU of the frame a size field, but DAVE's encryptor took the last OBU's
//   out (its trailer rides at the end of that OBU) and the frame's clear ranges say so: decryption fails its tag check
//   on every frame. Before decryption the last OBU loses its size field again.
// - Without a dependency descriptor (Discord's video m-line has none) a decrypted AV1 delta frame never gets past
//   Chromium's reference finder: only key frames are shown, each after a PLI. After decryption each frame goes back
//   as a clone with a frame id and its dependency (the frame before; none for a key frame), which it then follows.
//
// Discord sets its decryption up per receiver with RTCRtpScriptTransform when the receiver has `transform`, else with
// createEncodedStreams (handing the streams to its worker), so `transform` goes and video receivers' streams get a
// stage on each side of Discord's worker. Other codecs pass through untouched.

// (not in TypeScript's DOM types yet)
const EncodedFrame = (globalThis as any).RTCEncodedVideoFrame as new (frame: any, init?: { metadata: any }) => any

const isAv1 = (f: any) => f.getMetadata().mimeType === 'video/AV1'

/** What the receive stages did (lab): frames unsized and cloned, and the last error (the frame then goes on as it
 * was: a stage that throws would end the receiver's stream for good). */
export const av1ReceiveStats = { unsized: 0, cloned: 0, errors: 0, lastError: '' }
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
  let id = 0
  const before = new TransformStream({
    transform(f: any, c) {
      try {
        if (isAv1(f)) {
          const d = unsizeLastObu(new Uint8Array(f.data))
          if (d) ((f.data = d.buffer), av1ReceiveStats.unsized++)
        }
      } catch (e) {
        failed(e)
      }
      c.enqueue(f)
    },
  })
  const after = new TransformStream({
    transform(f: any, c) {
      try {
        if (isAv1(f)) {
          id++
          const metadata = { ...f.getMetadata(), frameId: id, dependencies: f.type === 'key' ? [] : [id - 1] }
          c.enqueue(new EncodedFrame(f, { metadata }))
          av1ReceiveStats.cloned++
          return
        }
      } catch (e) {
        failed(e)
      }
      c.enqueue(f)
    },
  })
  return { before, after }
}

const proto = RTCRtpReceiver.prototype as any
delete proto.transform
const origCreate = proto.createEncodedStreams
proto.createEncodedStreams = function (this: RTCRtpReceiver) {
  const streams = origCreate.call(this)
  if (this.track.kind !== 'video') return streams
  const { before, after } = stages()
  after.readable.pipeTo(streams.writable).catch((e) => failed('to the receiver: ' + e))
  return { readable: streams.readable.pipeThrough(before), writable: after.writable }
}
