// av1enc: low-delay AV1 encoding through VA-API, see av1enc.h.
//
// How Mesa's VA frontend (picture_av1_enc.c) and radeonsi want it, as of Mesa 26.2:
// - The application packs the Sequence Header and Frame Header OBUs itself (VAEncPackedHeaderSequence / Picture).
//   Mesa parses them (the sequence header completely, the frame header up to uniform_tile_spacing_flag) and
//   radeonsi writes both again from the parsed values: the sequence header with its own aligned size, the frame
//   header through the firmware, which fills in what rate control decides (base_q_idx, loop filter, CDEF). So the
//   packed bytes are a description, not output; we write the frame header only as far as Mesa reads it.
// - Without packed headers radeonsi writes the headers from its defaults (show_frame = 0 on every frame...).
//   Chromium's VA-API AV1 encoder fails here for a related reason: its frame header's OBU size is not a valid
//   leb128, so Mesa reads every field shifted (see equibop's hwav1 branch, native/vaav1fix).
// - The DPB is VA surfaces we own (two reconstructed frames, alternating), referenced by slot as in ffmpeg's
//   vaapi_encode_av1 with two references: each inter frame refreshes the slot the previous frame isn't in and
//   predicts from LAST (the previous frame) and GOLDEN (the one before, in the other slot); without GOLDEN the
//   same clip scores 0.0018 SSIM less at 9 Mbps. Three reconstructed surfaces rotate (the one written is never one
//   being read).
// - Rate control: CBR (VAConfigAttribRateControl), the target from VAEncMiscParameterRateControl. radeonsi
//   re-initialises its rate control layer whenever the target changes, so a new target takes effect on the next
//   frame without a keyframe. Filler data off (bit stuffing would pad small frames up to the CBR rate).
// - Minimum qindex: on static content CBR drives the quantizer to ~1 (near lossless) to fill the target, and the
//   next scene cut is coded near lossless too: 0.6-0.87 MB frames at 9 Mbps that stall the stream (desktop clip).
//   radeonsi honours the picture's min_base_qindex (it ignores the HRD and max frame size); 10 keeps the desktop
//   clip at SSIM 0.9884 (libaom 0.9886) with the worst second at 6.6 Mbit (no floor: 0.9902 but 16.4 Mbit and
//   4.3 Mbps spent on a near-static screen; 20: 0.9866 / 4.1 Mbit; 40: 0.9828).
// - The firmware rate-controls per superblock (delta_q_present = 1, delta_q_res 0) around a fixed base_q_idx of 60,
//   and radeonsi reports no average QP: there's no frame QP to hand a client (av1enc_frame.qp stays 0).
// - Quality: Mesa's default (no QualityLevel buffer) is the "speed" preset without pre-encode; on the 9070 XT the
//   presets differ by < 0.001 SSIM at 9 Mbps (lab: speed 0.9691, balance 0.9692, quality 0.9692, high quality
//   0.9696 on a 1440p60 clip) but not in time per 1440p frame (2.2 / 2.4 / 5.7 / 15.7 ms: "high quality" can't do
//   60 fps), so: "balance".
// - The HRD buffer (500 ms) is passed on but not enforced; VAEncMiscParameterTypeMaxFrameSize made no difference
//   either (VCN 5), hence capture's quantizer floor and frame dropper.
#define _GNU_SOURCE
#include "av1enc.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <va/va_enc_av1.h>

#define VBV_MS 500
#define QUALITY_BALANCE (1 | 1 << 1) // Mesa's quality bits: speed 1, balance 3, quality 5, high quality 7, +8 pre-encode

#define CHECK(expr)                                                                                        \
	({                                                                                                 \
		VAStatus _st = (expr);                                                                     \
		if (_st != VA_STATUS_SUCCESS)                                                              \
			fprintf(stderr, "av1enc: %s: %s (%d)\n", #expr, vaErrorStr(_st), _st);             \
		_st;                                                                                       \
	})

struct av1enc {
	VADisplay va;
	struct av1enc_cfg cfg;
	VAConfigID config;
	VAContextID ctx;
	VASurfaceID recon[3];   // reconstructed frames: the two in the DPB slots + the one being written
	VASurfaceID in_slot[2]; // which recon surface each DPB slot holds
	VABufferID coded;
	size_t coded_size;
	uint8_t *out;
	size_t out_cap;
	VAConfigAttribValEncAV1Ext2 ext2;
	unsigned tx_mode;
	uint8_t level;
	uint32_t kbps, sent_kbps;
	// stream state
	bool started;
	int prev_slot;     // DPB slot of the previous frame
	uint32_t frame;    // frames since the last keyframe (order_hint = frame & 0xff)
};

static double now(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec / 1e9;
}

// ---------------------------------------------------------------- bit writer

struct bw {
	uint8_t buf[256];
	unsigned bits;
};

static void put(struct bw *b, uint32_t v, int n)
{
	for (int i = n - 1; i >= 0; i--, b->bits++)
		if ((v >> i) & 1)
			b->buf[b->bits >> 3] |= 0x80 >> (b->bits & 7);
}

static void trailing_bits(struct bw *b)
{
	put(b, 1, 1);
	while (b->bits & 7)
		put(b, 0, 1);
}

// OBU (header without extension, has_size_field = 1, leb128 size) around payload p into out; returns bytes
static unsigned obu(uint8_t *out, int type, const struct bw *p)
{
	unsigned n = 0, size = p->bits / 8;
	out[n++] = (uint8_t)(type << 3 | 1 << 1);
	do {
		uint8_t byte = size & 0x7f;
		size >>= 7;
		out[n++] = byte | (size ? 0x80 : 0);
	} while (size);
	memcpy(out + n, p->buf, p->bits / 8);
	return n + p->bits / 8;
}

enum { OBU_SEQUENCE_HEADER = 1, OBU_FRAME_HEADER = 3 };
enum { KEY_FRAME = 0, INTER_FRAME = 1 };

static unsigned sequence_header(const struct av1enc *e, uint8_t *out)
{
	struct bw b = {0};
	put(&b, 0, 3); // seq_profile: main (8-bit 4:2:0)
	put(&b, 0, 1); // still_picture
	put(&b, 0, 1); // reduced_still_picture_header
	put(&b, 0, 1); // timing_info_present_flag
	put(&b, 0, 1); // initial_display_delay_present_flag
	put(&b, 0, 5); // operating_points_cnt_minus_1
	put(&b, 0, 12); // operating_point_idc[0]
	put(&b, e->level, 5);
	if (e->level > 7)
		put(&b, 0, 1); // seq_tier: main
	put(&b, 15, 4); // frame_width_bits_minus_1
	put(&b, 15, 4); // frame_height_bits_minus_1
	put(&b, e->cfg.width - 1, 16);
	put(&b, e->cfg.height - 1, 16);
	put(&b, 0, 1); // frame_id_numbers_present_flag
	put(&b, 0, 1); // use_128x128_superblock
	put(&b, 0, 1); // enable_filter_intra
	put(&b, 0, 1); // enable_intra_edge_filter
	put(&b, 0, 1); // enable_interintra_compound
	put(&b, 0, 1); // enable_masked_compound
	put(&b, 0, 1); // enable_warped_motion
	put(&b, 0, 1); // enable_dual_filter
	put(&b, 1, 1); // enable_order_hint
	put(&b, 0, 1); //   enable_jnt_comp
	put(&b, 0, 1); //   enable_ref_frame_mvs
	put(&b, 0, 1); // seq_choose_screen_content_tools
	put(&b, 0, 1); //   seq_force_screen_content_tools
	put(&b, 7, 3); // order_hint_bits_minus_1
	put(&b, 0, 1); // enable_superres
	put(&b, 1, 1); // enable_cdef
	put(&b, 0, 1); // enable_restoration
	// color_config
	put(&b, 0, 1); // high_bitdepth
	put(&b, 0, 1); // mono_chrome
	put(&b, 1, 1); // color_description_present_flag
	put(&b, 1, 8);  // color_primaries: BT.709
	put(&b, 13, 8); // transfer_characteristics: sRGB
	put(&b, 6, 8);  // matrix_coefficients: BT.601
	put(&b, 0, 1);  // color_range: limited
	put(&b, 0, 2); // chroma_sample_position: unknown
	put(&b, 0, 1); // separate_uv_delta_q
	put(&b, 0, 1); // film_grain_params_present
	trailing_bits(&b);
	return obu(out, OBU_SEQUENCE_HEADER, &b);
}

// the frame header as far as Mesa parses it (through uniform_tile_spacing_flag), see the top of the file
static unsigned frame_header(const struct av1enc *e, uint8_t *out, bool key, int slot)
{
	struct bw b = {0};
	put(&b, 0, 1); // show_existing_frame
	put(&b, key ? KEY_FRAME : INTER_FRAME, 2);
	put(&b, 1, 1); // show_frame
	if (!key)
		put(&b, 0, 1); // error_resilient_mode (a shown key frame implies 1)
	put(&b, 0, 1); // disable_cdf_update
	// allow_screen_content_tools: not coded (seq_force_screen_content_tools = 0)
	put(&b, 0, 1); // frame_size_override_flag
	put(&b, e->frame & 0xff, 8); // order_hint
	if (!key) {
		put(&b, 0, 3); // primary_ref_frame: LAST's context
		put(&b, 1u << slot, 8); // refresh_frame_flags
		put(&b, 0, 1); // frame_refs_short_signaling
		for (int i = 0; i < 7; i++)
			put(&b, i == 3 ? slot : e->prev_slot, 3); // ref_frame_idx[i]: GOLDEN (3) = the other slot
		// frame_size(): override 0, superres off -> nothing
		put(&b, 0, 1); // render_and_frame_size_different
		put(&b, 0, 1); // allow_high_precision_mv
		put(&b, 0, 1); // is_filter_switchable
		put(&b, 0, 2); //   interpolation_filter: EIGHTTAP
		put(&b, 0, 1); // is_motion_mode_switchable
		// use_ref_frame_mvs: not coded (enable_ref_frame_mvs = 0)
	} else {
		// refresh_frame_flags = 0xff implied; frame_size() nothing
		put(&b, 0, 1); // render_and_frame_size_different
	}
	put(&b, 0, 1); // disable_frame_end_update_cdf
	put(&b, 1, 1); // uniform_tile_spacing_flag (radeonsi lays out the tiles itself)
	trailing_bits(&b);
	return obu(out, OBU_FRAME_HEADER, &b);
}

// ---------------------------------------------------------------- setup

bool av1enc_supported(VADisplay va)
{
	int n = vaMaxNumEntrypoints(va);
	VAEntrypoint *eps = calloc(n, sizeof(*eps));
	bool ok = false;
	if (vaQueryConfigEntrypoints(va, VAProfileAV1Profile0, eps, &n) == VA_STATUS_SUCCESS)
		for (int i = 0; i < n; i++)
			ok |= eps[i] == VAEntrypointEncSlice;
	free(eps);
	return ok;
}

static uint8_t pick_level(uint32_t w, uint32_t h, uint32_t fps)
{
	// seq_level_idx by MaxPicSize / MaxDisplayRate (AV1 spec, Annex A)
	uint64_t pic = (uint64_t)w * h, rate = pic * fps;
	if (pic <= 2228224 && rate <= 133693440)
		return 9; // 4.1
	if (pic <= 8912896 && rate <= 267386880)
		return 12; // 5.0
	if (pic <= 8912896 && rate <= 534773760)
		return 13; // 5.1
	return 16;   // 6.0
}

struct av1enc *av1enc_open(VADisplay va, const struct av1enc_cfg *cfg)
{
	struct av1enc *e = calloc(1, sizeof(*e));
	e->va = va;
	e->cfg = *cfg;
	if (!e->cfg.fps)
		e->cfg.fps = 60;
	e->kbps = cfg->kbps ? cfg->kbps : 6000;
	e->config = VA_INVALID_ID;
	e->ctx = VA_INVALID_ID;
	e->coded = VA_INVALID_ID;
	e->recon[0] = e->recon[1] = e->recon[2] = VA_INVALID_SURFACE;
	e->in_slot[0] = e->in_slot[1] = VA_INVALID_SURFACE;
	e->level = pick_level(e->cfg.width, e->cfg.height, e->cfg.fps);

	VAConfigAttrib q[4] = {{.type = VAConfigAttribRateControl}, {.type = VAConfigAttribEncPackedHeaders},
			       {.type = VAConfigAttribEncAV1Ext2}, {.type = VAConfigAttribRTFormat}};
	if (CHECK(vaGetConfigAttributes(va, VAProfileAV1Profile0, VAEntrypointEncSlice, q, 4)))
		goto fail;
	if (q[0].value == VA_ATTRIB_NOT_SUPPORTED || !(q[0].value & VA_RC_CBR) || q[1].value == VA_ATTRIB_NOT_SUPPORTED ||
	    (q[1].value & (VA_ENC_PACKED_HEADER_SEQUENCE | VA_ENC_PACKED_HEADER_PICTURE)) !=
		    (VA_ENC_PACKED_HEADER_SEQUENCE | VA_ENC_PACKED_HEADER_PICTURE)) {
		fprintf(stderr, "av1enc: driver lacks CBR or packed sequence/picture headers (rc 0x%x packed 0x%x)\n",
			q[0].value, q[1].value);
		goto fail;
	}
	e->ext2.value = q[2].value == VA_ATTRIB_NOT_SUPPORTED ? 0 : q[2].value;
	e->tx_mode = (e->ext2.bits.tx_mode_support & 4) ? 2 /* TX_MODE_SELECT */ : 1 /* TX_MODE_LARGEST */;
	VAConfigAttrib attrs[3] = {
		{.type = VAConfigAttribRTFormat, .value = VA_RT_FORMAT_YUV420},
		{.type = VAConfigAttribRateControl, .value = VA_RC_CBR},
		{.type = VAConfigAttribEncPackedHeaders, .value = VA_ENC_PACKED_HEADER_SEQUENCE | VA_ENC_PACKED_HEADER_PICTURE},
	};
	if (CHECK(vaCreateConfig(va, VAProfileAV1Profile0, VAEntrypointEncSlice, attrs, 3, &e->config)))
		goto fail;
	if (CHECK(vaCreateSurfaces(va, VA_RT_FORMAT_YUV420, e->cfg.width, e->cfg.height, e->recon, 3, NULL, 0)))
		goto fail;
	if (CHECK(vaCreateContext(va, e->config, e->cfg.width, e->cfg.height, VA_PROGRESSIVE, e->recon, 3, &e->ctx)))
		goto fail;
	e->coded_size = (size_t)e->cfg.width * e->cfg.height; // generous: a 1440p key frame at 9 Mbps is ~100-300 kB
	if (CHECK(vaCreateBuffer(va, e->ctx, VAEncCodedBufferType, e->coded_size, 1, NULL, &e->coded)))
		goto fail;
	e->out_cap = 1 << 20;
	e->out = malloc(e->out_cap);
	fprintf(stderr, "av1enc: %ux%u@%u CBR %u kbps, min qindex %u, %u refs, level idx %u, tx_mode %u\n", e->cfg.width,
		e->cfg.height, e->cfg.fps, e->kbps, e->cfg.min_qindex, e->cfg.refs == 1 ? 1 : 2, e->level, e->tx_mode);
	return e;
fail:
	av1enc_close(e);
	return NULL;
}

void av1enc_close(struct av1enc *e)
{
	if (!e)
		return;
	if (e->coded != VA_INVALID_ID)
		vaDestroyBuffer(e->va, e->coded);
	if (e->ctx != VA_INVALID_ID)
		vaDestroyContext(e->va, e->ctx);
	if (e->recon[0] != VA_INVALID_SURFACE)
		vaDestroySurfaces(e->va, e->recon, 3);
	if (e->config != VA_INVALID_ID)
		vaDestroyConfig(e->va, e->config);
	free(e->out);
	free(e);
}

void av1enc_set_kbps(struct av1enc *e, uint32_t kbps)
{
	if (kbps >= 100)
		e->kbps = kbps;
}

// ---------------------------------------------------------------- per frame

#define MAX_BUFS 16

struct bufs {
	VABufferID id[MAX_BUFS];
	int n;
	bool failed;
};

static void add(struct av1enc *e, struct bufs *b, VABufferType type, unsigned size, void *data)
{
	if (b->n == MAX_BUFS || b->failed)
		return;
	if (CHECK(vaCreateBuffer(e->va, e->ctx, type, size, 1, data, &b->id[b->n])))
		b->failed = true;
	else
		b->n++;
}

static void add_misc(struct av1enc *e, struct bufs *b, VAEncMiscParameterType type, const void *data, size_t size)
{
	uint8_t buf[sizeof(VAEncMiscParameterBuffer) + 256] = {0};
	VAEncMiscParameterBuffer *m = (VAEncMiscParameterBuffer *)buf;
	m->type = type;
	memcpy(m->data, data, size);
	add(e, b, VAEncMiscParameterBufferType, sizeof(*m) + size, buf);
}

static void add_packed(struct av1enc *e, struct bufs *b, uint32_t type, uint8_t *data, unsigned bytes)
{
	VAEncPackedHeaderParameterBuffer p = {.type = type, .bit_length = bytes * 8, .has_emulation_bytes = 0};
	add(e, b, VAEncPackedHeaderParameterBufferType, sizeof(p), &p);
	add(e, b, VAEncPackedHeaderDataBufferType, bytes, data);
}

static void add_rate_control(struct av1enc *e, struct bufs *b, bool key)
{
	uint32_t bps = e->kbps * 1000;
	VAEncMiscParameterRateControl rc = {
		.bits_per_second = bps,
		.target_percentage = 100,
		.window_size = VBV_MS,
		.min_qp = e->cfg.min_qindex ? e->cfg.min_qindex : 1,
		.max_qp = 255,
		.rc_flags.bits.disable_bit_stuffing = 1,
	};
	add_misc(e, b, VAEncMiscParameterTypeRateControl, &rc, sizeof(rc));
	uint32_t vbv = (uint32_t)((uint64_t)bps * VBV_MS / 1000);
	VAEncMiscParameterHRD hrd = {.buffer_size = vbv, .initial_buffer_fullness = vbv / 4 * 3};
	// the HRD only with the sequence: Mesa resets the buffer level to the initial fullness with every HRD buffer,
	// and a bitrate update each second would hand the encoder a fresh 3/4-full buffer to burst into
	if (key)
		add_misc(e, b, VAEncMiscParameterTypeHRD, &hrd, sizeof(hrd));
	e->sent_kbps = e->kbps;
}

long av1enc_encode(struct av1enc *e, VASurfaceID src, bool key, const uint8_t **out, struct av1enc_frame *info)
{
	double t0 = now();
	key |= !e->started;
	if (key)
		e->frame = 0;
	int slot = key ? 0 : !e->prev_slot;
	VASurfaceID recon = e->recon[0];
	for (int i = 0; i < 3; i++)
		if (e->recon[i] != e->in_slot[0] && e->recon[i] != e->in_slot[1])
			recon = e->recon[i];
	struct bufs b = {0};
	uint8_t hdr[512];
	unsigned n;

	if (key) {
		VAEncSequenceParameterBufferAV1 seq = {
			.seq_profile = 0,
			.seq_level_idx = e->level,
			.intra_period = 0xffff,
			.ip_period = 1,
			.bits_per_second = e->kbps * 1000,
			.seq_fields.bits = {.enable_order_hint = 1, .enable_cdef = 1, .subsampling_x = 1, .subsampling_y = 1},
			.order_hint_bits_minus_1 = 7,
		};
		add(e, &b, VAEncSequenceParameterBufferType, sizeof(seq), &seq);
		VAEncMiscParameterFrameRate fr = {.framerate = (1u << 16) | e->cfg.fps};
		add_misc(e, &b, VAEncMiscParameterTypeFrameRate, &fr, sizeof(fr));
		VAEncMiscParameterBufferQualityLevel ql = {.quality_level = QUALITY_BALANCE};
		add_misc(e, &b, VAEncMiscParameterTypeQualityLevel, &ql, sizeof(ql));
	}
	// misc parameters before the picture parameters: the picture's min/max qindex (1/255) must win
	if (key || e->kbps != e->sent_kbps)
		add_rate_control(e, &b, key);

	VAEncPictureParameterBufferAV1 pic = {
		.frame_width_minus_1 = e->cfg.width - 1,
		.frame_height_minus_1 = e->cfg.height - 1,
		.reconstructed_frame = recon,
		.coded_buf = e->coded,
		.primary_ref_frame = key ? 7 : 0,
		.order_hint = e->frame & 0xff,
		.refresh_frame_flags = key ? 0xff : 1u << slot,
		.picture_flags.bits = {.frame_type = key ? KEY_FRAME : INTER_FRAME, .error_resilient_mode = key},
		.mode_control_flags.bits = {.tx_mode = e->tx_mode},
		.tile_cols = 1,
		.tile_rows = 1,
		.min_base_qindex = e->cfg.min_qindex ? e->cfg.min_qindex : 1,
		.max_base_qindex = 255,
		.tile_group_obu_hdr_info.bits.obu_has_size_field = 1,
	};
	pic.width_in_sbs_minus_1[0] = (e->cfg.width + 63) / 64 - 1;
	pic.height_in_sbs_minus_1[0] = (e->cfg.height + 63) / 64 - 1;
	for (int i = 0; i < 8; i++)
		pic.reference_frames[i] = VA_INVALID_SURFACE;
	if (!key) {
		pic.reference_frames[0] = e->in_slot[0];
		pic.reference_frames[1] = e->in_slot[1];
		for (int i = 0; i < 7; i++)
			pic.ref_frame_idx[i] = i == 3 ? slot : e->prev_slot;
		pic.ref_frame_ctrl_l0.fields.search_idx0 = 1; // LAST_FRAME
		if (e->frame >= 2 && e->cfg.refs != 1)
			pic.ref_frame_ctrl_l0.fields.search_idx1 = 4; // GOLDEN_FRAME (until then it's the key frame again)
	}
	add(e, &b, VAEncPictureParameterBufferType, sizeof(pic), &pic);
	if (key) {
		n = sequence_header(e, hdr);
		add_packed(e, &b, VAEncPackedHeaderSequence, hdr, n);
	}
	n = frame_header(e, hdr, key, slot);
	add_packed(e, &b, VAEncPackedHeaderPicture, hdr, n);
	VAEncTileGroupBufferAV1 tg = {.tg_start = 0, .tg_end = 0};
	add(e, &b, VAEncSliceParameterBufferType, sizeof(tg), &tg);

	long ret = -1;
	if (b.failed)
		goto out;
	if (CHECK(vaBeginPicture(e->va, e->ctx, src)))
		goto out;
	if (CHECK(vaRenderPicture(e->va, e->ctx, b.id, b.n))) {
		vaEndPicture(e->va, e->ctx);
		goto out;
	}
	if (CHECK(vaEndPicture(e->va, e->ctx)))
		goto out;
	// vaSyncBuffer waits holding only this context's lock in Mesa (vaSyncSurface would hold the driver's)
	if (CHECK(vaSyncBuffer(e->va, e->coded, VA_TIMEOUT_INFINITE)))
		goto out;
	VACodedBufferSegment *seg;
	if (CHECK(vaMapBuffer(e->va, e->coded, (void **)&seg)))
		goto out;
	size_t len = 0;
	unsigned qp = 0;
	for (VACodedBufferSegment *s = seg; s; s = s->next) {
		if (len + s->size > e->out_cap) {
			e->out_cap = (len + s->size) * 2;
			e->out = realloc(e->out, e->out_cap);
		}
		memcpy(e->out + len, s->buf, s->size);
		len += s->size;
		if (s->status & VA_CODED_BUF_STATUS_PICTURE_AVE_QP_MASK)
			qp = s->status & VA_CODED_BUF_STATUS_PICTURE_AVE_QP_MASK;
	}
	vaUnmapBuffer(e->va, e->coded);
	e->started = true;
	e->prev_slot = slot;
	e->in_slot[slot] = recon;
	if (key)
		e->in_slot[1] = recon; // a key frame refreshes every slot
	e->frame++;
	*out = e->out;
	if (info)
		*info = (struct av1enc_frame){.key = key, .qp = qp, .ms_encode = (now() - t0) * 1e3};
	ret = (long)len;
out:
	for (int i = 0; i < b.n; i++)
		vaDestroyBuffer(e->va, b.id[i]);
	return ret;
}
