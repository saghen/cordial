// capture, the Rust port (P2): so far the clip path only, the C's `--clip` run with the same VPP and AV1 encoder, for
// the byte-for-byte check against capture/ (PLAN P2, crates.md prototype 1). The cast (PipeWire, D-Bus), stdin
// commands, stdout frames and the preview come next.
//
//   mincord-capture-rs --clip F.i420 --clip-size WxH [--size WxH] [--fps 60] [--device /dev/dri/renderDN]
//                      [--kbps 6000] [--av1-refs 1|2] [--av1-min-q 10] [--drop-ms 300] [--encode-out F.ivf]
//
// Threads: a reader thread reads the clip, stamps the barcode and converts I420 to NV12 (CLIP_RING frames ahead); the
// main thread paces it at --fps, uploads, VPP-scales into a ring slot and encodes it, as the C's clip_run.

mod av1enc;
mod va;

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::os::unix::fs::FileExt;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use anyhow::{bail, Context as _, Result};

use va::{fence_wait, sys, vpp_submit, Va};

const RING: usize = 3;
const CLIP_RING: usize = 6;

struct Opts {
    clip: String,
    clip_w: u32,
    clip_h: u32,
    max_w: u32,
    max_h: u32,
    fps: u32,
    device: String,
    kbps: u32,
    refs: u32,
    min_qindex: u32,
    drop_ms: f64,
    ivf: Option<String>,
}

fn usage() -> ! {
    eprintln!(
        "usage: mincord-capture-rs --clip FILE.i420 --clip-size WxH [--size WxH] [--fps 60] [--device /dev/dri/renderDN]\n\
         \x20                         [--kbps 6000] [--av1-refs 1|2] [--av1-min-q 10] [--drop-ms 300] [--encode-out FILE.ivf]"
    );
    std::process::exit(2)
}

fn parse_size(s: &str, min: u32) -> (u32, u32) {
    match s.split_once('x').map(|(w, h)| (w.parse(), h.parse())) {
        Some((Ok(w), Ok(h))) if w >= min && h >= min => (w, h),
        _ => usage(),
    }
}

fn opts() -> Opts {
    let mut o = Opts {
        clip: String::new(),
        clip_w: 0,
        clip_h: 0,
        max_w: 16384, // no box: the source's own size
        max_h: 16384,
        fps: 60,
        device: "/dev/dri/renderD128".into(),
        kbps: 6000,
        refs: 2,
        min_qindex: 10,
        drop_ms: 300.0,
        ivf: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut v = || args.next().unwrap_or_else(|| usage());
        let num = |s: String| s.parse().unwrap_or_else(|_| usage());
        match a.as_str() {
            "--clip" => o.clip = v(),
            "--clip-size" => (o.clip_w, o.clip_h) = parse_size(&v(), 16),
            "--size" => (o.max_w, o.max_h) = parse_size(&v(), 16),
            "--fps" => o.fps = num(v()),
            "--device" => o.device = v(),
            "--kbps" => o.kbps = num(v()),
            "--av1-refs" => o.refs = num(v()),
            "--av1-min-q" => o.min_qindex = num(v()),
            "--drop-ms" => o.drop_ms = v().parse().unwrap_or_else(|_| usage()),
            "--encode-out" => o.ivf = Some(v()),
            "--start" => {}
            _ => usage(),
        }
    }
    if o.clip.is_empty() || o.clip_w == 0 || o.fps == 0 {
        usage()
    }
    o
}

/// iw x ih fitted inside bw x bh, aspect kept, never upscaled; width a multiple of wa, height of 2, both >= min
fn fit(iw: u32, ih: u32, bw: u32, bh: u32, wa: u32, min: u32) -> (u32, u32) {
    let (iw, ih, bw, bh) = (iw as u64, ih as u64, bw as u64, bh as u64);
    let (mut fw, mut fh) = (iw, ih);
    if iw > bw || ih > bh {
        if iw * bh >= ih * bw {
            (fw, fh) = (bw, ih * bw / iw);
        } else {
            (fw, fh) = (iw * bh / ih, bh);
        }
    }
    ((fw as u32 / wa * wa).max(min), (fh as u32 & !1).max(min))
}

/// the clip's frames as NV12 with the barcode, in order, CLIP_RING ahead of the encoder
fn clip_reader(file: File, w: u32, h: u32, count: u64, tx: mpsc::SyncSender<Vec<u8>>) {
    let ysize = (w * h) as usize;
    let fsize = ysize * 3 / 2;
    let mut raw = vec![0u8; fsize];
    for idx in 0u64.. {
        if file.read_exact_at(&mut raw, (idx % count) * fsize as u64).is_err() {
            raw.fill(128);
        }
        // barcode: the frame index's 16 bits as 32x32 blocks along the bottom
        for b in 0..16 {
            let v = if (idx >> b) & 1 != 0 { 235 } else { 16 };
            for r in h - 32..h {
                let at = (r * w) as usize + b * 32;
                raw[at..at + 32].fill(v);
            }
        }
        let mut d = vec![0u8; raw.len()];
        d[..ysize].copy_from_slice(&raw[..ysize]);
        let (u, v) = raw[ysize..].split_at(ysize / 4);
        for (i, uv) in d[ysize..].as_chunks_mut::<2>().0.iter_mut().enumerate() {
            uv[0] = u[i];
            uv[1] = v[i];
        }
        if tx.send(d).is_err() {
            return;
        }
    }
}

fn rusage_s() -> f64 {
    // SAFETY: getrusage fills the struct
    let ru = unsafe {
        let mut ru = std::mem::zeroed::<libc::rusage>();
        libc::getrusage(libc::RUSAGE_SELF, &mut ru);
        ru
    };
    let t = |tv: libc::timeval| tv.tv_sec as f64 + tv.tv_usec as f64 / 1e6;
    t(ru.ru_utime) + t(ru.ru_stime)
}

/// GPU time of this process: amdgpu's fdinfo drm-engine-<engine> (ns busy), summed over our distinct DRM clients
fn gpu_ms(frames: u64) -> String {
    let mut ids = std::collections::HashSet::new();
    let mut engines: Vec<(String, f64)> = Vec::new();
    for e in std::fs::read_dir("/proc/self/fdinfo").into_iter().flatten().flatten() {
        let Ok(text) = std::fs::read_to_string(e.path()) else {
            continue;
        };
        let id = text
            .lines()
            .find_map(|l| l.strip_prefix("drm-client-id:"))
            .map(str::trim);
        if !id.is_some_and(|id| ids.insert(id.to_string())) {
            continue;
        }
        for l in text.lines() {
            let Some(rest) = l.strip_prefix("drm-engine-") else {
                continue;
            };
            if rest.starts_with("capacity-") {
                continue;
            }
            let Some((name, v)) = rest.split_once(':') else {
                continue;
            };
            let ns: f64 = v.trim().trim_end_matches(" ns").parse().unwrap_or(0.0);
            match engines.iter_mut().find(|(n, _)| n == name) {
                Some((_, ms)) => *ms += ns / 1e6,
                None => engines.push((name.to_string(), ns / 1e6)),
            }
        }
    }
    let sum: f64 = engines.iter().map(|(_, ms)| ms).sum();
    let parts: Vec<String> = engines
        .iter()
        .filter(|(_, ms)| *ms > 0.0)
        .map(|(n, ms)| format!("{n} {ms:.1}"))
        .collect();
    format!(
        "{} = {:.2} ms/frame",
        parts.join(" "),
        if frames > 0 { sum / frames as f64 } else { 0.0 }
    )
}

fn ivf_header(f: &mut File, w: u32, h: u32, fps: u32, frames: u32) -> Result<()> {
    let mut hdr = [0u8; 32];
    hdr[..4].copy_from_slice(b"DKIF");
    hdr[6..8].copy_from_slice(&32u16.to_le_bytes());
    hdr[8..12].copy_from_slice(b"AV01");
    hdr[12..14].copy_from_slice(&(w as u16).to_le_bytes());
    hdr[14..16].copy_from_slice(&(h as u16).to_le_bytes());
    hdr[16..20].copy_from_slice(&fps.to_le_bytes());
    hdr[20..24].copy_from_slice(&1u32.to_le_bytes());
    hdr[24..28].copy_from_slice(&frames.to_le_bytes());
    f.seek(SeekFrom::Start(0))?;
    f.write_all(&hdr)?;
    Ok(())
}

fn main() -> Result<()> {
    let o = opts();
    let t_start = Instant::now();
    let va = Va::open(&o.device).with_context(|| format!("open {}", o.device))?;
    let supported = av1enc::supported(&va);
    eprintln!(
        "va: {}: {}, AV1 encode: {}",
        o.device,
        va.vendor(),
        if supported { "yes" } else { "no" }
    );
    if !supported {
        bail!("no AV1 encoder on {}", o.device);
    }
    let vpp_cfg = va.config(
        sys::VAProfile::VAProfileNone,
        sys::VAEntrypoint::VAEntrypointVideoProc,
        &mut [],
    )?;

    let (w, h) = (o.clip_w, o.clip_h);
    let ysize = (w * h) as usize;
    let file = File::open(&o.clip).with_context(|| format!("clip {}", o.clip))?;
    let count = file.metadata()?.len() / (ysize * 3 / 2) as u64;
    if count == 0 {
        bail!("clip {}: shorter than one frame", o.clip);
    }
    eprintln!("clip: {} {w}x{h}, {count} frames at {} fps", o.clip, o.fps);
    let (ew, eh) = fit(w, h, o.max_w, o.max_h, 8, 16);

    // the clip's upload surface and image
    let src = va.surfaces(sys::VA_RT_FORMAT_YUV420, w, h, 1, &mut [])?;
    let nv12 = sys::VAImageFormat {
        fourcc: sys::VA_FOURCC_NV12,
        byte_order: sys::VA_LSB_FIRST,
        bits_per_pixel: 12,
        ..Default::default()
    };
    let img = va.image(nv12, w, h)?;

    // the encode ring: RING NV12 surfaces the VPP writes and the encoder reads, a VPP context on them, the encoder
    let mut hint = [sys::VASurfaceAttrib {
        type_: sys::VASurfaceAttribType::VASurfaceAttribUsageHint,
        flags: sys::VA_SURFACE_ATTRIB_SETTABLE,
        value: sys::VAGenericValue {
            type_: sys::VAGenericValueType::VAGenericValueTypeInteger,
            value: sys::_VAGenericValue__bindgen_ty_1 {
                i: (sys::VA_SURFACE_ATTRIB_USAGE_HINT_VPP_WRITE
                    | sys::VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER
                    | sys::VA_SURFACE_ATTRIB_USAGE_HINT_EXPORT) as i32,
            },
        },
    }];
    let ring = va.surfaces(sys::VA_RT_FORMAT_YUV420, ew, eh, RING, &mut hint)?;
    // each slot exported once so its VPP's fence can be polled before the encoder reads it
    let fences = ring.ids.iter().map(|&s| va.export_fds(s)).collect::<Result<Vec<_>>>()?;
    let ring_ctx = va.context(&vpp_cfg, ew, eh, &ring.ids)?;
    let cfg = av1enc::Cfg {
        width: ew,
        height: eh,
        fps: o.fps,
        kbps: o.kbps,
        min_qindex: o.min_qindex,
        refs: o.refs,
    };
    let mut enc = av1enc::Av1Enc::open(&va, cfg)?;
    eprintln!("stage: encoder at {:.1} ms", t_start.elapsed().as_secs_f64() * 1e3);

    let mut ivf = match &o.ivf {
        Some(p) => {
            let mut f = File::create(p).with_context(|| format!("--encode-out {p}"))?;
            f.seek(SeekFrom::Start(32))?;
            Some(f)
        }
        None => None,
    };

    let (tx, rx) = mpsc::sync_channel(CLIP_RING);
    let reader = std::thread::spawn(move || clip_reader(file, w, h, count, tx));

    let t_run = Instant::now();
    let cpu0 = rusage_s();
    let (per_s, period) = (o.kbps as f64 * 1000.0, Duration::from_secs_f64(1.0 / o.fps as f64));
    let (mut next, mut last_enc, mut debt) = (Instant::now(), None::<Instant>, 0.0f64);
    let mut n_key = 0u64;
    let (mut n_enc, mut n_drop, mut ms_enc, mut max_enc, mut bytes, mut frames_out) =
        (0u64, 0u64, 0.0, 0.0f64, 0u64, 0u32);
    let mut slot = 0;
    for idx in 0..count {
        let t = Instant::now();
        if next > t {
            std::thread::sleep(next - t);
        }
        next += period;
        if Instant::now().saturating_duration_since(next) > Duration::from_millis(500) {
            next = Instant::now(); // way behind: don't burst
        }
        let f = rx.recv()?;
        img.write(|p, off, pitch| {
            for r in 0..h as usize {
                let at = off[0] as usize + r * pitch[0] as usize;
                p[at..at + w as usize].copy_from_slice(&f[r * w as usize..][..w as usize]);
            }
            for r in 0..h as usize / 2 {
                let at = off[1] as usize + r * pitch[1] as usize;
                p[at..at + w as usize].copy_from_slice(&f[ysize + r * w as usize..][..w as usize]);
            }
        })?;
        img.put(src.ids[0])?;
        // the ring's slots in turn (the C's free_slot: every slot is free again once its frame is encoded)
        let (s, fence) = (ring.ids[slot], &fences[slot][0]);
        slot = (slot + 1) % RING;
        if (ew, eh) == (w, h) {
            img.put(s)?;
        } else {
            vpp_submit(&ring_ctx, ew, eh, src.ids[0], s, true, true)?;
        }
        fence_wait(fence, 1000);
        // frame dropper (capture.c's encode())
        let now = Instant::now();
        if let Some(l) = last_enc {
            debt = (debt - per_s * now.duration_since(l).as_secs_f64().min(1.0)).max(0.0);
        }
        last_enc = Some(now);
        if o.drop_ms > 0.0 && idx > 0 && debt > per_s * o.drop_ms / 1000.0 {
            n_drop += 1;
            continue;
        }
        enc.set_kbps(o.kbps);
        let (data, fi) = enc.encode(s, false)?;
        debt += data.len() as f64 * 8.0;
        n_enc += 1;
        n_key += fi.key as u64;
        ms_enc += fi.ms_encode;
        max_enc = max_enc.max(fi.ms_encode);
        bytes += data.len() as u64;
        if let Some(f) = ivf.as_mut() {
            f.write_all(&(data.len() as u32).to_le_bytes())?;
            f.write_all(&(frames_out as u64).to_le_bytes())?;
            f.write_all(data)?;
            frames_out += 1;
        }
    }
    drop(rx);
    let _ = reader.join();
    let el = t_run.elapsed().as_secs_f64();
    let cpu = rusage_s() - cpu0;
    eprintln!(
        "total: {el:.1} s, in {count} frames, encoded {n_enc} ({n_key} keys, {:.2} ms each, max {max_enc:.2}), dropped {n_drop}, \
         {:.0} kbps, cpu {:.1}% ({:.2} ms per frame)",
        if n_enc > 0 { ms_enc / n_enc as f64 } else { 0.0 },
        bytes as f64 * 8.0 / el / 1e3,
        cpu / el * 100.0,
        cpu * 1e3 / count as f64
    );
    eprintln!("gpu: busy ms: {}", gpu_ms(count));
    if let Some(f) = ivf.as_mut() {
        ivf_header(f, ew, eh, o.fps, frames_out)?;
    }
    Ok(())
}
