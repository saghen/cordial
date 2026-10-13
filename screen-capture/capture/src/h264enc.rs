// h264enc: low-delay H.264 encoding through VA-API (P4), built like av1enc.rs: CBR, IPPP with one reference (the
// previous frame), no B-frames, a key frame only when asked, the same rate control, HRD and quality preset.
//
// What Mesa's VA frontend and radeonsi want (Mesa 26.2, frontends/va/picture_h264_enc.c, radeonsi/mm/radeon_vcn_enc*.c):
// - Packed SPS, PPS and slice headers. Mesa parses them into its own state (the SPS's VUI, the PPS's entropy coder,
//   the slice's fields); radeonsi then writes the SPS and PPS itself from that state (it keeps only our NAL byte), and
//   only when the frame's packed headers include a slice header besides them. The VCN firmware writes every slice
//   header from the parsed fields. So the headers here must say exactly what the VA buffers say.
// - frame_num restarts at the IDR and counts frames; Mesa keeps the same count (picture.c), and the reference list
//   gives the previous frame's surface.
// The SPS is what WebRTC leaves alone (Discord's cros-codecs fork, h264/predictor.rs: "must be zero to avoid webrtc
// rewriting Sps"): VUI bitstream_restriction with max_num_reorder_frames 0 and max_dec_frame_buffering 1 =
// max_num_ref_frames. High profile with CABAC and 8x8 transforms, as that fork does for High. The colour description
// is the VPP's output, as in av1enc.rs: BT.709 primaries, sRGB transfer, BT.601 matrix, limited range.

use std::time::Instant;

use anyhow::{bail, Result};

use crate::av1enc::Frame;
use crate::bits::Bits;
use crate::va::{sys, Buffer, Config, Context, Surfaces, Va};

const VBV_MS: u64 = 500;
const QUALITY_BALANCE: u32 = 1 | 1 << 1; // Mesa's quality bits, as av1enc.rs
const LOG2_MAX_FRAME_NUM: u32 = 16;
const LOG2_MAX_POC_LSB: u32 = 16;
const NAL_SLICE: u32 = 1;
const NAL_IDR: u32 = 5;
const NAL_SPS: u32 = 7;
const NAL_PPS: u32 = 8;
const SLICE_P: u32 = 5; // P, all slices of the picture (what radeonsi writes)
const SLICE_I: u32 = 7;

pub struct Cfg {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub kbps: u32,   // initial target
    pub min_qp: u32, // floor of the quantizer (0: none)
}

pub fn supported(va: &Va) -> bool {
    va.entrypoints(sys::VAProfile::VAProfileH264High)
        .contains(&sys::VAEntrypoint::VAEntrypointEncSlice)
}

/// level_idc by MaxFS and MaxMBPS in macroblocks (H.264 Table A-1)
fn pick_level(mbs: u32, fps: u32) -> u8 {
    let rate = mbs * fps;
    match () {
        _ if mbs <= 3600 && rate <= 108000 => 31,
        _ if mbs <= 5120 && rate <= 216000 => 32,
        _ if mbs <= 8192 && rate <= 245760 => 41,
        _ if mbs <= 8704 && rate <= 522240 => 42,
        _ if mbs <= 22080 && rate <= 589824 => 50,
        _ if mbs <= 36864 && rate <= 983040 => 51,
        _ => 52,
    }
}

/// a NAL unit: start code, header, the RBSP with emulation prevention
fn nal(ref_idc: u32, kind: u32, rbsp: &[u8]) -> Vec<u8> {
    let mut out = vec![0, 0, 0, 1, (ref_idc << 5 | kind) as u8];
    let mut zeros = 0;
    for &b in rbsp {
        if zeros >= 2 && b <= 3 {
            out.push(3);
            zeros = 0;
        }
        out.push(b);
        zeros = if b == 0 { zeros + 1 } else { 0 };
    }
    out
}

pub struct H264Enc {
    cfg: Cfg,
    level: u8,
    mbs: (u32, u32),
    kbps: u32,
    sent_kbps: u32,
    // field order is drop order: buffers and the context before the surfaces and the config
    coded: Buffer,
    ctx: Context,
    recon: Surfaces, // the reference + the one being written + a spare (Mesa evicts a DPB entry a frame late)
    _config: Config,
    reference: u32, // the previous frame's recon surface
    out: Vec<u8>,
    started: bool,
    frame: u32, // frames since the IDR (frame_num, and the POC is twice it)
    idr_id: u32,
}

impl H264Enc {
    pub fn open(va: &Va, mut cfg: Cfg) -> Result<Self> {
        if cfg.fps == 0 {
            cfg.fps = 60;
        }
        let kbps = if cfg.kbps > 0 { cfg.kbps } else { 6000 };
        let mbs = (cfg.width.div_ceil(16), cfg.height.div_ceil(16));
        let level = pick_level(mbs.0 * mbs.1, cfg.fps);
        let attr = |type_| sys::VAConfigAttrib { type_, value: 0 };
        let mut q = [
            attr(sys::VAConfigAttribType::VAConfigAttribRateControl),
            attr(sys::VAConfigAttribType::VAConfigAttribEncPackedHeaders),
        ];
        let (profile, entry) = (
            sys::VAProfile::VAProfileH264High,
            sys::VAEntrypoint::VAEntrypointEncSlice,
        );
        va.config_attributes(profile, entry, &mut q)?;
        let packed =
            sys::VA_ENC_PACKED_HEADER_SEQUENCE | sys::VA_ENC_PACKED_HEADER_PICTURE | sys::VA_ENC_PACKED_HEADER_SLICE;
        if q[0].value == sys::VA_ATTRIB_NOT_SUPPORTED
            || q[0].value & sys::VA_RC_CBR == 0
            || q[1].value == sys::VA_ATTRIB_NOT_SUPPORTED
            || q[1].value & packed != packed
        {
            bail!(
                "driver lacks CBR or packed sequence/picture/slice headers (rc {:#x} packed {:#x})",
                q[0].value,
                q[1].value
            );
        }
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
        let coded = ctx.buffer_empty(
            sys::VABufferType::VAEncCodedBufferType,
            (cfg.width * cfg.height) as usize,
        )?;
        eprintln!(
            "h264enc: {}x{}@{} CBR {kbps} kbps, min qp {}, High level {}.{}",
            cfg.width,
            cfg.height,
            cfg.fps,
            cfg.min_qp,
            level / 10,
            level % 10
        );
        Ok(H264Enc {
            cfg,
            level,
            mbs,
            kbps,
            sent_kbps: 0,
            coded,
            ctx,
            recon,
            _config: config,
            reference: sys::VA_INVALID_SURFACE,
            out: Vec::with_capacity(1 << 20),
            started: false,
            frame: 0,
            idr_id: 0,
        })
    }

    /// new target, applied from the next frame on (no keyframe)
    pub fn set_kbps(&mut self, kbps: u32) {
        if kbps >= 100 {
            self.kbps = kbps;
        }
    }

    /// (right, bottom) frame cropping in chroma samples: the coded size is whole macroblocks
    fn crop(&self) -> (u32, u32) {
        (
            (self.mbs.0 * 16 - self.cfg.width) / 2,
            (self.mbs.1 * 16 - self.cfg.height) / 2,
        )
    }

    fn sps(&self) -> Vec<u8> {
        let mut b = Bits::default();
        b.put(100, 8); // profile_idc: High
        b.put(0, 8); // constraint_set flags, reserved_zero_2bits
        b.put(self.level as u32, 8);
        b.ue(0); // seq_parameter_set_id
        b.ue(1); // chroma_format_idc: 4:2:0
        b.ue(0); // bit_depth_luma_minus8
        b.ue(0); // bit_depth_chroma_minus8
        b.put(0, 1); // qpprime_y_zero_transform_bypass_flag
        b.put(0, 1); // seq_scaling_matrix_present_flag
        b.ue(LOG2_MAX_FRAME_NUM - 4);
        b.ue(0); // pic_order_cnt_type
        b.ue(LOG2_MAX_POC_LSB - 4);
        b.ue(1); // max_num_ref_frames
        b.put(0, 1); // gaps_in_frame_num_value_allowed_flag
        b.ue(self.mbs.0 - 1);
        b.ue(self.mbs.1 - 1);
        b.put(1, 1); // frame_mbs_only_flag
        b.put(1, 1); // direct_8x8_inference_flag
        let (right, bottom) = self.crop();
        b.flag(right > 0 || bottom > 0); // frame_cropping_flag
        if right > 0 || bottom > 0 {
            b.ue(0);
            b.ue(right);
            b.ue(0);
            b.ue(bottom);
        }
        b.put(1, 1); // vui_parameters_present_flag
        b.put(1, 1); //   aspect_ratio_info_present_flag
        b.put(1, 8); //     aspect_ratio_idc: 1:1
        b.put(0, 1); //   overscan_info_present_flag
        b.put(1, 1); //   video_signal_type_present_flag
        b.put(5, 3); //     video_format: unspecified
        b.put(0, 1); //     video_full_range_flag
        b.put(1, 1); //     colour_description_present_flag
        b.put(1, 8); //       colour_primaries: BT.709
        b.put(13, 8); //      transfer_characteristics: sRGB
        b.put(6, 8); //       matrix_coefficients: BT.601
        b.put(0, 1); //   chroma_loc_info_present_flag
        b.put(1, 1); //   timing_info_present_flag
        b.put(1, 32); //    num_units_in_tick
        b.put(self.cfg.fps * 2, 32); // time_scale
        b.put(0, 1); //     fixed_frame_rate_flag
        b.put(0, 1); //   nal_hrd_parameters_present_flag
        b.put(0, 1); //   vcl_hrd_parameters_present_flag
        b.put(0, 1); //   pic_struct_present_flag
        b.put(1, 1); //   bitstream_restriction_flag
        b.put(1, 1); //     motion_vectors_over_pic_boundaries_flag
        b.ue(0); //         max_bytes_per_pic_denom
        b.ue(0); //         max_bits_per_mb_denom
        b.ue(16); //        log2_max_mv_length_horizontal
        b.ue(16); //        log2_max_mv_length_vertical
        b.ue(0); //         max_num_reorder_frames
        b.ue(1); //         max_dec_frame_buffering
        b.trailing();
        nal(3, NAL_SPS, &b.buf)
    }

    fn pps(&self) -> Vec<u8> {
        let mut b = Bits::default();
        b.ue(0); // pic_parameter_set_id
        b.ue(0); // seq_parameter_set_id
        b.put(1, 1); // entropy_coding_mode_flag: CABAC
        b.put(0, 1); // bottom_field_pic_order_in_frame_present_flag
        b.ue(0); // num_slice_groups_minus1
        b.ue(0); // num_ref_idx_l0_default_active_minus1
        b.ue(0); // num_ref_idx_l1_default_active_minus1
        b.put(0, 1); // weighted_pred_flag
        b.put(0, 2); // weighted_bipred_idc
        b.se(0); // pic_init_qp_minus26
        b.se(0); // pic_init_qs_minus26
        b.se(0); // chroma_qp_index_offset
        b.put(1, 1); // deblocking_filter_control_present_flag
        b.put(0, 1); // constrained_intra_pred_flag
        b.put(0, 1); // redundant_pic_cnt_present_flag
        b.put(1, 1); // transform_8x8_mode_flag
        b.put(0, 1); // pic_scaling_matrix_present_flag
        b.se(0); // second_chroma_qp_index_offset
        b.trailing();
        nal(3, NAL_PPS, &b.buf)
    }

    /// the slice header (no slice data; the firmware writes its own from what Mesa parses here); (bytes, bits)
    fn slice_header(&self, key: bool) -> (Vec<u8>, usize) {
        let mut b = Bits::default();
        b.ue(0); // first_mb_in_slice
        b.ue(if key { SLICE_I } else { SLICE_P });
        b.ue(0); // pic_parameter_set_id
        b.put(self.frame & 0xffff, LOG2_MAX_FRAME_NUM);
        if key {
            b.ue(self.idr_id & 0xffff);
        }
        b.put(self.frame * 2 & 0xffff, LOG2_MAX_POC_LSB);
        if !key {
            b.put(0, 1); // num_ref_idx_active_override_flag
            b.put(0, 1); // ref_pic_list_modification_flag_l0
        }
        if key {
            b.put(0, 1); // no_output_of_prior_pics_flag
            b.put(0, 1); // long_term_reference_flag
        } else {
            b.put(0, 1); // adaptive_ref_pic_marking_mode_flag
            b.ue(0); // cabac_init_idc
        }
        b.se(0); // slice_qp_delta
        b.ue(0); // disable_deblocking_filter_idc
        b.se(0); // slice_alpha_c0_offset_div2
        b.se(0); // slice_beta_offset_div2
        let bits = b.bits;
        let out = nal(if key { 3 } else { 2 }, if key { NAL_IDR } else { NAL_SLICE }, &b.buf);
        let pad = b.buf.len() * 8 - bits;
        let len = out.len() * 8 - pad;
        (out, len)
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

    fn packed(&self, kind: u32, data: &[u8], bits: usize, bufs: &mut Vec<Buffer>) -> Result<()> {
        let p = sys::VAEncPackedHeaderParameterBuffer {
            type_: kind,
            bit_length: bits as u32,
            has_emulation_bytes: 1,
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
            min_qp: self.cfg.min_qp,
            max_qp: 51,
            ..Default::default()
        };
        // SAFETY: setting a bit through the union's bitfield view
        unsafe { rc.rc_flags.bits.set_disable_bit_stuffing(1) };
        bufs.push(self.misc(sys::VAEncMiscParameterType::VAEncMiscParameterTypeRateControl, &rc)?);
        // the HRD only with the sequence, as av1enc.rs (Mesa resets the buffer level with every HRD buffer)
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

    fn picture(id: u32, frame: u32, flags: u32) -> sys::VAPictureH264 {
        sys::VAPictureH264 {
            picture_id: id,
            frame_idx: frame,
            flags,
            TopFieldOrderCnt: (frame * 2 & 0xffff) as i32,
            BottomFieldOrderCnt: (frame * 2 & 0xffff) as i32,
            ..Default::default()
        }
    }

    /// encode src (NV12, cfg size) and wait for it; the access unit (Annex B: SPS and PPS before an IDR), valid until
    /// the next call
    pub fn encode(&mut self, src: u32, key: bool) -> Result<(&[u8], Frame)> {
        let t0 = Instant::now();
        let key = key || !self.started;
        if key {
            self.frame = 0;
        }
        let recon = *self.recon.ids.iter().find(|&&r| r != self.reference).unwrap();
        let invalid = Self::picture(sys::VA_INVALID_SURFACE, 0, sys::VA_PICTURE_H264_INVALID);
        let mut bufs = Vec::with_capacity(14);
        if key {
            let (right, bottom) = self.crop();
            let mut seq = sys::VAEncSequenceParameterBufferH264 {
                seq_parameter_set_id: 0,
                level_idc: self.level,
                intra_period: 0xffff,
                intra_idr_period: 0xffff,
                ip_period: 1,
                bits_per_second: self.kbps * 1000,
                max_num_ref_frames: 1,
                picture_width_in_mbs: self.mbs.0 as u16,
                picture_height_in_mbs: self.mbs.1 as u16,
                frame_cropping_flag: (right > 0 || bottom > 0) as u8,
                frame_crop_right_offset: right,
                frame_crop_bottom_offset: bottom,
                vui_parameters_present_flag: 1,
                aspect_ratio_idc: 1,
                num_units_in_tick: 1,
                time_scale: self.cfg.fps * 2,
                ..Default::default()
            };
            // SAFETY: setting bits through the unions' bitfield views
            unsafe {
                let f = &mut seq.seq_fields.bits;
                f.set_chroma_format_idc(1);
                f.set_frame_mbs_only_flag(1);
                f.set_direct_8x8_inference_flag(1);
                f.set_log2_max_frame_num_minus4(LOG2_MAX_FRAME_NUM - 4);
                f.set_pic_order_cnt_type(0);
                f.set_log2_max_pic_order_cnt_lsb_minus4(LOG2_MAX_POC_LSB - 4);
                let v = &mut seq.vui_fields.bits;
                v.set_aspect_ratio_info_present_flag(1);
                v.set_timing_info_present_flag(1);
                v.set_bitstream_restriction_flag(1);
                v.set_motion_vectors_over_pic_boundaries_flag(1);
                v.set_log2_max_mv_length_horizontal(16);
                v.set_log2_max_mv_length_vertical(16);
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
        if key || self.kbps != self.sent_kbps {
            self.rate_control(key, &mut bufs)?;
        }

        let mut pic = sys::VAEncPictureParameterBufferH264 {
            CurrPic: Self::picture(recon, self.frame, 0),
            ReferenceFrames: [invalid; 16],
            coded_buf: self.coded.id,
            frame_num: (self.frame & 0xffff) as u16,
            pic_init_qp: 26,
            ..Default::default()
        };
        if !key {
            pic.ReferenceFrames[0] = Self::picture(
                self.reference,
                self.frame - 1,
                sys::VA_PICTURE_H264_SHORT_TERM_REFERENCE,
            );
        }
        // SAFETY: setting bits through the union's bitfield view
        unsafe {
            let f = &mut pic.pic_fields.bits;
            f.set_idr_pic_flag(key as u32);
            f.set_reference_pic_flag(1);
            f.set_entropy_coding_mode_flag(1);
            f.set_transform_8x8_mode_flag(1);
            f.set_deblocking_filter_control_present_flag(1);
        }
        bufs.push(
            self.ctx
                .buffer(sys::VABufferType::VAEncPictureParameterBufferType, &pic)?,
        );
        if key {
            let sps = self.sps();
            self.packed(
                sys::VAEncPackedHeaderType::VAEncPackedHeaderSequence,
                &sps,
                sps.len() * 8,
                &mut bufs,
            )?;
            let pps = self.pps();
            self.packed(
                sys::VAEncPackedHeaderType::VAEncPackedHeaderPicture,
                &pps,
                pps.len() * 8,
                &mut bufs,
            )?;
        }
        let (sh, bits) = self.slice_header(key);
        self.packed(sys::VAEncPackedHeaderType::VAEncPackedHeaderSlice, &sh, bits, &mut bufs)?;
        let mut slice = sys::VAEncSliceParameterBufferH264 {
            macroblock_address: 0,
            num_macroblocks: self.mbs.0 * self.mbs.1,
            macroblock_info: sys::VA_INVALID_ID,
            slice_type: (if key { SLICE_I } else { SLICE_P } % 5) as u8,
            idr_pic_id: (self.idr_id & 0xffff) as u16,
            pic_order_cnt_lsb: (self.frame * 2 & 0xffff) as u16,
            RefPicList0: [invalid; 32],
            RefPicList1: [invalid; 32],
            ..Default::default()
        };
        if !key {
            slice.RefPicList0[0] = pic.ReferenceFrames[0];
        }
        bufs.push(
            self.ctx
                .buffer(sys::VABufferType::VAEncSliceParameterBufferType, &slice)?,
        );

        self.ctx.render(src, &bufs)?;
        self.coded.sync()?;
        self.out.clear();
        let qp = self.coded.read_coded(&mut self.out)?;
        self.started = true;
        self.reference = recon;
        if key {
            self.idr_id += 1;
        }
        self.frame += 1;
        let ms_encode = t0.elapsed().as_secs_f64() * 1e3;
        Ok((&self.out, Frame { key, qp, ms_encode }))
    }
}
