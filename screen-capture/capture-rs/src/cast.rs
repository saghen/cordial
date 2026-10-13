// The cast's input (capture.c's "input stream" and query_modifiers): a PipeWire stream on its own thread, taking the
// cast as DMA-BUF. Its callbacks lock the shared state as the C's run with the loop lock: the newest buffer is
// imported into VA (once per buffer), VPP'd into a free slot of the encode ring and the preview when one is due, and
// requeued at once; the worker (main.rs) encodes.

use std::ffi::{c_char, c_int, c_void, CStr};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::{anyhow, bail, Result};
use pipewire as pw;
use pw::properties::properties;
use pw::spa::param::format::{MediaSubtype, MediaType};
use pw::spa::param::format_utils::parse_format;
use pw::spa::param::video::VideoInfoRaw;
use pw::spa::pod::serialize::PodSerializer;
use pw::spa::pod::{ChoiceValue, Object, Pod, PodPropFlags, Property, PropertyFlags, Value};
use pw::spa::sys as spa;
use pw::spa::utils::{Choice, ChoiceEnum, ChoiceFlags, Fraction, Id, Rectangle};
use pw::stream::{Stream, StreamFlags, StreamState};

use crate::out::{info, now, stage};
use crate::va::{vpp_submit, Va};
use crate::{InBuf, Opts, Shared, Slot, State};

const MAX_BUFS: usize = 32;

// ---------------------------------------------------------------- EGL: the modifiers the GPU imports

#[link(name = "EGL")]
extern "C" {
    fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
    fn eglInitialize(dpy: *mut c_void, major: *mut i32, minor: *mut i32) -> u32;
    fn eglTerminate(dpy: *mut c_void) -> u32;
    fn eglQueryString(dpy: *mut c_void, name: i32) -> *const c_char;
    fn eglGetError() -> i32;
}

#[link(name = "gbm")]
extern "C" {
    fn gbm_create_device(fd: c_int) -> *mut c_void;
    fn gbm_device_destroy(gbm: *mut c_void);
}

type GetPlatformDisplay = unsafe extern "C" fn(u32, *mut c_void, *const i32) -> *mut c_void;
type QueryModifiers = unsafe extern "C" fn(*mut c_void, i32, i32, *mut u64, *mut u32, *mut i32) -> u32;

/// the modifiers EGL can import XRGB8888 with on the device: what the cast is offered
pub fn modifiers(device: &str) -> Result<Vec<u64>> {
    const EGL_PLATFORM_GBM_KHR: u32 = 0x31d7;
    const EGL_VENDOR: i32 = 0x3053;
    const DRM_FORMAT_XRGB8888: i32 = 0x34325258;
    let file = std::fs::OpenOptions::new().read(true).write(true).open(device)?;
    // SAFETY: plain EGL/GBM calls; each pointer is checked before use, the procs have the extensions' signatures
    unsafe {
        use std::os::fd::AsRawFd;
        let gbm = gbm_create_device(file.as_raw_fd());
        let get_dpy = eglGetProcAddress(c"eglGetPlatformDisplayEXT".as_ptr());
        let query = eglGetProcAddress(c"eglQueryDmaBufModifiersEXT".as_ptr());
        if gbm.is_null() || get_dpy.is_null() || query.is_null() {
            bail!("no GBM device or EGL extensions on {device}");
        }
        let get_dpy: GetPlatformDisplay = std::mem::transmute(get_dpy);
        let query: QueryModifiers = std::mem::transmute(query);
        let dpy = get_dpy(EGL_PLATFORM_GBM_KHR, gbm, std::ptr::null());
        let (mut maj, mut min, mut n) = (0, 0, 0);
        let mut mods = vec![0u64; 128];
        let ok = !dpy.is_null()
            && eglInitialize(dpy, &mut maj, &mut min) != 0
            && query(
                dpy,
                DRM_FORMAT_XRGB8888,
                128,
                mods.as_mut_ptr(),
                std::ptr::null_mut(),
                &mut n,
            ) != 0;
        let err = eglGetError();
        if ok {
            let vendor = CStr::from_ptr(eglQueryString(dpy, EGL_VENDOR)).to_string_lossy();
            eprintln!("egl: {vendor}, {n} modifiers for XRGB8888");
        }
        if !dpy.is_null() {
            eglTerminate(dpy);
        }
        gbm_device_destroy(gbm);
        if !ok || n <= 0 {
            bail!("egl: no modifier list on {device}: 0x{err:x}");
        }
        mods.truncate(n as usize);
        Ok(mods)
    }
}

// ---------------------------------------------------------------- pods

fn serialize(v: &Value) -> Vec<u8> {
    PodSerializer::serialize(std::io::Cursor::new(Vec::new()), v)
        .expect("pod")
        .0
        .into_inner()
}

fn object(type_: u32, id: u32, properties: Vec<Property>) -> Vec<u8> {
    serialize(&Value::Object(Object { type_, id, properties }))
}

fn range<T>(default: T, min: T, max: T) -> Choice<T>
where
    T: pw::spa::pod::CanonicalFixedSizedPod,
{
    Choice(ChoiceFlags::empty(), ChoiceEnum::Range { default, min, max })
}

/// BGRx as DMA-BUF with one of `mods` (the producer fixates it), any size, at most fps
fn in_format(mods: &[u64], fps: u32) -> Vec<u8> {
    let rect = |width, height| Rectangle { width, height };
    let frac = |num, denom| Fraction { num, denom };
    let modifier = ChoiceEnum::Enum {
        default: mods[0] as i64,
        alternatives: mods.iter().map(|&m| m as i64).collect(),
    };
    object(
        spa::SPA_TYPE_OBJECT_Format,
        spa::SPA_PARAM_EnumFormat,
        vec![
            Property::new(spa::SPA_FORMAT_mediaType, Value::Id(Id(spa::SPA_MEDIA_TYPE_video))),
            Property::new(spa::SPA_FORMAT_mediaSubtype, Value::Id(Id(spa::SPA_MEDIA_SUBTYPE_raw))),
            Property::new(spa::SPA_FORMAT_VIDEO_format, Value::Id(Id(spa::SPA_VIDEO_FORMAT_BGRx))),
            Property {
                key: spa::SPA_FORMAT_VIDEO_modifier,
                flags: PropertyFlags::MANDATORY | PropertyFlags::DONT_FIXATE,
                value: Value::Choice(ChoiceValue::Long(Choice(ChoiceFlags::empty(), modifier))),
            },
            Property::new(
                spa::SPA_FORMAT_VIDEO_size,
                Value::Choice(ChoiceValue::Rectangle(range(
                    rect(3840, 2160),
                    rect(1, 1),
                    rect(16384, 16384),
                ))),
            ),
            Property::new(spa::SPA_FORMAT_VIDEO_framerate, Value::Fraction(frac(0, 1))),
            Property::new(
                spa::SPA_FORMAT_VIDEO_maxFramerate,
                Value::Choice(ChoiceValue::Fraction(range(frac(fps, 1), frac(0, 1), frac(fps, 1)))),
            ),
        ],
    )
}

/// 2 to 32 DMA-BUF buffers (4 by default), with a header meta (the corrupted flag)
fn buffer_params() -> [Vec<u8>; 2] {
    let buffers = vec![
        Property::new(
            spa::SPA_PARAM_BUFFERS_buffers,
            Value::Choice(ChoiceValue::Int(range(4, 2, MAX_BUFS as i32))),
        ),
        Property::new(
            spa::SPA_PARAM_BUFFERS_dataType,
            Value::Choice(ChoiceValue::Int(Choice(
                ChoiceFlags::empty(),
                ChoiceEnum::Flags {
                    default: 1 << spa::SPA_DATA_DmaBuf,
                    flags: vec![],
                },
            ))),
        ),
    ];
    let meta = vec![
        Property::new(spa::SPA_PARAM_META_type, Value::Id(Id(spa::SPA_META_Header))),
        Property::new(
            spa::SPA_PARAM_META_size,
            Value::Int(std::mem::size_of::<spa::spa_meta_header>() as i32),
        ),
    ];
    [
        object(spa::SPA_TYPE_OBJECT_ParamBuffers, spa::SPA_PARAM_Buffers, buffers),
        object(spa::SPA_TYPE_OBJECT_ParamMeta, spa::SPA_PARAM_Meta, meta),
    ]
}

// ---------------------------------------------------------------- the stream

/// the listener's data (loop thread only)
struct Input {
    sh: Arc<Shared>,
    va: Va,
    o: Arc<Opts>,
    mods: Vec<u64>,
    size: (u32, u32),
    modifier: u64,
}

/// the PipeWire thread, streaming node `node` until `stop` is sent (or the cast ends: quit set)
pub fn spawn(
    sh: Arc<Shared>,
    va: Va,
    o: Arc<Opts>,
    node: u32,
    mods: Vec<u64>,
) -> (JoinHandle<()>, pw::channel::Sender<()>) {
    let (stop, rx) = pw::channel::channel();
    let thread = std::thread::Builder::new()
        .name("pipewire".into())
        .spawn(move || {
            let sh2 = sh.clone();
            if let Err(e) = run(sh, va, o, node, mods, rx) {
                eprintln!("pipewire: {e:#}");
                sh2.quit("no PipeWire");
            }
        })
        .expect("thread");
    (thread, stop)
}

fn run(
    sh: Arc<Shared>,
    va: Va,
    o: Arc<Opts>,
    node: u32,
    mods: Vec<u64>,
    stop: pw::channel::Receiver<()>,
) -> Result<()> {
    pw::init();
    let ml = pw::main_loop::MainLoopRc::new(None)?;
    let ctx = pw::context::ContextRc::new(&ml, None)?;
    let core = ctx.connect_rc(None).map_err(|e| anyhow!("pw_context_connect: {e}"))?;
    let _core_listener = core
        .add_listener_local()
        .error({
            let sh = sh.clone();
            move |id, _seq, res, msg| {
                eprintln!("pipewire error id {id}: {msg} ({res})");
                if id == pw::core::PW_ID_CORE && res == -libc::EPIPE {
                    sh.quit("pipewire gone");
                }
            }
        })
        .register();
    let stream = pw::stream::StreamBox::new(
        &core,
        "mincord-capture",
        properties! {
            *pw::keys::MEDIA_TYPE => "Video",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
        },
    )?;
    let format = in_format(&mods, o.fps);
    let input = Input {
        sh: sh.clone(),
        va,
        o,
        mods,
        size: (0, 0),
        modifier: 0,
    };
    let _listener = stream
        .add_local_listener_with_user_data(input)
        .state_changed(|_, i, _, state| i.state_changed(state))
        .param_changed(|s, i, id, pod| i.param_changed(s, id, pod))
        .add_buffer(|_, i, b| i.add_buffer(b))
        .remove_buffer(|_, i, b| i.remove_buffer(b))
        .process(|s, i| i.process(s))
        .register()?;
    let pod = Pod::from_bytes(&format).expect("pod");
    if let Err(e) = stream.connect(
        pw::spa::utils::Direction::Input,
        Some(node),
        StreamFlags::AUTOCONNECT,
        &mut [pod],
    ) {
        eprintln!("pw_stream_connect: {e}");
        sh.quit("cast not connectable");
    }
    stage("pw-connect");
    let _stop = stop.attach(ml.loop_(), {
        let ml = ml.clone();
        move |()| ml.quit()
    });
    ml.run();
    Ok(())
}

/// the first header meta of a buffer, if it has one
///
/// SAFETY: sb is a valid spa_buffer
unsafe fn header(sb: *const spa::spa_buffer) -> Option<&'static spa::spa_meta_header> {
    let metas = std::slice::from_raw_parts((*sb).metas, (*sb).n_metas as usize);
    metas
        .iter()
        .find(|m| m.type_ == spa::SPA_META_Header && m.size as usize >= std::mem::size_of::<spa::spa_meta_header>())
        .map(|m| &*(m.data as *const spa::spa_meta_header))
}

impl Input {
    fn state_changed(&mut self, state: StreamState) {
        match &state {
            StreamState::Error(e) => eprintln!("input: error: {e}"),
            s => eprintln!("input: {}", format!("{s:?}").to_lowercase()),
        }
        match state {
            StreamState::Paused => stage("pw-paused"),
            StreamState::Streaming => stage("pw-streaming"),
            StreamState::Error(_) | StreamState::Unconnected => self.sh.quit("cast closed"),
            StreamState::Connecting => {}
        }
    }

    fn param_changed(&mut self, stream: &Stream, id: u32, pod: Option<&Pod>) {
        let Some(pod) = pod.filter(|_| id == spa::SPA_PARAM_Format) else {
            return;
        };
        if !parse_format(pod).is_ok_and(|f| f == (MediaType::Video, MediaSubtype::Raw)) {
            return;
        }
        let mut fmt = VideoInfoRaw::new();
        let _ = fmt.parse(pod);
        let prop = pod
            .as_object()
            .ok()
            .and_then(|o| o.find_prop(Id(spa::SPA_FORMAT_VIDEO_modifier)));
        if prop.is_some_and(|p| p.flags().contains(PodPropFlags::DONT_FIXATE)) {
            eprintln!("input: format with unfixated modifier list, waiting for the producer to fixate");
            stage("format-offered");
            return;
        }
        let (size, rate) = (fmt.size(), fmt.max_framerate());
        self.size = (size.width, size.height);
        self.modifier = fmt.modifier();
        eprintln!(
            "input: format {} {}x{} modifier 0x{:x}{} max {}/{}",
            format!("{:?}", fmt.format()).trim_start_matches("VideoFormat::"),
            size.width,
            size.height,
            self.modifier,
            if prop.is_some() {
                ""
            } else {
                " (no modifier: not DMA-BUF)"
            },
            rate.num,
            rate.denom
        );
        let mut g = self.sh.m.lock().unwrap();
        g.drop_surfaces();
        stage("format");
        if size.width > 0 && size.height > 0 {
            g.input = self.size;
            g.update_sizes(&self.o);
            self.sh.cv.notify_one();
            info(&format!(
                "{{\"type\":\"input\",\"width\":{},\"height\":{},\"encodeWidth\":{},\"encodeHeight\":{}}}",
                size.width, size.height, g.full.0, g.full.1
            ));
        }
        let params = buffer_params();
        let mut pods: Vec<&Pod> = params.iter().map(|p| Pod::from_bytes(p).expect("pod")).collect();
        if let Err(e) = stream.update_params(&mut pods) {
            eprintln!("update_params: {e}");
        }
    }

    fn add_buffer(&mut self, b: *mut pw::sys::pw_buffer) {
        let mut g = self.sh.m.lock().unwrap();
        if g.bufs.len() < MAX_BUFS {
            g.bufs.push(InBuf {
                pwb: b as usize,
                surf: None,
                failed: false,
            });
        }
        stage("buffers");
    }

    fn remove_buffer(&mut self, b: *mut pw::sys::pw_buffer) {
        let mut g = self.sh.m.lock().unwrap();
        let Some(i) = g.bufs.iter().position(|ib| ib.pwb == b as usize) else {
            return;
        };
        let ib = g.bufs.swap_remove(i);
        if ib.surf.as_ref().is_some_and(|s| Some(s.ids[0]) == g.last_surf) {
            g.last_surf = None;
        }
    }

    /// dequeue, pick the newest frame, submit it, requeue it at once: the VPP's read is only queued on the GPU, but
    /// amdgpu's implicit sync makes the producer's next render into this buffer wait for it
    fn process(&mut self, stream: &Stream) {
        let sh = self.sh.clone();
        let mut g = sh.m.lock().unwrap();
        let mut last: *mut pw::sys::pw_buffer = std::ptr::null_mut();
        loop {
            // SAFETY: buffers come from and go back to this stream
            let b = unsafe { stream.dequeue_raw_buffer() };
            if b.is_null() {
                break;
            }
            if !last.is_null() {
                unsafe { stream.queue_raw_buffer(last) };
            }
            last = b;
            g.st.n_in += 1;
        }
        if last.is_null() {
            return;
        }
        stage("first-buffer");
        // SAFETY: a dequeued pw_buffer and its spa_buffer, valid until queued again
        let usable = unsafe {
            let sb = (*last).buffer;
            let corrupt = header(sb).is_some_and(|h| h.flags & spa::SPA_META_HEADER_FLAG_CORRUPTED != 0);
            let d = (*sb).datas;
            (*sb).n_datas > 0
                && !corrupt
                && (*(*d).chunk).flags & spa::SPA_CHUNK_FLAG_CORRUPTED as i32 == 0
                && (*d).type_ == spa::SPA_DATA_DmaBuf
        };
        if usable && !self.submit_frame(&mut g, stream, last) {
            return;
        }
        // SAFETY: as above
        unsafe { stream.queue_raw_buffer(last) };
    }

    /// pacing, a free slot, import and VPP of buffer b into the slot (and into the preview when one is due); never
    /// waits for the GPU. False if b doesn't import (b requeued, renegotiating).
    fn submit_frame(&mut self, g: &mut State, stream: &Stream, b: *mut pw::sys::pw_buffer) -> bool {
        // pacing: at most --fps on average, but tolerate jitter (niri on a 240 Hz output delivers a 60 fps cast at
        // 12.5/16.7/20.8 ms intervals). Frames over budget go back untouched.
        let t0 = now();
        g.credit = (g.credit + (t0 - g.last_in) * self.o.fps as f64).min(2.0);
        g.last_in = t0;
        let mut want_enc = g.ring.as_ref().is_some_and(|r| (r.w, r.h) == g.want);
        let want_prev = g.prev.as_ref().is_some_and(|p| !p.submitted) && t0 >= g.prev_next;
        if want_enc && g.credit < 1.0 {
            g.st.n_skip += 1;
            want_enc = false;
        }
        let slot = g.ring.as_ref().filter(|_| want_enc).and_then(|r| r.free_slot());
        g.st.n_nofree += (want_enc && slot.is_none()) as u32; // the worker is behind: drop rather than wait
        let Some(ib) = g.bufs.iter().position(|ib| ib.pwb == b as usize) else {
            return true;
        };
        if (slot.is_none() && !want_prev) || g.bufs[ib].failed {
            return true;
        }
        if g.bufs[ib].surf.is_none() {
            // SAFETY: b is dequeued; its datas and chunks are valid
            let planes: Vec<(i32, u32, u32)> = unsafe {
                let sb = (*b).buffer;
                std::slice::from_raw_parts((*sb).datas, (*sb).n_datas as usize)
                    .iter()
                    .map(|d| (d.fd as i32, (*d.chunk).offset, (*d.chunk).stride as u32))
                    .collect()
            };
            let (w, h) = self.size;
            match self.va.import(w, h, self.modifier, &planes) {
                Ok(s) => g.bufs[ib].surf = Some(s),
                Err(e) => {
                    eprintln!(
                        "va import failed: {e:#}; {w}x{h} modifier 0x{:x} planes {}",
                        self.modifier,
                        planes.len()
                    );
                    g.bufs[ib].failed = true;
                    // SAFETY: b is dequeued from this stream
                    unsafe { stream.queue_raw_buffer(b) };
                    self.renegotiate_without(g, stream, self.modifier);
                    return false;
                }
            }
        }
        let surf = g.bufs[ib].surf.as_ref().unwrap().ids[0];
        g.last_surf = Some(surf);
        let State {
            prev,
            prev_next,
            ring,
            seq,
            credit,
            st,
            ..
        } = g;
        if let Some(p) = prev.as_mut().filter(|_| want_prev) {
            if vpp_submit(&p.ctx, p.w, p.h, surf, p.surf.ids[0], false, false).is_ok() {
                stage("first-vpp");
                p.submitted = true;
                *prev_next = t0 + self.o.prev_interval;
            }
        }
        if let (Some(i), Some(r)) = (slot, ring.as_mut()) {
            if vpp_submit(&r.ctx, r.w, r.h, surf, r.surfs.ids[i], false, true).is_ok() {
                stage("first-encode-vpp");
                r.slots[i] = Slot::submitted(now(), *seq);
                *seq += 1;
                *credit -= 1.0;
                st.total_sub += 1;
            }
        }
        self.sh.cv.notify_one();
        true
    }

    /// a modifier VA can't import: offer the producer the others (as OBS does)
    fn renegotiate_without(&mut self, g: &mut State, stream: &Stream, bad: u64) {
        self.mods.retain(|&m| m != bad);
        if self.mods.is_empty() {
            g.quit("no importable modifiers");
            return;
        }
        eprintln!("renegotiating without modifier 0x{bad:x} ({} left)", self.mods.len());
        g.drop_surfaces();
        let format = in_format(&self.mods, self.o.fps);
        if let Err(e) = stream.update_params(&mut [Pod::from_bytes(&format).expect("pod")]) {
            eprintln!("update_params: {e}");
        }
    }
}
