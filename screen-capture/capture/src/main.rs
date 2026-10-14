// capture: a niri cast of a window or an output (--window, --output; the Mutter ScreenCast D-Bus API, mutter.rs), the
// desktop's ScreenCast portal (--portal, portal.rs), a PipeWire node (--node) or the clip (--clip, clip.rs), with its
// protocol (stdin commands, stdout frames, previews, info and stats), the VPP, the AV1 encoder (av1enc.rs), the frame
// dropper and the repeats.
//
//   mincord-capture (--window ID | --output NAME | --portal [--restore-token T] | --node ID
//                    | --clip F.i420 --clip-size WxH) [--size WxH]
//                   [--fps 60] [--cursor embedded|hidden] [--device auto|/dev/dri/renderDN] [--kbps 6000]
//                   [--av1-refs 1|2] [--av1-min-q 50] [--drop-ms 300] [--seconds N] [--start] [--encode-out F.ivf]
//                   [--socket-fd N] [--audio SPEC]
//   stdin: start [kbps=N] [height=N] [codec=av1] | raw | bitrate N | key | height N | fps N | audio SPEC | stop
//   (audio: the stream's sound, from the apps SPEC names: audio.rs)
//
// raw (mincord's fallback when the call's codec isn't one capture encodes): no encoder; the VPP writes a ring of
// LINEAR NV12 surfaces that mincord imports (Electron's sharedTexture) and Chromium encodes. On the socket of
// --socket-fd (SOCK_SEQPACKET, JSON text, the C castscale's protocol): each surface once, with its fd,
//   {"type":"buffer","id":N,"width":W,"height":H,"modifier":"M","planes":[{"offset":O,"stride":S,"size":Z},..]}
// then a message per frame, {"type":"frame","id":N,"seq":S,"t":us} (t: the VPP submit's CLOCK_MONOTONIC). A surface
// isn't written again for RAW_HOLD_S after it was handed out. A new size sends a new set (the same ids).
//
// Threads: the PipeWire thread (cast.rs) dequeues the newest buffer, submits the VPP into a free slot of the encode
// ring (and into the preview surface when one is due) and requeues the buffer at once; it never waits for the GPU. A
// stdin thread takes the commands (when stdin is a pipe). The main thread is the worker: it encodes submitted slots
// (waiting for the VPP with poll() on the slot's DMA-BUF), reads the preview back and writes to stdout. All of them
// share one State under one lock, dropped for everything slow. With --clip, a reader thread reads the clip, stamps the
// barcode and converts it to NV12, and the main thread paces it at --fps, uploads it and runs the VPPs itself.

mod audio;
mod av1enc;
mod bits;
mod cast;
mod clip;
mod mutter;
mod out;
mod portal;
mod va;

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::fs::FileTypeExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use anyhow::{bail, Context as _, Result};

use out::{info, now, stage};
use av1enc::Av1Enc;
use va::{fence_wait, surface_attr, sys, vpp_submit, Context, Image, Surfaces, Va};

const RING: usize = 3;
// raw (the fallback, "raw"): the ring mincord imports, and how long a handed-out slot isn't written again (Chromium
// reads it back for its encoder long before: README's fallback)
const RAW_RING: usize = 8;
const RAW_HOLD_S: f64 = 0.1;
// nothing new from the cast for this long: the last frame again (Worker::repeat)
const REPEAT_S: f64 = 1.0;
// the 1 fps preview: Discord's stream thumbnail and mincord's templates
const PREVIEW_BOX: (u32, u32) = (640, 360);
const PREVIEW_INTERVAL_S: f64 = 1.0;

struct Opts {
    window: Option<u64>,
    output: Option<String>,
    node: Option<u32>,
    portal: bool,
    restore: Option<String>, // the portal's restore token from an earlier cast
    cursor: u32,             // Mutter's cursor-mode: 0 hidden, 1 embedded
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
    seconds: f64,
    start: bool,
    ivf: Option<String>,
    probe: bool,
    socket: Option<i32>,          // --socket-fd N: raw's socket (SOCK_SEQPACKET, mincord's fdsock)
    audio: Option<audio::Target>, // --audio SPEC: the stream's sound from the start (the lab; mincord sends "audio")
}

fn usage() -> ! {
    eprintln!(
        "usage: mincord-capture (--window ID | --output NAME | --portal [--restore-token T] | --node ID\n\
         \x20                       | --clip FILE.i420 --clip-size WxH)\n\
         \x20                      [--size WxH] [--fps 60] [--cursor embedded|hidden] [--device auto|/dev/dri/renderDN]\n\
         \x20                      [--kbps 6000] [--av1-refs 1|2] [--av1-min-q 50] [--drop-ms 300] [--seconds N]\n\
         \x20                      [--start] [--encode-out FILE.ivf] [--socket-fd N] [--audio SPEC] | --probe [--device ...]\n\
         stdin: start [kbps=N] [height=N] [codec=av1] | raw | bitrate N | key | height N | fps N | audio SPEC | stop\n\
         (SPEC: off | pid=N | steam=N | name=S, audio.rs); stdout: see out.rs"
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
        window: None,
        output: None,
        node: None,
        portal: false,
        restore: None,
        cursor: 1,
        clip: String::new(),
        clip_w: 0,
        clip_h: 0,
        max_w: 16384, // no box: the source's own size
        max_h: 16384,
        fps: 60,
        device: "auto".into(),
        kbps: 6000,
        refs: 2,
        // (a floor of 10 let still content's scene cut cost half a second of bitrate: LOG; Liam picked 50)
        min_qindex: 50,
        drop_ms: 300.0,
        seconds: 0.0,
        start: false,
        ivf: None,
        probe: false,
        socket: None,
        audio: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut v = || args.next().unwrap_or_else(|| usage());
        fn num<T: std::str::FromStr>(s: String) -> T {
            s.parse().unwrap_or_else(|_| usage())
        }
        match a.as_str() {
            "--window" => o.window = Some(num(v())),
            "--output" => o.output = Some(v()),
            "--node" => o.node = Some(num(v())),
            "--portal" => o.portal = true,
            "--restore-token" => o.restore = Some(v()),
            "--cursor" => o.cursor = (v() != "hidden") as u32,
            "--clip" => o.clip = v(),
            "--clip-size" => (o.clip_w, o.clip_h) = parse_size(&v(), 16),
            "--size" => (o.max_w, o.max_h) = parse_size(&v(), 16),
            "--fps" => o.fps = num(v()),
            "--device" => o.device = v(),
            "--kbps" => o.kbps = num(v()),
            "--av1-refs" => o.refs = num(v()),
            "--av1-min-q" => o.min_qindex = num(v()),
            "--drop-ms" => o.drop_ms = num(v()),
            "--seconds" => o.seconds = num(v()),
            "--start" => o.start = true,
            "--encode-out" => o.ivf = Some(v()),
            "--probe" => o.probe = true,
            "--socket-fd" => o.socket = Some(num(v())),
            "--audio" => o.audio = Some(audio::Target::parse(&v()).unwrap_or_else(|| usage())),
            _ => usage(),
        }
    }
    let clip = !o.clip.is_empty();
    let sources = [o.window.is_some(), o.output.is_some(), o.node.is_some(), o.portal, clip];
    if !o.probe && sources.iter().filter(|&&s| s).count() != 1 || (clip && o.clip_w == 0) || o.fps == 0 || o.kbps == 0 {
        usage()
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

/// iw x ih fitted inside bw x bh, aspect kept, never upscaled; width a multiple of wa, height of ha, both >= min
fn fit(iw: u32, ih: u32, bw: u32, bh: u32, (wa, ha): (u32, u32), min: u32) -> (u32, u32) {
    let (iw, ih, bw, bh) = (iw as u64, ih as u64, bw as u64, bh as u64);
    let (mut fw, mut fh) = (iw, ih);
    if iw > bw || ih > bh {
        if iw * bh >= ih * bw {
            (fw, fh) = (bw, ih * bw / iw);
        } else {
            (fw, fh) = (iw * bh / ih, bh);
        }
    }
    ((fw as u32 / wa * wa).max(min), (fh as u32 / ha * ha).max(min))
}

// ---------------------------------------------------------------- the shared state

/// an encode ring slot's state: free, VPP submitted (the worker encodes it next), being encoded
#[derive(Clone, Copy, PartialEq, Default)]
enum SlotState {
    #[default]
    Free,
    Submitted,
    Busy,
    Out, // raw: handed to mincord (free again RAW_HOLD_S after t_out)
}

#[derive(Clone, Copy, Default)]
struct Slot {
    state: SlotState,
    t_submit: f64,
    seq: u64,
    t_out: f64,
}

impl Slot {
    fn submitted(t_submit: f64, seq: u64) -> Slot {
        Slot {
            state: SlotState::Submitted,
            t_submit,
            seq,
            t_out: 0.0,
        }
    }
}

/// RING NV12 surfaces (VPP target, encoder input), each exported once so its VPP's fence can be polled, and a VPP
/// context on them. The encoder is the worker's. Raw: RAW_RING LINEAR surfaces, also exported whole for mincord to
/// import (`exports`), no encoder. Field order is drop order.
struct Ring {
    ctx: Context,
    fences: Vec<OwnedFd>,
    exports: Vec<va::Export>,
    surfs: Surfaces,
    slots: Vec<Slot>,
    raw: bool,
    w: u32,
    h: u32,
    last_slot: Option<usize>, // the slot encoded last (an idle cast re-encodes it)
}

impl Ring {
    fn create(va: &Va, vpp_cfg: &va::Config, (w, h): (u32, u32), raw: bool) -> Result<Ring> {
        let surfs = if raw {
            va.linear_nv12(w, h, RAW_RING)?
        } else {
            let hint = sys::VA_SURFACE_ATTRIB_USAGE_HINT_VPP_WRITE
                | sys::VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER
                | sys::VA_SURFACE_ATTRIB_USAGE_HINT_EXPORT;
            let mut attrs = [surface_attr(sys::VASurfaceAttribType::VASurfaceAttribUsageHint, hint)];
            va.surfaces(sys::VA_RT_FORMAT_YUV420, w, h, RING, &mut attrs)?
        };
        let fences = surfs
            .ids
            .iter()
            .map(|&s| va.export_fd(s))
            .collect::<Result<Vec<_>>>()?;
        let exports = match raw {
            true => surfs
                .ids
                .iter()
                .map(|&s| va.export_nv12(s))
                .collect::<Result<Vec<_>>>()?,
            false => Vec::new(),
        };
        let ctx = va.context(vpp_cfg, w, h, &surfs.ids)?;
        Ok(Ring {
            ctx,
            fences,
            exports,
            slots: vec![Slot::default(); surfs.ids.len()],
            surfs,
            raw,
            w,
            h,
            last_slot: None,
        })
    }

    /// a free slot, rather not the one encoded last (what an idle cast re-encodes)
    fn free_slot(&self) -> Option<usize> {
        let t = now();
        let free = |&i: &usize| match self.slots[i].state {
            SlotState::Free => true,
            SlotState::Out => t - self.slots[i].t_out >= RAW_HOLD_S,
            _ => false,
        };
        (0..self.slots.len())
            .filter(free)
            .find(|&i| Some(i) != self.last_slot)
            .or(self.last_slot.filter(free))
    }

    fn oldest_submitted(&self) -> Option<usize> {
        (0..self.slots.len())
            .filter(|&i| self.slots[i].state == SlotState::Submitted)
            .min_by_key(|&i| self.slots[i].seq)
    }
}

impl Drop for Ring {
    fn drop(&mut self) {
        // the VPPs still writing the slots first
        for (s, f) in self.slots.iter().zip(&self.fences) {
            if s.state == SlotState::Submitted {
                fence_wait(f.as_raw_fd(), 1000);
            }
        }
    }
}

/// the preview surface (BGRx), read back through a derived image (the map blits it to a staging buffer and waits).
/// Field order is drop order.
struct Preview {
    img: Image,
    ctx: Context,
    surf: Surfaces,
    w: u32,
    h: u32,
    submitted: bool,
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
        // (radeonsi derives it, the 9070 XT's and the Raphael iGPU's)
        let img = va
            .derive_image(surf.ids[0])
            .filter(|d| {
                let f = d.img.format.fourcc;
                (f == sys::VA_FOURCC_BGRX || f == sys::VA_FOURCC_BGRA)
                    && d.img.num_planes == 1
                    && d.img.pitches[0] >= w * 4
            })
            .context("the preview: no BGRx image derived")?;
        Ok(Preview {
            img,
            ctx,
            surf,
            w,
            h,
            submitted: false,
        })
    }

    /// read the submitted preview back and send it; whether it was read
    fn send(&mut self, va: &Va, t: f64) -> bool {
        self.submitted = false;
        let (w, h) = (self.w as usize, self.h as usize);
        let mut buf = Vec::with_capacity(w * h * 4 + 4);
        buf.extend_from_slice(&(self.w | self.h << 16).to_le_bytes());
        let read = va.sync_surface(self.surf.ids[0]).is_ok()
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

/// a cast buffer (pw_buffer, by address), imported on first use
struct InBuf {
    pwb: usize,
    surf: Option<Surfaces>,
    failed: bool,
}

#[derive(Default)]
struct Stats {
    t_start: f64,
    t_tick: f64,
    cpu_tick: f64,
    n_in: u32,
    n_skip: u32,
    n_nofree: u32,
    n_enc: u32,
    n_key: u32,
    n_repeat: u32,
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

#[derive(Default)]
struct State {
    // control: the commands (stdin thread), the input's size (loop thread)
    active: bool,          // encoding ("start", --start)
    req_kbps: u32,         // target (0: --kbps)
    req_h: u32,            // maximum height (0: --size's)
    fps: u32,              // the frame rate: --fps, then "fps N" (a pair only AV1 gets falls back for another codec)
    raw: bool,             // "raw": frames to mincord over the socket, not encoded
    encodes: bool,         // the device encodes AV1
    av1_align: (u32, u32), // AV1's encode size alignment (av1enc::align)
    want_key: bool,
    failed: bool,       // the encoder broke: no encoding until the next "start"
    quit: Option<Quit>, // why
    input: (u32, u32),  // the source's size (0: unknown yet)
    want: (u32, u32),     // the encode size for the input and request
    full: (u32, u32),     // ... with no height asked for
    prev_want: (u32, u32),
    prev_box: (u32, u32),

    // the encode ring and the preview: the worker (re)creates them, the loop thread VPPs into what's free. A preview
    // being read is out of here (taken by the worker).
    ring: Option<Ring>,
    prev: Option<Preview>,
    prev_next: f64,
    seq: u64,

    // the cast (loop thread)
    bufs: Vec<InBuf>,
    last_surf: Option<sys::VASurfaceID>, // the buffer processed last: what a static cast is encoded from
    credit: f64,                         // pacing: a token bucket, one token per 1/fps
    last_in: f64,

    st: Stats,
}

/// why capture stops
#[derive(Clone, Copy, Debug, PartialEq)]
enum Quit {
    Signal,
    Stopped, // "stop"
    StdinClosed,
    Seconds, // --seconds
    // the cast ended by itself (the window closed): mincord ends the stream instead of falling back
    CastClosed,
    Failed(&'static str),
}

struct Shared {
    m: Mutex<State>,
    cv: Condvar, // wakes the worker: a frame submitted, a command
}

impl Shared {
    fn quit(&self, why: Quit) {
        self.m.lock().unwrap().quit(why);
        self.cv.notify_one();
    }
}

static SIGNALLED: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    SIGNALLED.store(true, Ordering::Relaxed);
}

impl State {
    fn quit(&mut self, why: Quit) {
        self.quit.get_or_insert(why);
    }

    /// whether to stop: asked to, a signal, stdout gone
    fn quitting(&mut self) -> bool {
        if SIGNALLED.load(Ordering::Relaxed) {
            self.quit(Quit::Signal);
        }
        if out::broken() {
            self.quit(Quit::Failed("stdout broken"));
        }
        self.quit.is_some()
    }

    fn kbps(&self, o: &Opts) -> u32 {
        if self.req_kbps > 0 {
            self.req_kbps
        } else {
            o.kbps
        }
    }

    /// the encode size (the source fitted into --size and the asked maximum height; width a multiple of 8, height of
    /// 2: VCN 5's AV1 alignment) and the preview's
    fn update_sizes(&mut self, o: &Opts) {
        let (iw, ih) = self.input;
        if iw == 0 || ih == 0 {
            return;
        }
        let (mut bw, mut bh) = (o.max_w, o.max_h);
        if self.req_h > 0 && self.req_h < bh {
            bw = (bw as u64 * self.req_h as u64 / bh as u64) as u32;
            bh = self.req_h;
        }
        let align = if self.raw { (2, 2) } else { self.av1_align };
        self.full = fit(iw, ih, o.max_w, o.max_h, align, 16);
        self.want = fit(iw, ih, bw, bh, align, 16);
        if self.prev_box.0 > 0 {
            self.prev_want = fit(iw, ih, self.prev_box.0, self.prev_box.1, (2, 2), 2);
        }
    }

    /// the imported cast buffers dropped (a new format)
    fn drop_surfaces(&mut self) {
        self.last_surf = None;
        for b in &mut self.bufs {
            b.surf = None;
            b.failed = false;
        }
    }

    /// one command line:
    ///   start [kbps=N] [height=N] [codec=av1]
    ///                               encode (the preview runs regardless)
    ///   raw                         stop encoding, hand frames out over --socket-fd (mincord's fallback)
    ///   bitrate N                   new target (kbps), from the next frame
    ///   key                         the next frame a keyframe
    ///   height N                    maximum encode height (0: --size's); a new size starts with a keyframe
    ///   fps N                       the frame rate (the encoder re-opens at it)
    ///   audio SPEC                  the stream's sound (audio.rs)
    ///   stop                        exit (as does EOF)
    fn command(&mut self, line: &str, o: &Opts) {
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
            if !self.encodes || line.contains("codec=") && !line.contains("codec=av1") {
                info(&format!(
                    "{{\"type\":\"error\",\"message\":\"no such encoder on {}\"}}",
                    o.device
                ));
                return;
            }
            self.active = true;
            self.raw = false;
            self.req_kbps = kv("kbps=", self.kbps(o));
            self.req_h = kv("height=", self.req_h);
            self.want_key = true;
            self.failed = false;
            self.update_sizes(o);
            eprintln!("cmd: start {} kbps, height {}", self.req_kbps, self.req_h);
            stage("start");
        } else if line == "raw" {
            if o.socket.is_none() {
                info("{\"type\":\"error\",\"message\":\"raw: no --socket-fd\"}");
                return;
            }
            self.raw = true;
            self.active = false;
            self.update_sizes(o);
            eprintln!("cmd: raw");
            stage("raw");
        } else if let Some(n) = line.strip_prefix("bitrate ") {
            self.req_kbps = arg(n).clamp(100, 100000) as u32;
        } else if let Some(n) = line.strip_prefix("fps ") {
            self.fps = (arg(n) as u32).clamp(1, 240);
            eprintln!("cmd: fps {}", self.fps);
        } else if line == "key" {
            self.want_key = true;
        } else if let Some(n) = line.strip_prefix("height ") {
            self.req_h = arg(n) as u32;
            self.update_sizes(o);
        } else if let Some(t) = line.strip_prefix("audio ") {
            match audio::Target::parse(t) {
                Some(t) => audio::set_target(t),
                None => eprintln!("cmd: bad audio target {t:?}"),
            }
        } else if line == "stop" {
            self.quit(Quit::Stopped);
        }
    }
}

/// commands from a pipe (mincord); stdin from /dev/null or a terminal isn't watched (lab and cost runs)
fn watch_stdin(sh: Arc<Shared>, o: Arc<Opts>) {
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
                sh.m.lock()
                    .unwrap()
                    .command(String::from_utf8_lossy(&line[..nl]).as_ref(), &o);
                sh.cv.notify_one();
            }
            if buf.len() >= 511 {
                buf.clear(); // garbage
            }
        }
        sh.quit(Quit::StdinClosed);
    });
}

// ---------------------------------------------------------------- stats, output

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

// ---------------------------------------------------------------- the worker: encode, preview

type Guard<'a> = MutexGuard<'a, State>;

struct Worker<'a> {
    sh: &'a Shared,
    o: &'a Opts,
    va: &'a Va,
    vpp_cfg: &'a va::Config,
    enc: Option<Av1Enc>, // with the ring
    enc_fps: u32,        // the frame rate it was opened for
    last_enc_t: f64,     // frame dropper: bits sent over the target
    debt: f64,
    ivf: Option<File>,
    ivf_frames: u32,
}

impl<'a> Worker<'a> {
    fn lock(&self) -> Guard<'a> {
        self.sh.m.lock().unwrap()
    }

    /// every second a "stats" info (also into the log)
    fn tick(&self, mut g: Guard<'a>) -> Guard<'a> {
        let t = now();
        let st = &g.st;
        if t - st.t_tick < 1.0 {
            return g;
        }
        let cpu_now = cpu_s();
        let dt = t - st.t_tick;
        let cpu = (cpu_now - st.cpu_tick) / dt * 100.0;
        let ne = st.n_enc.max(1) as f64;
        let (rw, rh) = g.ring.as_ref().map_or((0, 0), |r| (r.w, r.h));
        let st = &g.st;
        let json = format!(
            "{{\"type\":\"stats\",\"in\":{:.1},\"fps\":{:.1},\"kbps\":{:.0},\"target\":{},\"width\":{rw},\"height\":{rh},\
             \"keys\":{},\"repeats\":{},\"skipped\":{},\"busy\":{},\"dropper\":{},\"outDrops\":{},\"encodeMs\":{:.2},\
             \"maxEncodeMs\":{:.2},\"latencyMs\":{:.2},\"maxLatencyMs\":{:.2},\"previews\":{},\"cpu\":{cpu:.1}}}",
            st.n_in as f64 / dt,
            st.n_enc as f64 / dt,
            st.bytes as f64 * 8.0 / dt / 1e3,
            g.kbps(self.o),
            st.n_key,
            st.n_repeat,
            st.n_skip,
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
        g.st = Stats {
            t_start: st.t_start,
            t_tick: t,
            cpu_tick: cpu_now,
            total_in: st.total_in + st.n_in as u64,
            total_sub: st.total_sub,
            total_enc: st.total_enc,
            ms_enc_total: st.ms_enc_total,
            ..Default::default()
        };
        if self.o.seconds > 0.0 && t - g.st.t_start >= self.o.seconds {
            g.quit(Quit::Seconds);
        }
        drop(g);
        out::send(out::MSG_INFO, 0, t, json.as_bytes(), &[], true);
        self.lock()
    }

    /// the encode ring + encoder at the wanted size while encoding (none otherwise), the preview at its size
    fn reconcile(&mut self, g: &mut State) {
        let want = (g.active || g.raw) && g.want.0 > 0 && !g.failed;
        if let Some(r) = &g.ring {
            let reopen = r.raw != g.raw || (self.enc.is_some() && self.enc_fps != g.fps);
            if !want || (r.w, r.h) != g.want || reopen {
                let why = if !want {
                    ""
                } else if reopen {
                    " (mode)"
                } else {
                    " (resize)"
                };
                eprintln!("enc: {}x{} off{why}", r.w, r.h);
                g.ring = None;
                self.enc = None;
            }
        }
        if want && g.raw && g.ring.is_none() {
            match Ring::create(self.va, self.vpp_cfg, g.want, true).and_then(|r| self.announce(&r).map(|_| r)) {
                Ok(r) => {
                    g.want_key = true; // the last frame at once (repeat), however static the cast
                    info(&format!(
                        "{{\"type\":\"started\",\"width\":{},\"height\":{},\"codec\":\"raw\"}}",
                        r.w, r.h
                    ));
                    g.ring = Some(r);
                }
                Err(e) => {
                    eprintln!("raw setup: {e:#}");
                    g.failed = true;
                    info("{\"type\":\"error\",\"message\":\"raw setup failed\"}");
                }
            }
        }
        if want && !g.raw && g.ring.is_none() {
            let ((width, height), o) = (g.want, self.o);
            let cfg = av1enc::Cfg {
                width,
                height,
                fps: g.fps,
                kbps: g.kbps(o),
                min_qindex: o.min_qindex,
                refs: o.refs,
            };
            let created = Ring::create(self.va, self.vpp_cfg, g.want, false)
                .and_then(|r| Ok((r, Av1Enc::open(self.va, cfg)?)));
            match created {
                Ok((r, enc)) => {
                    g.want_key = true;
                    stage("encoder");
                    info(&format!(
                        "{{\"type\":\"started\",\"width\":{},\"height\":{},\"codec\":\"AV1\"}}",
                        r.w, r.h
                    ));
                    g.ring = Some(r);
                    self.enc = Some(enc);
                    self.enc_fps = g.fps;
                }
                Err(e) => {
                    eprintln!("encoder setup: {e:#}");
                    g.failed = true;
                    info("{\"type\":\"error\",\"message\":\"encoder setup failed\"}");
                }
            }
        }
        if g.prev.as_ref().is_some_and(|p| p.submitted) {
            return;
        }
        if g.prev.as_ref().is_some_and(|p| (p.w, p.h) != g.prev_want) {
            g.prev = None;
        }
        if g.prev.is_none() && g.prev_want.0 > 0 {
            match Preview::create(self.va, self.vpp_cfg, g.prev_want) {
                Ok(p) => {
                    g.prev = Some(p);
                    stage("preview-ready");
                }
                Err(e) => {
                    eprintln!("preview: {e:#}");
                    (g.prev_box, g.prev_want) = ((0, 0), (0, 0)); // no preview, but the stream goes on
                }
            }
        }
    }

    /// encode slot i, send the temporal unit; the lock is dropped meanwhile
    fn encode(&mut self, mut g: Guard<'a>, i: usize, repeat: bool) -> Guard<'a> {
        let key = std::mem::take(&mut g.want_key);
        let kbps = g.kbps(self.o);
        let r = g.ring.as_mut().unwrap();
        r.slots[i].state = SlotState::Busy;
        let (surf, fence, slot, wh) = (r.surfs.ids[i], r.fences[i].as_raw_fd(), r.slots[i], r.w | r.h << 16);
        drop(g);

        if !repeat {
            fence_wait(fence, 1000);
        }
        // frame dropper (libwebrtc's FrameDropper, roughly): radeonsi doesn't enforce the HRD, so a scene cut can come
        // out as one frame worth most of a second of the budget, and everything behind it stalls in the pacer. Bits
        // over the target are a debt draining at the target rate; while it's over --drop-ms worth, frames aren't
        // encoded at all. A keyframe request is never dropped.
        let (t_now, per_s) = (now(), kbps as f64 * 1000.0);
        if self.last_enc_t > 0.0 {
            self.debt = (self.debt - per_s * (t_now - self.last_enc_t).min(1.0)).max(0.0);
        }
        self.last_enc_t = t_now;
        let dropped = self.o.drop_ms > 0.0 && !key && self.debt > per_s * self.o.drop_ms / 1000.0;
        let mut done = None; // (bytes, frame info, sent)
        let mut failed = false;
        if !dropped {
            let enc = self.enc.as_mut().unwrap();
            enc.set_kbps(kbps);
            match enc.encode(surf, key) {
                Ok((data, fi)) => {
                    self.debt += data.len() as f64 * 8.0;
                    if let Some(f) = self.ivf.as_mut() {
                        let _ = f.write_all(&(data.len() as u32).to_le_bytes());
                        let _ = f.write_all(&(self.ivf_frames as u64).to_le_bytes());
                        let _ = f.write_all(data);
                        self.ivf_frames += 1;
                    }
                    let pre: Vec<u8> = [fi.key as u32, wh, fi.qp, ((now() - slot.t_submit) * 1e6) as u32]
                        .iter()
                        .flat_map(|v| v.to_le_bytes())
                        .collect();
                    let sent = out::send(out::MSG_FRAME, slot.seq as u32, slot.t_submit, &pre, data, true);
                    if sent == out::Sent::Ok {
                        stage("first-frame");
                    }
                    done = Some((data.len(), fi, sent));
                }
                Err(e) => {
                    eprintln!("encode: {e:#}");
                    failed = true;
                }
            }
        }
        let lat = (now() - slot.t_submit) * 1e3;

        let mut g = self.lock();
        let st = &mut g.st;
        match &done {
            Some((len, fi, _)) => {
                st.n_enc += 1;
                st.total_enc += 1;
                st.n_key += fi.key as u32;
                st.n_repeat += repeat as u32;
                st.ms_enc += fi.ms_encode;
                st.ms_enc_total += fi.ms_encode;
                st.max_enc = st.max_enc.max(fi.ms_encode);
                st.ms_lat += lat;
                st.max_lat = st.max_lat.max(lat);
                st.bytes += *len as u64;
            }
            None if dropped => st.n_dropper += 1,
            None => {}
        }
        if failed {
            g.failed = true; // the encoder broke: mincord falls back
            info("{\"type\":\"error\",\"message\":\"encode failed\"}");
        }
        if done.is_some_and(|(_, _, sent)| sent == out::Sent::Dropped) {
            g.st.n_outdrop += 1;
            g.want_key = true; // mincord lost a frame: restart the stream
        }
        let r = g.ring.as_mut().unwrap();
        r.last_slot = Some(i);
        r.slots[i].state = SlotState::Free;
        g
    }

    /// raw: each surface of a new ring to mincord, with its fd
    fn announce(&self, r: &Ring) -> Result<()> {
        let sock = self.o.socket.context("no --socket-fd")?;
        eprintln!(
            "raw: {} x NV12 {}x{} modifier {:#x}",
            r.exports.len(),
            r.w,
            r.h,
            r.exports[0].modifier
        );
        for (i, e) in r.exports.iter().enumerate() {
            let planes: Vec<String> = e
                .planes
                .iter()
                .map(|(o, s, z)| format!("{{\"offset\":{o},\"stride\":{s},\"size\":{z}}}"))
                .collect();
            let m = format!(
                "{{\"type\":\"buffer\",\"id\":{i},\"width\":{},\"height\":{},\"modifier\":\"{}\",\"planes\":[{}]}}",
                r.w,
                r.h,
                e.modifier,
                planes.join(",")
            );
            if !sock_send(sock, &m, &[e.fd.as_raw_fd()]) {
                bail!("socket: {}", std::io::Error::last_os_error());
            }
        }
        Ok(())
    }

    /// slot i to the encoder, or (raw) to mincord
    fn deliver(&mut self, g: Guard<'a>, i: usize, repeat: bool) -> Guard<'a> {
        match g.ring.as_ref().is_some_and(|r| r.raw) {
            true => self.hand_out(g, i, repeat),
            false => self.encode(g, i, repeat),
        }
    }

    /// raw: slot i to mincord once its VPP is done (a repeat: the same surface again, as a new frame)
    fn hand_out(&mut self, mut g: Guard<'a>, i: usize, repeat: bool) -> Guard<'a> {
        g.want_key = false;
        let r = g.ring.as_mut().unwrap();
        r.slots[i].state = SlotState::Busy;
        let (fence, slot) = (r.fences[i].as_raw_fd(), r.slots[i]);
        drop(g);

        if !repeat {
            fence_wait(fence, 1000);
        }
        let m = format!(
            "{{\"type\":\"frame\",\"id\":{i},\"seq\":{},\"t\":{}}}",
            slot.seq,
            (slot.t_submit * 1e6) as u64
        );
        let sent = sock_send(self.o.socket.unwrap(), &m, &[]);
        let t = now();
        self.last_enc_t = t;
        let lat = (t - slot.t_submit) * 1e3;

        let mut g = self.lock();
        let st = &mut g.st;
        if sent {
            stage("first-frame");
            st.n_enc += 1;
            st.total_enc += 1;
            st.n_repeat += repeat as u32;
            st.ms_lat += lat;
            st.max_lat = st.max_lat.max(lat);
        } else {
            st.n_outdrop += 1;
        }
        let r = g.ring.as_mut().unwrap();
        r.slots[i].t_out = t;
        r.slots[i].state = if sent { SlotState::Out } else { SlotState::Free };
        if sent {
            r.last_slot = Some(i);
        }
        g
    }

    /// read the submitted preview back and send it; the lock is dropped meanwhile (the preview out of the state)
    fn preview_send(&mut self, mut g: Guard<'a>) -> Guard<'a> {
        let mut p = g.prev.take().unwrap();
        let t = now();
        drop(g);
        let read = p.send(self.va, t);
        let mut g = self.lock();
        g.st.n_prev += read as u32;
        g.prev = Some(p);
        g
    }

    /// nothing new from the cast (no frames while the source doesn't change), so the last frame again: a keyframe
    /// request is answered at once and the stream stays alive. The slot encoded last, or, when the encoder has only
    /// just started on a static cast, the last buffer once more through the VPP. False if there's nothing to repeat.
    fn repeat(&mut self, mut g: Guard<'a>) -> (Guard<'a>, bool) {
        let State {
            ring, seq, last_surf, ..
        } = &mut *g;
        let Some(r) = ring.as_mut() else {
            return (g, false);
        };
        let idle = |i: &usize| matches!(r.slots[*i].state, SlotState::Free | SlotState::Out);
        if let Some(i) = r.last_slot.filter(idle) {
            r.slots[i] = Slot::submitted(now(), *seq);
            *seq += 1;
            return (self.deliver(g, i, true), true);
        }
        let slot = r.last_slot.is_none().then_some(*last_surf).flatten().zip(r.free_slot());
        let Some((surf, i)) = slot else {
            return (g, false);
        };
        if vpp_submit(&r.ctx, r.w, r.h, surf, r.surfs.ids[i], false, true).is_err() {
            return (g, false);
        }
        r.slots[i] = Slot::submitted(now(), *seq);
        *seq += 1;
        (g, true)
    }

    /// the cast: encode what the loop thread submits, previews, repeats
    fn run_cast(&mut self) {
        let mut g = self.lock();
        while !g.quitting() {
            g = self.tick(g);
            self.reconcile(&mut g);
            let idle_ms = (now() - self.last_enc_t) * 1e3;
            if let Some(i) = g.ring.as_ref().and_then(Ring::oldest_submitted) {
                g = self.deliver(g, i, false);
            } else if g.prev.as_ref().is_some_and(|p| p.submitted) {
                g = self.preview_send(g);
            } else {
                let mut repeated = false;
                let raw = g.ring.as_ref().is_some_and(|r| r.raw);
                if (self.enc.is_some() || raw) && (g.want_key || idle_ms >= REPEAT_S * 1e3) {
                    (g, repeated) = self.repeat(g);
                }
                if !repeated {
                    g = self.sh.cv.wait_timeout(g, Duration::from_millis(30)).unwrap().0;
                }
            }
        }
    }
}

/// one message on raw's socket (non-blocking), with fds; false if it didn't go (full, gone)
fn sock_send(sock: i32, text: &str, fds: &[i32]) -> bool {
    let mut iov = libc::iovec {
        iov_base: text.as_ptr() as *mut _,
        iov_len: text.len(),
    };
    let mut cbuf = [0u64; 8]; // CMSG_SPACE for a few ints, aligned
                              // SAFETY: msg points at iov and cbuf, which outlive the call; the cmsg header is written inside cbuf
    unsafe {
        let mut msg: libc::msghdr = std::mem::zeroed();
        msg.msg_iov = &mut iov;
        msg.msg_iovlen = 1;
        if !fds.is_empty() {
            let len = std::mem::size_of_val(fds) as u32;
            msg.msg_control = cbuf.as_mut_ptr() as *mut _;
            msg.msg_controllen = libc::CMSG_SPACE(len) as usize;
            let h = libc::CMSG_FIRSTHDR(&msg);
            (*h).cmsg_level = libc::SOL_SOCKET;
            (*h).cmsg_type = libc::SCM_RIGHTS;
            (*h).cmsg_len = libc::CMSG_LEN(len) as usize;
            std::ptr::copy_nonoverlapping(fds.as_ptr(), libc::CMSG_DATA(h) as *mut i32, fds.len());
        }
        libc::sendmsg(sock, &msg, libc::MSG_NOSIGNAL | libc::MSG_DONTWAIT) >= 0
    }
}

// ---------------------------------------------------------------- main

fn main() {
    let mut o = opts();
    // what we inherited past stdio (Electron's CDP and other sockets reached capture: they'd stay open as long as
    // capture runs), except raw's socket
    let keep = o.socket.map_or(u32::MAX, |s| s as u32);
    // SAFETY: close_range on fds nothing here has opened yet
    unsafe {
        if keep > 3 {
            libc::syscall(libc::SYS_close_range, 3u32, keep - 1, 0u32);
        }
        if keep < u32::MAX {
            libc::syscall(libc::SYS_close_range, keep + 1, u32::MAX, 0u32);
        }
    }
    if o.device == "auto" {
        o.device = pick_device();
    }
    if o.probe {
        std::process::exit(probe(&o.device))
    }
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

/// --probe: what this device encodes, one JSON line on stdout (`{"device":"/dev/dri/renderD128","codecs":["av1"]}`, or
/// `[]`); mincord orders the codecs it advertises by it
fn probe(device: &str) -> i32 {
    let va = Va::open(device);
    let av1 = va.as_ref().is_ok_and(av1enc::supported);
    println!("{{\"device\":\"{device}\",\"codecs\":[{}]}}", if av1 { "\"av1\"" } else { "" });
    va.is_err() as i32
}

fn run(o: Arc<Opts>) -> Result<()> {
    if let Some(t) = o.audio.clone() {
        audio::set_target(t);
    }
    let no_va = || {
        info(&format!(
            "{{\"type\":\"error\",\"message\":\"no VA-API on {}\"}}",
            o.device
        ))
    };
    // the GPU side first: EGL's modifiers for the device (what the cast is offered; not for --clip), then VA-API
    let clip = !o.clip.is_empty();
    let mods = match (!clip).then(|| cast::modifiers(&o.device)).transpose() {
        Ok(m) => m,
        Err(e) => {
            no_va();
            return Err(e);
        }
    };
    if mods.is_some() {
        stage("modifiers");
    }
    let va = match Va::open(&o.device) {
        Ok(va) => va,
        Err(e) => {
            no_va();
            return Err(e).context(format!("open {}", o.device));
        }
    };
    let vpp_cfg = va.config(
        sys::VAProfile::VAProfileNone,
        sys::VAEntrypoint::VAEntrypointVideoProc,
        &mut [],
    )?;
    let (encodes, align) = (av1enc::supported(&va), av1enc::align(&va));
    eprintln!(
        "va: {}: {}, AV1 encode: {} (sizes aligned to {}x{})",
        o.device,
        va.vendor(),
        if encodes { "yes" } else { "no" },
        align.0,
        align.1
    );
    stage("va");

    // SAFETY: the handler only stores an atomic
    unsafe {
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }

    let ivf = match &o.ivf {
        Some(p) if encodes => {
            let mut f = File::create(p).with_context(|| format!("--encode-out {p}"))?;
            f.seek(SeekFrom::Start(32))?; // the header goes in at the end, with the frame count
            Some(f)
        }
        Some(_) => bail!("--encode-out: no AV1 encoder"),
        None => None,
    };
    let t_start = now();
    let active = (o.start || ivf.is_some()) && encodes;
    let state = State {
        active,
        want_key: active,
        fps: o.fps,
        encodes,
        av1_align: align,
        input: (o.clip_w, o.clip_h),
        prev_box: PREVIEW_BOX,
        credit: 1.0,
        last_in: t_start,
        st: Stats {
            t_start,
            t_tick: t_start,
            cpu_tick: cpu_s(),
            ..Default::default()
        },
        ..Default::default()
    };
    let sh = Arc::new(Shared {
        m: Mutex::new(state),
        cv: Condvar::new(),
    });

    // the niri cast (stopped when dropped, at the end)
    let source = match (o.window, &o.output) {
        (Some(id), _) => Some(mutter::Source::Window(id)),
        (_, Some(name)) => Some(mutter::Source::Output(name)),
        _ => None,
    };
    let session = match source.map(|s| mutter::start(sh.clone(), s, o.cursor)).transpose() {
        Ok(s) => s,
        Err(e) => {
            info("{\"type\":\"error\",\"message\":\"could not start the cast\"}");
            return Err(e);
        }
    };
    // or the portal's (closed when dropped)
    let mut portal = match o
        .portal
        .then(|| portal::start(sh.clone(), o.cursor, o.restore.as_deref()))
        .transpose()
    {
        Ok(p) => p,
        Err(e) => {
            info("{\"type\":\"error\",\"message\":\"could not start the cast\"}");
            return Err(e);
        }
    };
    if let Some(s) = &session {
        // the session's number is niri's cast session id: mincord stops the cast through niri's IPC should we die
        info(&format!(
            "{{\"type\":\"cast\",\"session\":\"{}\",\"sessionId\":{},\"node\":{}}}",
            s.path,
            s.session_id().unwrap_or("null"),
            s.node
        ));
    }
    if let Some(p) = &portal {
        // the token picks the same source next time without the portal's picker (mincord keeps it)
        let token = p
            .token
            .as_deref()
            .map_or("null".into(), |t| format!("\"{}\"", t.replace(['"', '\\'], "")));
        info(&format!(
            "{{\"type\":\"cast\",\"source\":\"portal\",\"node\":{},\"restoreToken\":{token}}}",
            p.node
        ));
    }
    if session.is_some() || portal.is_some() {
        let mut g = sh.m.lock().unwrap();
        let t = now();
        (g.st.t_start, g.st.t_tick, g.last_in) = (t, t, t);
    }

    watch_stdin(sh.clone(), o.clone());
    let remote = portal.as_mut().and_then(|p| p.fd.take());
    let cast = o
        .node
        .or(session.as_ref().map(|s| s.node))
        .or(portal.as_ref().map(|p| p.node))
        .zip(mods)
        .map(|(node, mods)| cast::spawn(sh.clone(), va.clone(), o.clone(), node, remote, mods));

    let mut w = Worker {
        sh: &sh,
        o: &o,
        va: &va,
        vpp_cfg: &vpp_cfg,
        enc: None,
        enc_fps: 0,
        last_enc_t: 0.0,
        debt: 0.0,
        ivf,
        ivf_frames: 0,
    };
    let ran = if !clip {
        w.run_cast();
        Ok(())
    } else {
        w.run_clip()
    };
    if let Some((thread, stop)) = cast {
        let _ = stop.send(());
        let _ = thread.join();
    }

    let mut g = sh.m.lock().unwrap();
    let why = g.quit.unwrap_or(Quit::Signal);
    eprintln!("quit: {why:?}");
    match why {
        Quit::CastClosed => info("{\"type\":\"ended\",\"reason\":\"cast closed\"}"),
        Quit::Stopped | Quit::StdinClosed | Quit::Seconds => {}
        Quit::Signal => info("{\"type\":\"error\",\"message\":\"terminated\"}"),
        Quit::Failed(msg) => info(&format!("{{\"type\":\"error\",\"message\":\"{msg}\"}}")),
    }
    let el = now() - g.st.t_start;
    let cpu = cpu_s();
    let st = &g.st;
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
    if let (Some(f), Some(r)) = (w.ivf.as_mut(), g.ring.as_ref()) {
        ivf_header(f, r.w, r.h, o.fps, w.ivf_frames)?;
    }
    // VA objects before the VPP config they were made with
    g.ring = None;
    g.prev = None;
    g.bufs.clear();
    drop(g);
    drop(w);
    ran
}
