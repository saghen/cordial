// av1enc: low-delay AV1 encoding through VA-API, ported from the C build's av1enc.c (at f59ff8c; its header has the
// why: what Mesa's VA frontend and radeonsi want, the references, rate control, the quantizer floor, the quality
// preset). Byte for byte the same parameters and packed headers, so the same bitstream.

use std::time::Instant;

use anyhow::{bail, Result};

use crate::bits::Bits;
use crate::va::{sys, Buffer, Config, Context, Surfaces, Va};

const VBV_MS: u64 = 500;
const QUALITY_BALANCE: u32 = 1 | 1 << 1; // Mesa's quality bits: speed 1, balance 3, quality 5, high quality 7
const OBU_SEQUENCE_HEADER: u8 = 1;
const OBU_FRAME_HEADER: u8 = 3;
const KEY_FRAME: u32 = 0;
const INTER_FRAME: u32 = 1;

pub struct Cfg {
    pub width: u32, // multiple of align()'s (the caller rounds)
    pub height: u32,
    pub fps: u32,
    pub kbps: u32,       // initial target
    pub min_qindex: u32, // floor of the quantizer (0: 1)
    pub refs: u32,       // 1: LAST only, 2: LAST + GOLDEN
}

pub struct Frame {
    pub key: bool,
    #[allow(dead_code)] // (for the stdout frame message, not ported yet)
    pub qp: u32,
    pub ms_encode: f64,
}

/// the OBU around b: header without extension, has_size_field, leb128 size
fn obu(mut b: Bits, kind: u8) -> Vec<u8> {
    b.trailing();
    let mut out = vec![kind << 3 | 1 << 1];
    let mut size = b.buf.len();
    loop {
        let byte = (size & 0x7f) as u8;
        size >>= 7;
        out.push(byte | if size > 0 { 0x80 } else { 0 });
        if size == 0 {
            break;
        }
    }
    out.extend_from_slice(&b.buf);
    out
}

/// The encode size's alignment. radeonsi codes AV1 on VCN 4 (RDNA3, gfx11: Navi 3x, Phoenix, Strix) at 64x16 and
/// pads the input to it, cropped only by a render size, which this encoder's frame header doesn't carry (Mesa 26.2.4,
/// radeon_vcn_enc.c), so sizes are chosen aligned there; VCN 5 codes them as they are (8x2). VA-API doesn't say;
/// the driver's name does ("... (radeonsi, navi31, ...", "(radeonsi, gfx1150, ...").
pub fn align(va: &Va) -> (u32, u32) {
    let v = va.vendor().to_lowercase();
    if v.contains("radeonsi, navi3") || v.contains("radeonsi, gfx11") {
        (64, 16)
    } else {
        (8, 2)
    }
}

pub fn supported(va: &Va) -> bool {
    va.entrypoints(sys::VAProfile::VAProfileAV1Profile0)
        .contains(&sys::VAEntrypoint::VAEntrypointEncSlice)
}

/// seq_level_idx by MaxPicSize / MaxDisplayRate (AV1 spec, Annex A)
fn pick_level(w: u32, h: u32, fps: u32) -> u8 {
    let pic = w as u64 * h as u64;
    let rate = pic * fps as u64;
    match () {
        _ if pic <= 2228224 && rate <= 133693440 => 9,  // 4.1
        _ if pic <= 8912896 && rate <= 267386880 => 12, // 5.0
        _ if pic <= 8912896 && rate <= 534773760 => 13, // 5.1
        _ => 16,                                        // 6.0
    }
}

pub struct Av1Enc {
    cfg: Cfg,
    level: u8,
    tx_mode: u32,
    kbps: u32,
    sent_kbps: u32,
    // field order is drop order: buffers and the context before the surfaces and the config
    coded: Buffer,
    ctx: Context,
    recon: Surfaces, // the two in the DPB slots + the one being written
    _config: Config,
    in_slot: [u32; 2], // which recon surface each DPB slot holds
    out: Vec<u8>,
    started: bool,
    prev_slot: usize,
    frame: u32, // frames since the last keyframe (order_hint = frame & 0xff)
}

impl Av1Enc {
    pub fn open(va: &Va, mut cfg: Cfg) -> Result<Self> {
        if cfg.fps == 0 {
            cfg.fps = 60;
        }
        let kbps = if cfg.kbps > 0 { cfg.kbps } else { 6000 };
        let level = pick_level(cfg.width, cfg.height, cfg.fps);
        let attr = |type_| sys::VAConfigAttrib { type_, value: 0 };
        let mut q = [
            attr(sys::VAConfigAttribType::VAConfigAttribRateControl),
            attr(sys::VAConfigAttribType::VAConfigAttribEncPackedHeaders),
            attr(sys::VAConfigAttribType::VAConfigAttribEncAV1Ext2),
            attr(sys::VAConfigAttribType::VAConfigAttribRTFormat),
        ];
        let (profile, entry) = (
            sys::VAProfile::VAProfileAV1Profile0,
            sys::VAEntrypoint::VAEntrypointEncSlice,
        );
        va.config_attributes(profile, entry, &mut q)?;
        let packed = sys::VA_ENC_PACKED_HEADER_SEQUENCE | sys::VA_ENC_PACKED_HEADER_PICTURE;
        if q[0].value == sys::VA_ATTRIB_NOT_SUPPORTED
            || q[0].value & sys::VA_RC_CBR == 0
            || q[1].value == sys::VA_ATTRIB_NOT_SUPPORTED
            || q[1].value & packed != packed
        {
            bail!(
                "driver lacks CBR or packed sequence/picture headers (rc {:#x} packed {:#x})",
                q[0].value,
                q[1].value
            );
        }
        let ext2 = if q[2].value == sys::VA_ATTRIB_NOT_SUPPORTED {
            0
        } else {
            q[2].value
        };
        let ext2 = sys::VAConfigAttribValEncAV1Ext2 { value: ext2 };
        // SAFETY: a u32 read through the union's bitfield view
        let tx_mode = if unsafe { ext2.bits.tx_mode_support() } & 4 != 0 {
            2
        } else {
            1
        }; // TX_MODE_SELECT / LARGEST
        let attr = |type_, value| sys::VAConfigAttrib { type_, value };
        let config = va.config(
            profile,
            entry,
            &mut [
                attr(
                    sys::VAConfigAttribType::VAConfigAttribRTFormat,
                    sys::VA_RT_FORMAT_YUV420,
                ),
                attr(sys::VAConfigAttribType::VAConfigAttribRateControl, sys::VA_RC_CBR),
                attr(sys::VAConfigAttribType::VAConfigAttribEncPackedHeaders, packed),
            ],
        )?;
        let recon = va.surfaces(sys::VA_RT_FORMAT_YUV420, cfg.width, cfg.height, 3, &mut [])?;
        let ctx = va.context(&config, cfg.width, cfg.height, &recon.ids)?;
        // generous: a 1440p key frame at 9 Mbps is ~100-300 kB
        let coded = ctx.buffer_empty(
            sys::VABufferType::VAEncCodedBufferType,
            (cfg.width * cfg.height) as usize,
        )?;
        eprintln!(
            "av1enc: {}x{}@{} CBR {kbps} kbps, min qindex {}, {} refs, level idx {level}, tx_mode {tx_mode}",
            cfg.width,
            cfg.height,
            cfg.fps,
            cfg.min_qindex,
            if cfg.refs == 1 { 1 } else { 2 }
        );
        Ok(Av1Enc {
            cfg,
            level,
            tx_mode,
            kbps,
            sent_kbps: 0,
            coded,
            ctx,
            recon,
            _config: config,
            in_slot: [sys::VA_INVALID_SURFACE; 2],
            out: Vec::with_capacity(1 << 20),
            started: false,
            prev_slot: 0,
            frame: 0,
        })
    }

    /// new target, applied from the next frame on (no keyframe)
    pub fn set_kbps(&mut self, kbps: u32) {
        if kbps >= 100 {
            self.kbps = kbps;
        }
    }

    fn sequence_header(&self) -> Vec<u8> {
        let mut b = Bits::default();
        b.put(0, 3); // seq_profile: main (8-bit 4:2:0)
        b.put(0, 1); // still_picture
        b.put(0, 1); // reduced_still_picture_header
        b.put(0, 1); // timing_info_present_flag
        b.put(0, 1); // initial_display_delay_present_flag
        b.put(0, 5); // operating_points_cnt_minus_1
        b.put(0, 12); // operating_point_idc[0]
        b.put(self.level as u32, 5);
        if self.level > 7 {
            b.put(0, 1); // seq_tier: main
        }
        b.put(15, 4); // frame_width_bits_minus_1
        b.put(15, 4); // frame_height_bits_minus_1
        b.put(self.cfg.width - 1, 16);
        b.put(self.cfg.height - 1, 16);
        b.put(0, 1); // frame_id_numbers_present_flag
        b.put(0, 1); // use_128x128_superblock
        b.put(0, 1); // enable_filter_intra
        b.put(0, 1); // enable_intra_edge_filter
        b.put(0, 1); // enable_interintra_compound
        b.put(0, 1); // enable_masked_compound
        b.put(0, 1); // enable_warped_motion
        b.put(0, 1); // enable_dual_filter
        b.put(1, 1); // enable_order_hint
        b.put(0, 1); //   enable_jnt_comp
        b.put(0, 1); //   enable_ref_frame_mvs
        b.put(0, 1); // seq_choose_screen_content_tools
        b.put(0, 1); //   seq_force_screen_content_tools
        b.put(7, 3); // order_hint_bits_minus_1
        b.put(0, 1); // enable_superres
        b.put(1, 1); // enable_cdef
        b.put(0, 1); // enable_restoration
                     // color_config
        b.put(0, 1); // high_bitdepth
        b.put(0, 1); // mono_chrome
        b.put(1, 1); // color_description_present_flag
        b.put(1, 8); // color_primaries: BT.709
        b.put(13, 8); // transfer_characteristics: sRGB
        b.put(6, 8); // matrix_coefficients: BT.601
        b.put(0, 1); // color_range: limited
        b.put(0, 2); // chroma_sample_position: unknown
        b.put(0, 1); // separate_uv_delta_q
        b.put(0, 1); // film_grain_params_present
        obu(b, OBU_SEQUENCE_HEADER)
    }

    /// the frame header as far as Mesa parses it (through uniform_tile_spacing_flag)
    fn frame_header(&self, key: bool, slot: usize) -> Vec<u8> {
        let mut b = Bits::default();
        b.put(0, 1); // show_existing_frame
        b.put(if key { KEY_FRAME } else { INTER_FRAME }, 2);
        b.put(1, 1); // show_frame
        if !key {
            b.put(0, 1); // error_resilient_mode (a shown key frame implies 1)
        }
        b.put(0, 1); // disable_cdf_update
        b.put(0, 1); // frame_size_override_flag
        b.put(self.frame & 0xff, 8); // order_hint
        if !key {
            b.put(0, 3); // primary_ref_frame: LAST's context
            b.put(1 << slot, 8); // refresh_frame_flags
            b.put(0, 1); // frame_refs_short_signaling
            for i in 0..7 {
                b.put(if i == 3 { slot } else { self.prev_slot } as u32, 3); // ref_frame_idx[i]: GOLDEN = the other slot
            }
            b.put(0, 1); // render_and_frame_size_different
            b.put(0, 1); // allow_high_precision_mv
            b.put(0, 1); // is_filter_switchable
            b.put(0, 2); //   interpolation_filter: EIGHTTAP
            b.put(0, 1); // is_motion_mode_switchable
        } else {
            b.put(0, 1); // render_and_frame_size_different
        }
        b.put(0, 1); // disable_frame_end_update_cdf
        b.flag(true); // uniform_tile_spacing_flag (radeonsi lays out the tiles itself)
        obu(b, OBU_FRAME_HEADER)
    }

    fn misc<T>(&self, kind: sys::VAEncMiscParameterType::Type, data: &T) -> Result<Buffer> {
        // VAEncMiscParameterBuffer: the type, then the data in place of its flexible array
        let mut buf = vec![0u8; 4 + std::mem::size_of::<T>()];
        buf[..4].copy_from_slice(&kind.to_ne_bytes());
        // SAFETY: T is a plain C struct
        buf[4..].copy_from_slice(unsafe {
            std::slice::from_raw_parts(data as *const T as *const u8, std::mem::size_of::<T>())
        });
        self.ctx
            .buffer_bytes(sys::VABufferType::VAEncMiscParameterBufferType, &buf)
    }

    fn packed(&self, kind: u32, data: &[u8], bufs: &mut Vec<Buffer>) -> Result<()> {
        let p = sys::VAEncPackedHeaderParameterBuffer {
            type_: kind,
            bit_length: data.len() as u32 * 8,
            has_emulation_bytes: 0,
            ..Default::default()
        };
        bufs.push(
            self.ctx
                .buffer(sys::VABufferType::VAEncPackedHeaderParameterBufferType, &p)?,
        );
        bufs.push(
            self.ctx
                .buffer_bytes(sys::VABufferType::VAEncPackedHeaderDataBufferType, data)?,
        );
        Ok(())
    }

    fn rate_control(&mut self, key: bool, bufs: &mut Vec<Buffer>) -> Result<()> {
        let bps = self.kbps * 1000;
        let mut rc = sys::VAEncMiscParameterRateControl {
            bits_per_second: bps,
            target_percentage: 100,
            window_size: VBV_MS as u32,
            min_qp: self.cfg.min_qindex.max(1),
            max_qp: 255,
            ..Default::default()
        };
        // SAFETY: setting a bit through the union's bitfield view
        unsafe { rc.rc_flags.bits.set_disable_bit_stuffing(1) };
        bufs.push(self.misc(sys::VAEncMiscParameterType::VAEncMiscParameterTypeRateControl, &rc)?);
        // the HRD only with the sequence: Mesa resets the buffer level to the initial fullness with every HRD buffer
        if key {
            let vbv = (bps as u64 * VBV_MS / 1000) as u32;
            let hrd = sys::VAEncMiscParameterHRD {
                buffer_size: vbv,
                initial_buffer_fullness: vbv / 4 * 3,
                ..Default::default()
            };
            bufs.push(self.misc(sys::VAEncMiscParameterType::VAEncMiscParameterTypeHRD, &hrd)?);
        }
        self.sent_kbps = self.kbps;
        Ok(())
    }

    /// encode src (NV12, cfg size) and wait for it; the temporal unit (OBUs, no temporal delimiter), valid until the
    /// next call
    pub fn encode(&mut self, src: u32, key: bool) -> Result<(&[u8], Frame)> {
        let t0 = Instant::now();
        let key = key || !self.started;
        if key {
            self.frame = 0;
        }
        let slot = if key { 0 } else { 1 - self.prev_slot };
        let mut recon = self.recon.ids[0];
        for &r in &self.recon.ids {
            if r != self.in_slot[0] && r != self.in_slot[1] {
                recon = r;
            }
        }
        let mut bufs = Vec::with_capacity(12);
        if key {
            let mut seq = sys::VAEncSequenceParameterBufferAV1 {
                seq_profile: 0,
                seq_level_idx: self.level,
                intra_period: 0xffff,
                ip_period: 1,
                bits_per_second: self.kbps * 1000,
                order_hint_bits_minus_1: 7,
                ..Default::default()
            };
            // SAFETY: setting bits through the union's bitfield view
            unsafe {
                let f = &mut seq.seq_fields.bits;
                f.set_enable_order_hint(1);
                f.set_enable_cdef(1);
                f.set_subsampling_x(1);
                f.set_subsampling_y(1);
            }
            bufs.push(
                self.ctx
                    .buffer(sys::VABufferType::VAEncSequenceParameterBufferType, &seq)?,
            );
            let fr = sys::VAEncMiscParameterFrameRate {
                framerate: 1 << 16 | self.cfg.fps,
                ..Default::default()
            };
            bufs.push(self.misc(sys::VAEncMiscParameterType::VAEncMiscParameterTypeFrameRate, &fr)?);
            let ql = sys::VAEncMiscParameterBufferQualityLevel {
                quality_level: QUALITY_BALANCE,
                ..Default::default()
            };
            bufs.push(self.misc(sys::VAEncMiscParameterType::VAEncMiscParameterTypeQualityLevel, &ql)?);
        }
        // misc parameters before the picture parameters: the picture's min/max qindex must win
        if key || self.kbps != self.sent_kbps {
            self.rate_control(key, &mut bufs)?;
        }

        let (w, h) = (self.cfg.width, self.cfg.height);
        let mut pic = sys::VAEncPictureParameterBufferAV1 {
            frame_width_minus_1: (w - 1) as u16,
            frame_height_minus_1: (h - 1) as u16,
            reconstructed_frame: recon,
            coded_buf: self.coded.id,
            reference_frames: [sys::VA_INVALID_SURFACE; 8],
            primary_ref_frame: if key { 7 } else { 0 },
            order_hint: (self.frame & 0xff) as u8,
            refresh_frame_flags: if key { 0xff } else { 1 << slot },
            tile_cols: 1,
            tile_rows: 1,
            min_base_qindex: self.cfg.min_qindex.max(1) as u8,
            max_base_qindex: 255,
            ..Default::default()
        };
        pic.width_in_sbs_minus_1[0] = (w.div_ceil(64) - 1) as u16;
        pic.height_in_sbs_minus_1[0] = (h.div_ceil(64) - 1) as u16;
        // SAFETY: setting bits through the unions' bitfield views
        unsafe {
            pic.picture_flags
                .bits
                .set_frame_type(if key { KEY_FRAME } else { INTER_FRAME });
            pic.picture_flags.bits.set_error_resilient_mode(key as u32);
            pic.mode_control_flags.bits.set_tx_mode(self.tx_mode);
            pic.tile_group_obu_hdr_info.bits.set_obu_has_size_field(1);
            if !key {
                pic.ref_frame_ctrl_l0.fields.set_search_idx0(1); // LAST_FRAME
                if self.frame >= 2 && self.cfg.refs != 1 {
                    pic.ref_frame_ctrl_l0.fields.set_search_idx1(4); // GOLDEN_FRAME (until then the key frame again)
                }
            }
        }
        if !key {
            pic.reference_frames[0] = self.in_slot[0];
            pic.reference_frames[1] = self.in_slot[1];
            for (i, r) in pic.ref_frame_idx.iter_mut().enumerate() {
                *r = if i == 3 { slot } else { self.prev_slot } as u8;
            }
        }
        bufs.push(
            self.ctx
                .buffer(sys::VABufferType::VAEncPictureParameterBufferType, &pic)?,
        );
        if key {
            self.packed(
                sys::VAEncPackedHeaderType::VAEncPackedHeaderSequence,
                &self.sequence_header(),
                &mut bufs,
            )?;
        }
        self.packed(
            sys::VAEncPackedHeaderType::VAEncPackedHeaderPicture,
            &self.frame_header(key, slot),
            &mut bufs,
        )?;
        let tg = sys::VAEncTileGroupBufferAV1 {
            tg_start: 0,
            tg_end: 0,
            ..Default::default()
        };
        bufs.push(self.ctx.buffer(sys::VABufferType::VAEncSliceParameterBufferType, &tg)?);

        self.ctx.render(src, &bufs)?;
        self.coded.sync()?;
        self.out.clear();
        let qp = self.coded.read_coded(&mut self.out)?;
        self.started = true;
        self.prev_slot = slot;
        self.in_slot[slot] = recon;
        if key {
            self.in_slot[1] = recon; // a key frame refreshes every slot
        }
        self.frame += 1;
        let ms_encode = t0.elapsed().as_secs_f64() * 1e3;
        Ok((&self.out, Frame { key, qp, ms_encode }))
    }
}
