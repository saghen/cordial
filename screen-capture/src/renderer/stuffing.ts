// Steady wire rate (setting "steadyWireRate", zeroCopy.ts): capture's frames are topped up to the target's
// per-frame budget with stuffing, so the sender is never application limited on simple scenes (the bandwidth
// estimate then has no low rate of ours to fall to, targetRate.ts). Pure: no DOM, no imports.
//
// The stuffing is an AV1 metadata OBU (obu_type 5) of an unregistered user-private metadata_type, which decoders
// ignore (AV1 spec 6.7.1: "decoders should ignore metadata OBUs with unknown or private metadata_type"):
// - libwebrtc's AV1 packetizer (rtp_packetizer_av1.cc ParseObus) drops only temporal delimiters, tile lists and
//   padding OBUs (VCN's own padding OBUs never reach the wire): metadata is sent;
// - Discord's DAVE (libdave codec_utils.cpp ProcessFrameAv1) copies every OBU the packetizer keeps, header and size
//   in the clear and the payload encrypted;
// - it goes in front of the first frame / frame-header OBU (after the temporal delimiter and sequence header, where
//   encoders put metadata), so the frame OBU stays last (DAVE drops the size field of the last OBU).
// Cost: the viewers' downlink is always near the target too.

/** AV1 obu_type OBU_METADATA */
const OBU_METADATA = 5
const OBU_FRAME_HEADER = 3
const OBU_FRAME = 6
/** metadata_type: 6-31 are "unregistered user private" */
export const STUFF_METADATA_TYPE = 31
/** no stuffing below this many bytes (an OBU's header, size and type are 3-5 bytes) */
export const MIN_STUFF = 64

export const STUFF = {
  /** a frame is topped up by at most this many bytes (~1 frame budget at 9 Mbps 60 fps x 2) */
  MAX_PER_FRAME: 40_000,
  /** time between frames counted at most (a stall doesn't make one huge stuffing) */
  MAX_GAP_MS: 50,
  /** what we sent over the budget (a key frame) is paid back by later frames, at most this much of it, in ms of target */
  MAX_CREDIT_MS: 500,
}

function leb128(n: number): number[] {
  const out: number[] = []
  do {
    let b = n & 0x7f
    n = Math.floor(n / 128)
    if (n) b |= 0x80
    out.push(b)
  } while (n)
  return out
}

/** A metadata OBU (with obu_size) of `total` bytes (>= MIN_STUFF; one less where obu_size would need another byte). */
export function stuffingObu(total: number): Uint8Array {
  // header (1) + leb128(payload) + payload; payload = metadata_type (1) + zeros + trailing bits (0x80)
  let payload = total - 2
  while (1 + leb128(payload).length + payload > total) payload--
  const size = leb128(payload)
  const out = new Uint8Array(1 + size.length + payload)
  out[0] = (OBU_METADATA << 3) | 0x02 // obu_has_size_field
  out.set(size, 1)
  out[1 + size.length] = STUFF_METADATA_TYPE
  out[out.length - 1] = 0x80 // trailing_one_bit
  return out
}

/**
 * Where the stuffing goes in a temporal unit: the offset of its first frame or frame-header OBU (its end if it has
 * none, or -1 if it doesn't parse: then it gets no stuffing).
 */
export function stuffingOffset(tu: Uint8Array): number {
  let i = 0
  while (i < tu.length) {
    const h = tu[i]
    const type = (h >> 3) & 0xf
    if (type === OBU_FRAME || type === OBU_FRAME_HEADER) return i
    let j = i + 1 + ((h & 0x04) >> 2)
    if (!(h & 0x02)) return -1 // no size: runs to the end, and we'd have to go after it
    let size = 0
    for (let k = 0; ; k++) {
      if (j >= tu.length || k > 7) return -1
      const b = tu[j++]
      size += (b & 0x7f) * 2 ** (7 * k)
      if (!(b & 0x80)) break
    }
    if (j + size > tu.length) return -1
    i = j + size
  }
  return i
}

/** `tu` with a metadata OBU of `bytes` in front of its frame; `tu` itself when it can't be stuffed. */
export function stuff(tu: Uint8Array, bytes: number): Uint8Array {
  if (bytes < MIN_STUFF) return tu
  const at = stuffingOffset(tu)
  if (at < 0) return tu
  const obu = stuffingObu(bytes)
  const out = new Uint8Array(tu.length + obu.length)
  out.set(tu.subarray(0, at), 0)
  out.set(obu, at)
  out.set(tu.subarray(at), at + obu.length)
  return out
}

export interface FillState {
  /** bytes sent over the budget so far (paid back before stuffing again) */
  credit: number
  /** ms, the previous frame's capture time */
  lastT: number | null
}

export const initialFill = (): FillState => ({ credit: 0, lastT: null })

/**
 * How many bytes of stuffing a frame of `size` bytes captured at `t` ms gets, to keep the rate at `targetBps`: a
 * token bucket of the budget (targetBps x the time since the previous frame) that a frame over it (a key frame)
 * fills with credit that later frames pay back; stuffing never makes up for a deficit of earlier frames.
 */
export function fill(s: FillState, size: number, t: number, targetBps: number): { pad: number; state: FillState } {
  const gap = s.lastT === null ? 1000 / 60 : Math.min(Math.max(t - s.lastT, 0), STUFF.MAX_GAP_MS)
  const budget = (targetBps / 8) * (gap / 1000)
  let credit = s.credit + size - budget
  let pad = 0
  if (credit < 0) {
    pad = Math.min(-credit, STUFF.MAX_PER_FRAME)
    if (pad < MIN_STUFF) pad = 0
    credit = 0
  }
  credit = Math.min(credit, (targetBps / 8) * (STUFF.MAX_CREDIT_MS / 1000))
  return { pad: Math.round(pad), state: { credit, lastT: t } }
}
