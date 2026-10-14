// --clip: a raw I420 file as the source (the lab's: the same frames every run, each frame's index stamped as the
// bench's barcode), played in real time. A reader thread reads it, stamps the barcode and converts it to NV12
// CLIP_RING frames ahead; the worker uploads each and VPPs it into the encode ring like a cast frame.

use std::fs::File;
use std::os::unix::fs::FileExt;
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{bail, Context as _, Result};

use crate::out::{info, now};
use crate::va::{sys, vpp_submit};
use crate::{Slot, State, Worker, PREVIEW_INTERVAL_S};

const CLIP_RING: usize = 6;

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

impl Worker<'_> {
    /// the clip, uploaded to NV12 and VPP-scaled into the encode ring like a cast frame (put straight into the slot at
    /// its own size: Mesa's VPP isn't an exact copy). The upload is CPU work the real path doesn't have.
    pub fn run_clip(&mut self) -> Result<()> {
        let o = self.o;
        let (w, h) = (o.clip_w, o.clip_h);
        let ysize = (w * h) as usize;
        let file = File::open(&o.clip).with_context(|| format!("clip {}", o.clip))?;
        let count = file.metadata()?.len() / (ysize * 3 / 2) as u64;
        if count == 0 {
            bail!("clip {}: shorter than one frame", o.clip);
        }
        let src = self.va.surfaces(sys::VA_RT_FORMAT_YUV420, w, h, 1, &mut [])?;
        let nv12 = sys::VAImageFormat {
            fourcc: sys::VA_FOURCC_NV12,
            byte_order: sys::VA_LSB_FIRST,
            bits_per_pixel: 12,
            ..Default::default()
        };
        let img = self.va.image(nv12, w, h)?;
        let (tx, rx) = mpsc::sync_channel(CLIP_RING);
        let reader = std::thread::spawn(move || clip_reader(file, w, h, count, tx));
        eprintln!("clip: {} {w}x{h}, {count} frames at {} fps", o.clip, o.fps);
        let mut g = self.lock();
        g.update_sizes(o);
        info(&format!(
            "{{\"type\":\"input\",\"width\":{w},\"height\":{h},\"encodeWidth\":{},\"encodeHeight\":{}}}",
            g.full.0, g.full.1
        ));
        let (mut next, period) = (0.0f64, 1.0 / o.fps as f64);
        let mut idx = 0u64;
        while !g.quitting() {
            g = self.tick(g);
            self.reconcile(&mut g);
            if g.prev.as_ref().is_some_and(|p| p.submitted) {
                g = self.preview_send(g);
            }
            drop(g);

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

            g = self.lock();
            g.st.n_in += 1;
            let t = now();
            let uploaded = img.put(src.ids[0]).is_ok();
            // the clip plays in real time at --fps; the stream takes frames at its rate ("fps N"), as from a cast. Counted
            // in clip frames, not wall time: at an equal rate every frame is taken, whatever the sleep's jitter
            g.credit = (g.credit + g.fps as f64 / o.fps as f64).min(2.0);
            g.last_in = t;
            let due = g.credit >= 1.0;
            if due {
                g.credit -= 1.0;
            }
            let State {
                prev,
                prev_next,
                ring,
                st,
                ..
            } = &mut *g;
            if let Some(p) = prev.as_mut().filter(|p| uploaded && !p.submitted && t >= *prev_next) {
                if vpp_submit(&p.ctx, p.w, p.h, src.ids[0], p.surf.ids[0], true, false).is_ok() {
                    p.submitted = true;
                    *prev_next = t + PREVIEW_INTERVAL_S;
                }
            }
            let slot = ring
                .as_mut()
                .filter(|r| uploaded && due && (self.enc.is_some() || r.raw))
                .and_then(|r| {
                    let i = r.free_slot()?;
                    let s = r.surfs.ids[i];
                    let submitted = if (r.w, r.h) == (w, h) {
                        img.put(s)
                    } else {
                        vpp_submit(&r.ctx, r.w, r.h, src.ids[0], s, true, true)
                    };
                    submitted.ok()?;
                    r.slots[i] = Slot::submitted(t, idx);
                    Some(i)
                });
            if let Some(i) = slot {
                st.total_sub += 1;
                g = self.deliver(g, i, false);
            }
            idx += 1;
            if self.ivf.is_some() && o.seconds <= 0.0 && idx >= count {
                break;
            }
        }
        drop(g);
        drop(rx);
        let _ = reader.join();
        Ok(())
    }
}
