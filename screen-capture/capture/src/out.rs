// stdout to mincord (capture.c's send_msg): a message is a 24-byte header (u32 LE: magic "CSZ1", type, payload size,
// seq, then u64 µs of CLOCK_MONOTONIC) + payload. frame: u32 flags (1: key), u32 w | h << 16, u32 qindex (0: none),
// u32 submit -> encoded µs, then the temporal unit (OBUs, no temporal delimiter); its time is the frame's VPP submit.
// preview: u32 w | h << 16, then w x h BGRx, rows packed. info: JSON. audio (audio.rs): u32 rate, u32 channels, then
// s16 samples, interleaved; its time is when it was taken from PipeWire. Plus the log (stderr) and the startup stages.

use std::collections::HashSet;
use std::io::IoSlice;
use std::os::fd::{AsRawFd, BorrowedFd};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const MSG_MAGIC: u32 = 0x315a5343; // "CSZ1"
pub const MSG_FRAME: u32 = 2;
pub const MSG_INFO: u32 = 3;
pub const MSG_PREVIEW: u32 = 4;
pub const MSG_AUDIO: u32 = 5;

#[derive(PartialEq)]
pub enum Sent {
    Ok,
    Dropped, // droppable and the pipe was full before a byte went out
    Broken,  // an error, or stuck > 2 s mid-message
}

static OUT: Mutex<()> = Mutex::new(());
static BROKEN: AtomicBool = AtomicBool::new(false);
static T_MAIN: OnceLock<f64> = OnceLock::new();

/// CLOCK_MONOTONIC in s: the clock of every time here and in the messages
pub fn now() -> f64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: clock_gettime fills ts
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as f64 + ts.tv_nsec as f64 / 1e9
}

/// whether a write to stdout failed for good (the caller quits)
pub fn broken() -> bool {
    BROKEN.load(Ordering::Relaxed)
}

/// one message to stdout (non-blocking)
pub fn send(kind: u32, seq: u32, t: f64, a: &[u8], b: &[u8], droppable: bool) -> Sent {
    let us = (t * 1e6) as u64;
    let hdr: Vec<u8> = [
        MSG_MAGIC,
        kind,
        (a.len() + b.len()) as u32,
        seq,
        us as u32,
        (us >> 32) as u32,
    ]
    .iter()
    .flat_map(|v| v.to_le_bytes())
    .collect();
    let parts = [&hdr[..], a, b];
    let total: usize = parts.iter().map(|p| p.len()).sum();
    let deadline = now() + 2.0;
    // SAFETY: fd 1 is open for the process's life
    let fd = unsafe { BorrowedFd::borrow_raw(1) };
    let _lock = OUT.lock().unwrap();
    let mut sent = 0;
    let ret = loop {
        if sent == total {
            break Sent::Ok;
        }
        let mut skip = sent;
        let iov: Vec<IoSlice> = parts
            .iter()
            .filter_map(|p| {
                if skip >= p.len() {
                    skip -= p.len();
                    return None;
                }
                let s = IoSlice::new(&p[skip..]);
                skip = 0;
                Some(s)
            })
            .collect();
        // SAFETY: IoSlice is ABI-compatible with iovec
        let w = unsafe { libc::writev(fd.as_raw_fd(), iov.as_ptr() as *const libc::iovec, iov.len() as i32) };
        if w > 0 {
            sent += w as usize;
            continue;
        }
        let err = std::io::Error::last_os_error().raw_os_error();
        if w < 0 && err == Some(libc::EINTR) {
            continue;
        }
        if w < 0 && err != Some(libc::EAGAIN) {
            break Sent::Broken;
        }
        if sent == 0 && droppable {
            break Sent::Dropped;
        }
        let ms = ((deadline - now()) * 1e3) as i32;
        let mut p = libc::pollfd {
            fd: 1,
            events: libc::POLLOUT,
            revents: 0,
        };
        // SAFETY: one valid pollfd
        if ms <= 0 || unsafe { libc::poll(&mut p, 1, ms) } <= 0 {
            break Sent::Broken;
        }
    };
    if ret == Sent::Broken {
        BROKEN.store(true, Ordering::Relaxed);
    }
    ret
}

/// an info message (JSON), also into the log
pub fn info(json: &str) {
    eprintln!("info: {json}");
    send(MSG_INFO, 0, now(), json.as_bytes(), &[], false);
}

/// a startup stage reached, as an info message (its time is when) and into the log; each name once
pub fn stage(name: &str) {
    static DONE: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    if !DONE.lock().unwrap().get_or_insert_default().insert(name.to_string()) {
        return;
    }
    let ms = (now() - T_MAIN.get_or_init(now)) * 1e3;
    eprintln!("stage: {name} at {ms:.1} ms");
    info(&format!("{{\"type\":\"stage\",\"name\":\"{name}\"}}"));
}

/// the process's start, for the stages' times
pub fn start() {
    T_MAIN.get_or_init(now);
}

/// stderr is /dev/null (as mincord starts us): the log goes to $XDG_RUNTIME_DIR/mincord-capture/<pid>.log (logs older
/// than a day are removed)
pub fn stderr_to_log() {
    use std::os::unix::fs::MetadataExt;
    let Some(rt) = std::env::var_os("XDG_RUNTIME_DIR") else {
        return;
    };
    let (Ok(err), Ok(null)) = (std::fs::metadata("/proc/self/fd/2"), std::fs::metadata("/dev/null")) else {
        return;
    };
    if err.rdev() != null.rdev() || err.ino() != null.ino() {
        return;
    }
    let dir = std::path::Path::new(&rt).join("mincord-capture");
    let _ = std::fs::create_dir_all(&dir);
    let day_ago = std::time::SystemTime::now() - Duration::from_secs(86400);
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let old = e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < day_ago);
        if old && e.file_name().to_string_lossy().contains(".log") {
            let _ = std::fs::remove_file(e.path());
        }
    }
    let path = dir.join(format!("{}.log", std::process::id()));
    use std::os::unix::fs::OpenOptionsExt;
    let f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path);
    if let Ok(f) = f {
        // SAFETY: f's fd is valid; dup2 onto 2
        unsafe { libc::dup2(f.as_raw_fd(), 2) };
    }
}
