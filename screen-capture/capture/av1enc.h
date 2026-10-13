// av1enc: low-delay AV1 encoding through VA-API (written for Mesa radeonsi, VCN 4/5), for capture's zero-copy
// stream: the frame is VPP-scaled into an NV12 surface and encoded on the same GPU, only the bitstream leaves VRAM.
//
// One or two references (the previous frames), no reordering, CBR, keyframes only when asked, BT.601 limited range
// (what capture's VPP converts to). See av1enc.c.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <va/va.h>

struct av1enc;

struct av1enc_cfg {
	uint32_t width, height; // multiple of 8 x multiple of 2 on VCN 5 (the caller rounds)
	uint32_t fps;
	uint32_t kbps;       // initial target
	unsigned min_qindex; // floor of the quantizer (0: 1); see av1enc.c
	unsigned refs;       // 1: LAST only, 2 (default): LAST + GOLDEN (+0.0018 SSIM, 2.4 -> 5.8 ms per 1440p frame)
};

struct av1enc_frame {
	bool key;
	unsigned qp;       // average qindex if the driver reports one (radeonsi doesn't: 0)
	double ms_encode;  // submit -> bitstream mapped
};

// whether display va can encode AV1 (Profile0, EncSlice) at all
bool av1enc_supported(VADisplay va);
struct av1enc *av1enc_open(VADisplay va, const struct av1enc_cfg *cfg);
void av1enc_close(struct av1enc *e);
// encode src (NV12, cfg size) and wait for it; the temporal unit (OBUs, no temporal delimiter) goes to *out
// (valid until the next call). Returns its size, or -1.
long av1enc_encode(struct av1enc *e, VASurfaceID src, bool key, const uint8_t **out, struct av1enc_frame *info);
// new target, applied from the next frame on (no keyframe)
void av1enc_set_kbps(struct av1enc *e, uint32_t kbps);
