// capture, the Rust port (P2) of capture/capture.c: so far the clip path, the C's `--clip` run with its protocol (stdin
// commands, stdout frames, previews, info and stats), the VPP, the AV1 encoder and the frame dropper. The cast
// (PipeWire, D-Bus) comes next. capture.c's header has the design; this follows it function by function.
//
//   mincord-capture-rs --clip F.i420 --clip-size WxH [--size WxH] [--fps 60] [--device auto|/dev/dri/renderDN]
//                      [--kbps 6000] [--av1-refs 1|2] [--av1-min-q 10] [--drop-ms 300] [--preview WxH]
//                      [--preview-fps 1] [--seconds N] [--start] [--encode-out F.ivf]
//   stdin: start [kbps=N] [height=N] | bitrate N | key | height N | stop
//
// Threads: a reader thread reads the clip, stamps the barcode and converts I420 to NV12 (CLIP_RING frames ahead); a
// stdin thread takes the commands (when stdin is a pipe); the main thread paces the clip at --fps, uploads it, runs
// the VPPs (encode ring, preview) and encodes, as the C's clip_run.

mod av1enc;
mod out;
mod va;

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::os::fd::OwnedFd;
use std::os::unix::fs::{FileExt, FileTypeExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use anyhow::{bail, Context as _, Result};

use out::{info, now, stage};
use va::{fence_wait, surface_attr, sys, vpp_submit, Context, Image, Surfaces, Va};

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
    prev_box: (u32, u32),
    prev_interval: f64,
    seconds: f64,
    start: bool,
    ivf: Option<String>,
}

fn usage() -> ! {
    eprintln!(
        "usage: mincord-capture-rs --clip FILE.i420 --clip-size WxH [--size WxH] [--fps 60] [--device auto|/dev/dri/renderDN]\n\
         \x20                         [--kbps 6000] [--av1-refs 1|2] [--av1-min-q 10] [--drop-ms 300] [--preview WxH]\n\
         \x20                         [--preview-fps 1] [--seconds N] [--start] [--encode-out FILE.ivf]\n\
         stdin: start [kbps=N] [height=N] | bitrate N | key | height N | stop; stdout: see capture.c"
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
        device: "auto".into(),
        kbps: 6000,
        refs: 2,
        min_qindex: 10,
        drop_ms: 300.0,
        prev_box: (640, 360),
        prev_interval: 1.0,
        seconds: 0.0,
        start: false,
        ivf: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut v = || args.next().unwrap_or_else(|| usage());
        fn num<T: std::str::FromStr>(s: String) -> T {
            s.parse().unwrap_or_else(|_| usage())
        }
        match a.as_str() {
            "--clip" => o.clip = v(),
            "--clip-size" => (o.clip_w, o.clip_h) = parse_size(&v(), 16),
            "--size" => (o.max_w, o.max_h) = parse_size(&v(), 16),
            "--fps" => o.fps = num(v()),
            "--device" => o.device = v(),
            "--kbps" => o.kbps = num(v()),
            "--av1-refs" => o.refs = num(v()),
            "--av1-min-q" => o.min_qindex = num(v()),
            "--drop-ms" => o.drop_ms = num(v()),
            "--preview" => o.prev_box = parse_size(&v(), 0),
            "--preview-fps" => o.prev_interval = 1.0 / num::<f64>(v()).max(0.01),
            "--seconds" => o.seconds = num(v()),
            "--start" => o.start = true,
            "--encode-out" => o.ivf = Some(v()),
            _ => usage(),
        }
    }
    if o.clip.is_empty() || o.clip_w == 0 || o.fps == 0 {
        usage()
    }
    if o.prev_box.1 == 0 {
        o.prev_box.0 = 0; // --preview 0x0: none
    }
    o
}

/// --device auto: the render node with the most dedicated VRAM (amdgpu's mem_info_vram_total; a node without it counts
/// as 0), ties to the lowest node: the dGPU, where niri renders and whose VCN encodes AV1
fn pick_device() -> String {
    let mut best: Option<(u64, i32)> = None;
    for e in std::fs::read_dir("/sys/class/drm").into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(n) = name.strip_prefix("renderD").and_then(|n| n.parse::<i32>().ok()) else {
            continue;
        };
        let vram = std::fs::read_to_string(format!("/sys/class/drm/{name}/device/mem_info_vram_total"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        if best.is_none_or(|(v, bn)| vram > v || (vram == v && n < bn)) {
            best = Some((vram, n));
        }
    }
    format!("/dev/dri/renderD{}", best.map_or(128, |(_, n)| n))
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

// ---------------------------------------------------------------- control: the commands' state (stdin thread + main)

#[derive(Default)]
struct Ctl {
    active: bool,  // encoding ("start", --start)
    req_kbps: u32, // target (0: --kbps)
    req_h: u32,    // maximum height (0: --size's)
    want_key: bool,
    failed: bool,         // the encoder broke: no encoding until the next "start"
    quit: Option<String>, // why
    want: (u32, u32),     // the encode size for the input and request
    full: (u32, u32),     // ... with no height asked for
    prev_want: (u32, u32),
}

static SIGNALLED: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    SIGNALLED.store(true, Ordering::Relaxed);
}

impl Ctl {
    fn quit(&mut self, why: &str) {
        self.quit.get_or_insert_with(|| why.to_string());
    }

    /// the encode size (the source fitted into --size and the asked maximum height; width a multiple of 8, height of
    /// 2: VCN 5's AV1 alignment) and the preview's
    fn update_sizes(&mut self, o: &Opts) {
        let (iw, ih) = (o.clip_w, o.clip_h);
        let (mut bw, mut bh) = (o.max_w, o.max_h);
        if self.req_h > 0 && self.req_h < bh {
            bw = (bw as u64 * self.req_h as u64 / bh as u64) as u32;
            bh = self.req_h;
        }
        self.full = fit(iw, ih, o.max_w, o.max_h, 8, 16);
        self.want = fit(iw, ih, bw, bh, 8, 16);
        if o.prev_box.0 > 0 {
            self.prev_want = fit(iw, ih, o.prev_box.0, o.prev_box.1, 2, 2);
        }
    }

    /// one command line:
    ///   start [kbps=N] [height=N]   encode (the preview runs regardless)
    ///   bitrate N                   new target (kbps), from the next frame
    ///   key                         the next frame a keyframe
    ///   height N                    maximum encode height (0: --size's); a new size starts with a keyframe
    ///   stop                        exit (as does EOF)
    fn command(&mut self, line: &str, o: &Opts, supported: bool) {
        let kv = |key: &str, def: u32| {
            line.find(key).map_or(def, |i| {
                let s = &line[i + key.len()..];
                s[..s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len())]
                    .parse()
                    .unwrap_or(0)
            })
        };
        let arg = |s: &str| s.trim().parse::<u64>().unwrap_or(0);
        if line.starts_with("start") {
            if !supported {
                info(&format!(
                    "{{\"type\":\"error\",\"message\":\"no AV1 encoder on {}\"}}",
                    o.device
                ));
                return;
            }
            self.active = true;
            self.req_kbps = kv("kbps=", if self.req_kbps > 0 { self.req_kbps } else { o.kbps });
            self.req_h = kv("height=", self.req_h);
            self.want_key = true;
            self.failed = false;
            self.update_sizes(o);
            eprintln!("cmd: start {} kbps, height {}", self.req_kbps, self.req_h);
            stage("start");
        } else if let Some(n) = line.strip_prefix("bitrate ") {
            self.req_kbps = arg(n).clamp(100, 100000) as u32;
        } else if line == "key" {
            self.want_key = true;
        } else if let Some(n) = line.strip_prefix("height ") {
            self.req_h = arg(n) as u32;
            self.update_sizes(o);
        } else if line == "stop" {
            self.quit("stopped");
        }
    }
}

/// commands from a pipe (mincord); stdin from /dev/null or a terminal isn't watched (lab and cost runs)
fn watch_stdin(ctl: Arc<Mutex<Ctl>>, o: Arc<Opts>, supported: bool) {
    let piped =
        std::fs::metadata("/proc/self/fd/0").is_ok_and(|m| m.file_type().is_fifo() || m.file_type().is_socket());
    if !piped {
        return;
    }
    std::thread::spawn(move || {
        // read(2) after poll(2): the pipe may be non-blocking (shared with whoever started us), and EAGAIN isn't EOF
        let (mut buf, mut chunk) = (Vec::new(), [0u8; 512]);
        loop {
            let mut p = libc::pollfd {
                fd: 0,
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: one valid pollfd; chunk is writable for its length
            let n = unsafe {
                libc::poll(&mut p, 1, -1);
                libc::read(0, chunk.as_mut_ptr() as *mut _, chunk.len())
            };
            if n < 0 {
                let e = std::io::Error::last_os_error().kind();
                if e == std::io::ErrorKind::WouldBlock || e == std::io::ErrorKind::Interrupted {
                    continue;
                }
            }
            if n <= 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n as usize]);
            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buf.drain(..=nl).collect();
                ctl.lock()
                    .unwrap()
                    .command(String::from_utf8_lossy(&line[..nl]).as_ref(), &o, supported);
            }
            if buf.len() >= 511 {
                buf.clear(); // garbage
            }
        }
        ctl.lock().unwrap().quit("stdin closed");
    });
}

// ---------------------------------------------------------------- the clip

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
        let mut d = vec![0u8; fsize];
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

// ---------------------------------------------------------------- encode ring, preview

/// RING NV12 surfaces (VPP target, encoder input), each exported once so its VPP's fence can be polled, a VPP context
/// on them and the encoder. Field order is drop order.
struct Ring {
    enc: av1enc::Av1Enc,
    ctx: Context,
    fences: Vec<Vec<OwnedFd>>,
    surfs: Surfaces,
    w: u32,
    h: u32,
    last_slot: Option<usize>,
}

impl Ring {
    fn create(va: &Va, vpp_cfg: &va::Config, (w, h): (u32, u32), o: &Opts, kbps: u32) -> Result<Ring> {
        let hint = sys::VA_SURFACE_ATTRIB_USAGE_HINT_VPP_WRITE
            | sys::VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER
            | sys::VA_SURFACE_ATTRIB_USAGE_HINT_EXPORT;
        let mut attrs = [surface_attr(sys::VASurfaceAttribType::VASurfaceAttribUsageHint, hint)];
        let surfs = va.surfaces(sys::VA_RT_FORMAT_YUV420, w, h, RING, &mut attrs)?;
        let fences = surfs
            .ids
            .iter()
            .map(|&s| va.export_fds(s))
            .collect::<Result<Vec<_>>>()?;
        let ctx = va.context(vpp_cfg, w, h, &surfs.ids)?;
        let cfg = av1enc::Cfg {
            width: w,
            height: h,
            fps: o.fps,
            kbps,
            min_qindex: o.min_qindex,
            refs: o.refs,
        };
        let enc = av1enc::Av1Enc::open(va, cfg)?;
        Ok(Ring {
            enc,
            ctx,
            fences,
            surfs,
            w,
            h,
            last_slot: None,
        })
    }

    /// a slot to write: rather not the one encoded last (what an idle cast re-encodes); every slot is free again once
    /// encoded, which in the clip run is before the next frame
    fn free_slot(&self) -> usize {
        (0..RING).find(|&i| Some(i) != self.last_slot).unwrap_or(0)
    }
}

/// the preview surface (BGRx), read back through a derived image (the map blits it to a staging buffer and waits), or
/// through vaGetImage where the driver can't derive. Field order is drop order.
struct Preview {
    img: Image,
    derived: bool,
    ctx: Context,
    surf: Surfaces,
    w: u32,
    h: u32,
    submitted: bool,
    next: f64,
}

impl Preview {
    fn create(va: &Va, vpp_cfg: &va::Config, (w, h): (u32, u32)) -> Result<Preview> {
        let mut attrs = [
            surface_attr(
                sys::VASurfaceAttribType::VASurfaceAttribPixelFormat,
                sys::VA_FOURCC_BGRX,
            ),
            surface_attr(
                sys::VASurfaceAttribType::VASurfaceAttribUsageHint,
                sys::VA_SURFACE_ATTRIB_USAGE_HINT_VPP_WRITE,
            ),
        ];
        let surf = va.surfaces(sys::VA_RT_FORMAT_RGB32, w, h, 1, &mut attrs)?;
        let ctx = va.context(vpp_cfg, w, h, &surf.ids)?;
        let derived = va.derive_image(surf.ids[0]).filter(|d| {
            let f = d.img.format.fourcc;
            (f == sys::VA_FOURCC_BGRX || f == sys::VA_FOURCC_BGRA) && d.img.num_planes == 1 && d.img.pitches[0] >= w * 4
        });
        let (img, derived) = match derived {
            Some(img) => (img, true),
            None => {
                let bgrx = sys::VAImageFormat {
                    fourcc: sys::VA_FOURCC_BGRX,
                    byte_order: sys::VA_LSB_FIRST,
                    bits_per_pixel: 32,
                    depth: 24,
                    red_mask: 0xff0000,
                    green_mask: 0xff00,
                    blue_mask: 0xff,
                    ..Default::default()
                };
                (va.image(bgrx, w, h)?, false)
            }
        };
        Ok(Preview {
            img,
            derived,
            ctx,
            surf,
            w,
            h,
            submitted: false,
            next: 0.0,
        })
    }

    /// read the submitted preview back and send it; whether it was read
    fn send(&mut self, va: &Va) -> bool {
        self.submitted = false;
        let (w, h) = (self.w as usize, self.h as usize);
        let t = now();
        let mut buf = Vec::with_capacity(w * h * 4 + 4);
        buf.extend_from_slice(&(self.w | self.h << 16).to_le_bytes());
        let read = va.sync_surface(self.surf.ids[0]).is_ok()
            && (self.derived || self.img.get(self.surf.ids[0]).is_ok())
            && self
                .img
                .read(|p, off, pitch| {
                    // X forced to 0xff: radeonsi's VPP leaves the red channel there, which Chromium takes for
                    // premultiplied alpha and divides by (dark colours came out near white)
                    for y in 0..h {
                        let row = &p[off[0] as usize + y * pitch[0] as usize..][..w * 4];
                        for px in row.as_chunks::<4>().0 {
                            buf.extend_from_slice(&[px[0], px[1], px[2], 0xff]);
                        }
                    }
                })
                .is_ok();
        if read && out::send(out::MSG_PREVIEW, 0, t, &buf, &[], true) == out::Sent::Ok {
            stage("preview");
        }
        read
    }
}

// ---------------------------------------------------------------- stats, output

#[derive(Default)]
struct Stats {
    t_start: f64,
    t_tick: f64,
    cpu_tick: f64,
    n_in: u32,
    n_nofree: u32,
    n_enc: u32,
    n_key: u32,
    n_dropper: u32,
    n_outdrop: u32,
    n_prev: u32,
    ms_enc: f64,
    max_enc: f64,
    ms_lat: f64,
    max_lat: f64,
    bytes: u64,
    total_in: u64,
    total_sub: u64,
    total_enc: u64,
    ms_enc_total: f64,
}

fn cpu_s() -> f64 {
    // SAFETY: getrusage fills the struct
    let ru = unsafe {
        let mut ru = std::mem::zeroed::<libc::rusage>();
        libc::getrusage(libc::RUSAGE_SELF, &mut ru);
        ru
    };
    let t = |tv: libc::timeval| tv.tv_sec as f64 + tv.tv_usec as f64 / 1e6;
    t(ru.ru_utime) + t(ru.ru_stime)
}

/// GPU time of this process: amdgpu's fdinfo drm-engine-<engine> (ns busy), summed over our distinct DRM clients, per
/// GPU (drm-pdev), in ms per frame over `frames`
fn gpu_ms(frames: u64) -> String {
    let mut ids = std::collections::HashSet::new();
    let mut devs: Vec<(String, Vec<(String, f64)>)> = Vec::new();
    for e in std::fs::read_dir("/proc/self/fdinfo").into_iter().flatten().flatten() {
        let Ok(text) = std::fs::read_to_string(e.path()) else {
            continue;
        };
        let field = |k: &str| text.lines().find_map(|l| l.strip_prefix(k)).map(str::trim);
        if !field("drm-client-id:").is_some_and(|id| ids.insert(id.to_string())) {
            continue;
        }
        let pdev = field("drm-pdev:").unwrap_or("?");
        let pdev = pdev.strip_prefix("0000:").unwrap_or(pdev).to_string();
        let i = devs.iter().position(|(d, _)| *d == pdev).unwrap_or_else(|| {
            devs.push((pdev, Vec::new()));
            devs.len() - 1
        });
        for l in text.lines() {
            let Some(rest) = l.strip_prefix("drm-engine-") else {
                continue;
            };
            let Some((name, v)) = rest.split_once(':').filter(|(n, _)| !n.starts_with("capacity-")) else {
                continue;
            };
            let ms = v.trim().trim_end_matches(" ns").parse::<f64>().unwrap_or(0.0) / 1e6;
            match devs[i].1.iter_mut().find(|(n, _)| n == name) {
                Some((_, t)) => *t += ms,
                None => devs[i].1.push((name.to_string(), ms)),
            }
        }
    }
    let per = |sum: f64| if frames > 0 { sum / frames as f64 } else { 0.0 };
    let parts: Vec<String> = devs
        .iter()
        .map(|(d, e)| {
            let used: Vec<String> = e
                .iter()
                .filter(|(_, ms)| *ms > 0.0)
                .map(|(n, ms)| format!(" {n} {ms:.1}"))
                .collect();
            format!(
                " [{d}]{} = {:.2} ms/frame",
                used.concat(),
                per(e.iter().map(|(_, ms)| ms).sum())
            )
        })
        .collect();
    if parts.is_empty() {
        " (no drm-engine-* in fdinfo)".into()
    } else {
        parts.join(";")
    }
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

// ---------------------------------------------------------------- main

fn main() {
    let mut o = opts();
    out::start();
    // SAFETY: plain libc calls on our own process and fds
    unsafe {
        libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
    }
    out::stderr_to_log();
    // stdout: a pipe to mincord, written non-blocking (a full pipe drops the frame, the next is a keyframe)
    // SAFETY: as above
    unsafe {
        libc::fcntl(1, libc::F_SETPIPE_SZ, 1 << 20);
        libc::fcntl(1, libc::F_SETFL, libc::fcntl(1, libc::F_GETFL) | libc::O_NONBLOCK);
    }
    if o.device == "auto" {
        o.device = pick_device();
    }
    stage("main");
    let code = match run(Arc::new(o)) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e:#}");
            1
        }
    };
    std::process::exit(code)
}

fn run(o: Arc<Opts>) -> Result<()> {
    let va = match Va::open(&o.device) {
        Ok(va) => va,
        Err(e) => {
            info(&format!(
                "{{\"type\":\"error\",\"message\":\"no VA-API on {}\"}}",
                o.device
            ));
            return Err(e).context(format!("open {}", o.device));
        }
    };
    let vpp_cfg = va.config(
        sys::VAProfile::VAProfileNone,
        sys::VAEntrypoint::VAEntrypointVideoProc,
        &mut [],
    )?;
    let supported = av1enc::supported(&va);
    eprintln!(
        "va: {}: {}, AV1 encode: {}",
        o.device,
        va.vendor(),
        if supported { "yes" } else { "no" }
    );
    stage("va");

    // SAFETY: the handler only stores an atomic
    unsafe {
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }

    let ctl = Arc::new(Mutex::new(Ctl::default()));
    let mut ivf = match &o.ivf {
        Some(p) if supported => {
            let mut f = File::create(p).with_context(|| format!("--encode-out {p}"))?;
            f.seek(SeekFrom::Start(32))?;
            Some(f)
        }
        Some(_) => bail!("--encode-out: no AV1 encoder"),
        None => None,
    };
    if (o.start || ivf.is_some()) && supported {
        let mut c = ctl.lock().unwrap();
        c.active = true;
        c.want_key = true;
    }
    watch_stdin(ctl.clone(), o.clone(), supported);

    let (w, h) = (o.clip_w, o.clip_h);
    let ysize = (w * h) as usize;
    let file = File::open(&o.clip).with_context(|| format!("clip {}", o.clip))?;
    let count = file.metadata()?.len() / (ysize * 3 / 2) as u64;
    if count == 0 {
        bail!("clip {}: shorter than one frame", o.clip);
    }
    let src = va.surfaces(sys::VA_RT_FORMAT_YUV420, w, h, 1, &mut [])?;
    let nv12 = sys::VAImageFormat {
        fourcc: sys::VA_FOURCC_NV12,
        byte_order: sys::VA_LSB_FIRST,
        bits_per_pixel: 12,
        ..Default::default()
    };
    let img = va.image(nv12, w, h)?;
    let (tx, rx) = mpsc::sync_channel(CLIP_RING);
    let reader = std::thread::spawn(move || clip_reader(file, w, h, count, tx));
    eprintln!("clip: {} {w}x{h}, {count} frames at {} fps", o.clip, o.fps);
    let full = {
        let mut c = ctl.lock().unwrap();
        c.update_sizes(&o);
        c.full
    };
    info(&format!(
        "{{\"type\":\"input\",\"width\":{w},\"height\":{h},\"encodeWidth\":{},\"encodeHeight\":{}}}",
        full.0, full.1
    ));

    let t_start = now();
    let mut st = Stats {
        t_start,
        t_tick: t_start,
        cpu_tick: cpu_s(),
        ..Default::default()
    };
    let mut ring: Option<Ring> = None;
    let mut prev: Option<Preview> = None;
    let mut prev_box = o.prev_box;
    let (mut last_enc_t, mut debt) = (0.0f64, 0.0f64); // frame dropper: bits sent over the target
    let mut frames_out = 0u32;
    let (mut next, period) = (0.0f64, 1.0 / o.fps as f64);
    let mut idx = 0u64;
    loop {
        {
            let mut c = ctl.lock().unwrap();
            if SIGNALLED.load(Ordering::Relaxed) {
                c.quit("");
            }
            if out::broken() {
                c.quit("stdout broken");
            }
            if c.quit.is_some() {
                break;
            }
        }
        tick(&mut st, &ctl, &o, ring.as_ref());

        // reconcile: the encode ring + encoder at the wanted size while encoding (none otherwise), the preview at its
        // size
        {
            let mut c = ctl.lock().unwrap();
            let want = c.active && c.want.0 > 0 && !c.failed;
            if let Some(r) = &ring {
                if !want || (r.w, r.h) != c.want {
                    eprintln!("enc: {}x{} off{}", r.w, r.h, if want { " (resize)" } else { "" });
                    ring = None;
                }
            }
            if want && ring.is_none() {
                let kbps = if c.req_kbps > 0 { c.req_kbps } else { o.kbps };
                match Ring::create(&va, &vpp_cfg, c.want, &o, kbps) {
                    Ok(r) => {
                        c.want_key = true;
                        stage("encoder");
                        info(&format!(
                            "{{\"type\":\"started\",\"width\":{},\"height\":{}}}",
                            r.w, r.h
                        ));
                        ring = Some(r);
                    }
                    Err(e) => {
                        eprintln!("encoder setup: {e:#}");
                        c.failed = true;
                        info("{\"type\":\"error\",\"message\":\"encoder setup failed\"}");
                    }
                }
            }
            if prev.as_ref().is_some_and(|p| !p.submitted && (p.w, p.h) != c.prev_want) {
                prev = None;
            }
            if prev.is_none() && prev_box.0 > 0 && c.prev_want.0 > 0 {
                match Preview::create(&va, &vpp_cfg, c.prev_want) {
                    Ok(p) => {
                        prev = Some(p);
                        stage("preview-ready");
                    }
                    Err(e) => {
                        eprintln!("preview: {e:#}");
                        prev_box = (0, 0); // no preview, but the stream goes on
                    }
                }
            }
        }
        if let Some(p) = prev.as_mut().filter(|p| p.submitted) {
            st.n_prev += p.send(&va) as u32;
        }

        // pacing: the clip in real time
        let t = now();
        if next == 0.0 {
            next = t;
        }
        if next > t {
            std::thread::sleep(Duration::from_secs_f64(next - t));
        }
        next += period;
        if now() - next > 0.5 {
            next = now(); // way behind (stopped in a debugger...): don't burst
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
        st.n_in += 1;
        let t = now();
        let uploaded = img.put(src.ids[0]).is_ok();
        if let Some(p) = prev.as_mut().filter(|p| uploaded && !p.submitted && t >= p.next) {
            if vpp_submit(&p.ctx, p.w, p.h, src.ids[0], p.surf.ids[0], true, false).is_ok() {
                p.submitted = true;
                p.next = t + o.prev_interval;
            }
        }
        if let Some(r) = ring.as_mut().filter(|_| uploaded) {
            let slot = r.free_slot();
            let s = r.surfs.ids[slot];
            let submitted = if (r.w, r.h) == (w, h) {
                img.put(s)
            } else {
                vpp_submit(&r.ctx, r.w, r.h, src.ids[0], s, true, true)
            };
            if submitted.is_ok() {
                st.total_sub += 1;
                // encode (capture.c's encode())
                let (key, kbps) = {
                    let mut c = ctl.lock().unwrap();
                    (
                        std::mem::take(&mut c.want_key),
                        if c.req_kbps > 0 { c.req_kbps } else { o.kbps },
                    )
                };
                fence_wait(&r.fences[slot][0], 1000);
                // frame dropper (libwebrtc's FrameDropper, roughly): radeonsi doesn't enforce the HRD, so a scene cut
                // can come out as one frame worth most of a second of the budget. Bits over the target are a debt
                // draining at the target rate; while it's over --drop-ms worth, frames aren't encoded. A keyframe
                // request is never dropped.
                let (t_now, per_s) = (now(), kbps as f64 * 1000.0);
                if last_enc_t > 0.0 {
                    debt = (debt - per_s * (t_now - last_enc_t).min(1.0)).max(0.0);
                }
                last_enc_t = t_now;
                if o.drop_ms > 0.0 && !key && debt > per_s * o.drop_ms / 1000.0 {
                    st.n_dropper += 1;
                } else {
                    r.enc.set_kbps(kbps);
                    match r.enc.encode(s, key) {
                        Ok((data, fi)) => {
                            debt += data.len() as f64 * 8.0;
                            if let Some(f) = ivf.as_mut() {
                                f.write_all(&(data.len() as u32).to_le_bytes())?;
                                f.write_all(&(frames_out as u64).to_le_bytes())?;
                                f.write_all(data)?;
                                frames_out += 1;
                            }
                            let pre: Vec<u8> = [fi.key as u32, r.w | r.h << 16, fi.qp, ((now() - t) * 1e6) as u32]
                                .iter()
                                .flat_map(|v| v.to_le_bytes())
                                .collect();
                            let sent = out::send(out::MSG_FRAME, idx as u32, t, &pre, data, true);
                            if sent == out::Sent::Ok {
                                stage("first-frame");
                            }
                            let lat = (now() - t) * 1e3;
                            st.n_enc += 1;
                            st.total_enc += 1;
                            st.n_key += fi.key as u32;
                            st.ms_enc += fi.ms_encode;
                            st.ms_enc_total += fi.ms_encode;
                            st.max_enc = st.max_enc.max(fi.ms_encode);
                            st.ms_lat += lat;
                            st.max_lat = st.max_lat.max(lat);
                            st.bytes += data.len() as u64;
                            if sent == out::Sent::Dropped {
                                st.n_outdrop += 1;
                                ctl.lock().unwrap().want_key = true; // mincord lost a frame: restart the stream
                            }
                        }
                        Err(e) => {
                            eprintln!("encode: {e:#}");
                            ctl.lock().unwrap().failed = true; // the encoder broke: mincord falls back
                            info("{\"type\":\"error\",\"message\":\"encode failed\"}");
                        }
                    }
                }
                r.last_slot = Some(slot);
            }
        } else if uploaded && ctl.lock().unwrap().active {
            st.n_nofree += 1;
        }
        idx += 1;
        if ivf.is_some() && o.seconds <= 0.0 && idx >= count {
            break;
        }
    }
    drop(rx);
    let _ = reader.join();

    let why = ctl.lock().unwrap().quit.clone().unwrap_or_default();
    eprintln!("quit: {}", if why.is_empty() { "signal" } else { &why });
    if why == "cast closed" {
        info("{\"type\":\"ended\",\"reason\":\"cast closed\"}");
    } else if !["stopped", "stdin closed", "--seconds"].contains(&why.as_str()) {
        let msg = if why.is_empty() { "terminated" } else { &why };
        info(&format!("{{\"type\":\"error\",\"message\":\"{msg}\"}}"));
    }
    let el = now() - t_start;
    let cpu = cpu_s();
    eprintln!(
        "total: {el:.1} s, in {} frames, processed {}, encoded {} ({:.2} ms each), cpu {:.1}% ({:.2} ms per frame)",
        st.total_in + st.n_in as u64,
        st.total_sub,
        st.total_enc,
        if st.total_enc > 0 {
            st.ms_enc_total / st.total_enc as f64
        } else {
            0.0
        },
        cpu / el * 100.0,
        if st.total_sub > 0 {
            cpu * 1e3 / st.total_sub as f64
        } else {
            0.0
        }
    );
    eprintln!("gpu: busy ms:{}", gpu_ms(st.total_sub));
    if let (Some(f), Some(r)) = (ivf.as_mut(), ring.as_ref()) {
        ivf_header(f, r.w, r.h, o.fps, frames_out)?;
    }
    Ok(())
}

/// every second a "stats" info (also into the log)
fn tick(st: &mut Stats, ctl: &Mutex<Ctl>, o: &Opts, ring: Option<&Ring>) {
    let t = now();
    if t - st.t_tick < 1.0 {
        return;
    }
    let cpu_now = cpu_s();
    let dt = t - st.t_tick;
    let cpu = (cpu_now - st.cpu_tick) / dt * 100.0;
    let ne = st.n_enc.max(1) as f64;
    let target = {
        let c = ctl.lock().unwrap();
        if c.req_kbps > 0 {
            c.req_kbps
        } else {
            o.kbps
        }
    };
    let (rw, rh) = ring.map_or((0, 0), |r| (r.w, r.h));
    let json = format!(
        "{{\"type\":\"stats\",\"in\":{:.1},\"fps\":{:.1},\"kbps\":{:.0},\"target\":{target},\"width\":{rw},\"height\":{rh},\
         \"keys\":{},\"repeats\":0,\"skipped\":0,\"busy\":{},\"dropper\":{},\"outDrops\":{},\"encodeMs\":{:.2},\
         \"maxEncodeMs\":{:.2},\"latencyMs\":{:.2},\"maxLatencyMs\":{:.2},\"previews\":{},\"cpu\":{cpu:.1}}}",
        st.n_in as f64 / dt,
        st.n_enc as f64 / dt,
        st.bytes as f64 * 8.0 / dt / 1e3,
        st.n_key,
        st.n_nofree,
        st.n_dropper,
        st.n_outdrop,
        st.ms_enc / ne,
        st.max_enc,
        st.ms_lat / ne,
        st.max_lat,
        st.n_prev,
    );
    eprintln!("[{:5.1}s] {json}", t - st.t_start);
    st.total_in += st.n_in as u64;
    *st = Stats {
        t_start: st.t_start,
        t_tick: t,
        cpu_tick: cpu_now,
        total_in: st.total_in,
        total_sub: st.total_sub,
        total_enc: st.total_enc,
        ms_enc_total: st.ms_enc_total,
        ..Default::default()
    };
    if o.seconds > 0.0 && t - st.t_start >= o.seconds {
        ctl.lock().unwrap().quit("--seconds");
    }
    out::send(out::MSG_INFO, 0, t, json.as_bytes(), &[], true);
}
