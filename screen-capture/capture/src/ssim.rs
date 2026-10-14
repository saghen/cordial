// The stream's quality, sampled: SSIM of what the encoder made of a frame (its reconstructed picture, which is what a
// viewer's decoder shows) against the frame it was given, luma only, once a second. 8x8 blocks, not overlapping, with
// the usual constants. The reference is the scaled frame, so the scaling's loss isn't counted.

use anyhow::Result;

use crate::va::{sys::VASurfaceID, Image};

/// the luma of `surf`'s top-left (the image's size) through `img`, packed (stride = width)
pub fn luma(img: &Image, surf: VASurfaceID) -> Result<Vec<u8>> {
    let (w, h) = (img.img.width as usize, img.img.height as usize);
    img.get(surf)?;
    let mut out = Vec::with_capacity(w * h);
    img.read(|p, off, pitch| {
        for y in 0..h {
            let row = off[0] as usize + y * pitch[0] as usize;
            out.extend_from_slice(&p[row..row + w]);
        }
    })?;
    Ok(out)
}

/// mean SSIM over the 8x8 blocks of two w-wide luma planes
pub fn ssim(a: &[u8], b: &[u8], w: usize, h: usize) -> f64 {
    const C1: f64 = 0.01 * 255.0 * 0.01 * 255.0;
    const C2: f64 = 0.03 * 255.0 * 0.03 * 255.0;
    let (mut sum, mut n) = (0.0, 0);
    for by in (0..h / 8 * 8).step_by(8) {
        for bx in (0..w / 8 * 8).step_by(8) {
            let (mut sa, mut sb, mut saa, mut sbb, mut sab) = (0u32, 0u32, 0u32, 0u32, 0u32);
            for y in by..by + 8 {
                let (ra, rb) = (&a[y * w + bx..][..8], &b[y * w + bx..][..8]);
                for (&x, &y) in ra.iter().zip(rb) {
                    let (x, y) = (x as u32, y as u32);
                    (sa, sb, saa, sbb, sab) = (sa + x, sb + y, saa + x * x, sbb + y * y, sab + x * y);
                }
            }
            let (ma, mb) = (sa as f64 / 64.0, sb as f64 / 64.0);
            let va = saa as f64 / 64.0 - ma * ma;
            let vb = sbb as f64 / 64.0 - mb * mb;
            let cov = sab as f64 / 64.0 - ma * mb;
            sum += (2.0 * ma * mb + C1) * (2.0 * cov + C2) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
            n += 1;
        }
    }
    if n == 0 {
        1.0
    } else {
        sum / n as f64
    }
}
