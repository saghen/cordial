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
const STUFF_METADATA_TYPE = 31
/** no stuffing below this many bytes (an OBU's header, size and type are 3-5 bytes) */
const MIN_STUFF = 64

const STUFF = {
  /** a frame is topped up by at most this many bytes (~1 frame budget at 9 Mbps 60 fps x 2) */
  MAX_PER_FRAME: 40_000,
  /** time between frames counted at most (a stall doesn't make one huge stuffing) */
  MAX_GAP_MS: 50,
  /** what went over the budget (a key frame) is paid back by later frames, at most this many ms of the target */
  MAX_CREDIT_MS: 500,
}

function leb128(value: number): number[] {
  const out: number[] = []
  do {
    let byte = value & 0x7f
    value = Math.floor(value / 128)
    if (value) byte |= 0x80
    out.push(byte)
  } while (value)
  return out
}

/** A metadata OBU (with obu_size) of `total` bytes (>= MIN_STUFF; one less where obu_size would need another byte). */
function stuffingObu(total: number): Uint8Array {
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
function stuffingOffset(unit: Uint8Array): number {
  let i = 0
  while (i < unit.length) {
    const header = unit[i]
    const type = (header >> 3) & 0xf
    if (type === OBU_FRAME || type === OBU_FRAME_HEADER) return i
    let offset = i + 1 + ((header & 0x04) >> 2)
    if (!(header & 0x02)) return -1 // no size: runs to the end, and we'd have to go after it
    let size = 0
    for (let byteIndex = 0; ; byteIndex++) {
      if (offset >= unit.length || byteIndex > 7) return -1
      const byte = unit[offset++]
      size += (byte & 0x7f) * 2 ** (7 * byteIndex)
      if (!(byte & 0x80)) break
    }
    if (offset + size > unit.length) return -1
    i = offset + size
  }
  return i
}

/** `unit` with a metadata OBU of `bytes` in front of its frame; `unit` itself when it can't be stuffed. */
export function stuff(unit: Uint8Array, bytes: number): Uint8Array {
  if (bytes < MIN_STUFF) return unit
  const at = stuffingOffset(unit)
  if (at < 0) return unit
  const obu = stuffingObu(bytes)
  const out = new Uint8Array(unit.length + obu.length)
  out.set(unit.subarray(0, at), 0)
  out.set(obu, at)
  out.set(unit.subarray(at), at + obu.length)
  return out
}

export interface FillState {
  /** bytes sent over the budget so far (paid back before stuffing again) */
  credit: number
  /** ms, the previous frame's capture time */
  lastTime: number | null
}

export const initialFill = (): FillState => ({ credit: 0, lastTime: null })

/**
 * How many bytes of stuffing a frame of `size` bytes captured at `time` ms gets, to keep the rate at `targetBps`: a
 * token bucket of the budget (targetBps x the time since the previous frame) that a frame over it (a key frame)
 * fills with credit that later frames pay back; stuffing never makes up for a deficit of earlier frames.
 */
export function fill(
  state: FillState,
  size: number,
  time: number,
  targetBps: number,
): { pad: number; state: FillState } {
  const gap = state.lastTime === null ? 1000 / 60 : Math.min(Math.max(time - state.lastTime, 0), STUFF.MAX_GAP_MS)
  const budget = (targetBps / 8) * (gap / 1000)
  let credit = state.credit + size - budget
  let pad = 0
  if (credit < 0) {
    pad = Math.min(-credit, STUFF.MAX_PER_FRAME)
    if (pad < MIN_STUFF) pad = 0
    credit = 0
  }
  credit = Math.min(credit, (targetBps / 8) * (STUFF.MAX_CREDIT_MS / 1000))
  return { pad: Math.round(pad), state: { credit, lastTime: time } }
}
