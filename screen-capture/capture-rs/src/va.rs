// VA-API over cros-libva's raw bindings, with the Display from Discord's fork. The fork's typed wrappers don't fit:
// Context and Config keep their ids crate-private (no raw calls beside them: vaSyncBuffer, vaExportSurfaceHandle into
// our own descriptor), Context is Rc (!Send), and the AV1 parameter buffers are positional constructors of up to 40
// arguments, where a bindgen struct with ..Default::default() reads like the C. So: ids, owned by small RAII types
// that hold the Arc<Display> (Send), and one check() for every status.

use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::sync::Arc;

use anyhow::{bail, Result};
pub use cros_libva as sys;
use sys::{VABufferID, VAConfigID, VAContextID, VASurfaceID};

pub fn check(st: sys::VAStatus, what: &str) -> Result<()> {
    if st == sys::VA_STATUS_SUCCESS as sys::VAStatus {
        return Ok(());
    }
    // SAFETY: vaErrorStr returns a static NUL-terminated string
    let msg = unsafe { std::ffi::CStr::from_ptr(sys::vaErrorStr(st)) };
    bail!("{what}: {} ({st})", msg.to_string_lossy())
}

#[derive(Clone)]
pub struct Va(pub Arc<sys::Display>);

impl Va {
    pub fn open(device: &str) -> Result<Self> {
        Ok(Va(sys::Display::open_drm_display(device)?))
    }

    pub fn dpy(&self) -> sys::VADisplay {
        self.0.handle()
    }

    pub fn vendor(&self) -> String {
        self.0.query_vendor_string().unwrap_or_else(|_| "?".into())
    }

    pub fn entrypoints(&self, profile: sys::VAProfile::Type) -> Vec<sys::VAEntrypoint::Type> {
        self.0.query_config_entrypoints(profile).unwrap_or_default()
    }

    pub fn config_attributes(
        &self,
        profile: sys::VAProfile::Type,
        entrypoint: sys::VAEntrypoint::Type,
        attrs: &mut [sys::VAConfigAttrib],
    ) -> Result<()> {
        // SAFETY: attrs is a valid array of attrs.len() entries
        check(
            unsafe {
                sys::vaGetConfigAttributes(self.dpy(), profile, entrypoint, attrs.as_mut_ptr(), attrs.len() as i32)
            },
            "vaGetConfigAttributes",
        )
    }

    pub fn config(
        &self,
        profile: sys::VAProfile::Type,
        entrypoint: sys::VAEntrypoint::Type,
        attrs: &mut [sys::VAConfigAttrib],
    ) -> Result<Config> {
        let mut id = 0;
        // SAFETY: as above; id is written on success
        check(
            unsafe {
                sys::vaCreateConfig(
                    self.dpy(),
                    profile,
                    entrypoint,
                    attrs.as_mut_ptr(),
                    attrs.len() as i32,
                    &mut id,
                )
            },
            "vaCreateConfig",
        )?;
        Ok(Config { va: self.clone(), id })
    }

    pub fn surfaces(
        &self,
        format: u32,
        w: u32,
        h: u32,
        n: usize,
        attrs: &mut [sys::VASurfaceAttrib],
    ) -> Result<Surfaces> {
        let mut ids = vec![sys::VA_INVALID_SURFACE; n];
        // SAFETY: ids has n entries; the attrs (and what they point to) outlive the call
        check(
            unsafe {
                sys::vaCreateSurfaces(
                    self.dpy(),
                    format,
                    w,
                    h,
                    ids.as_mut_ptr(),
                    n as u32,
                    attrs.as_mut_ptr(),
                    attrs.len() as u32,
                )
            },
            "vaCreateSurfaces",
        )?;
        Ok(Surfaces { va: self.clone(), ids })
    }

    pub fn context(&self, cfg: &Config, w: u32, h: u32, targets: &[VASurfaceID]) -> Result<Context> {
        let mut id = 0;
        // SAFETY: targets is read only for the call (vaCreateContext takes a non-const pointer)
        check(
            unsafe {
                sys::vaCreateContext(
                    self.dpy(),
                    cfg.id,
                    w as i32,
                    h as i32,
                    sys::VA_PROGRESSIVE as i32,
                    targets.as_ptr() as *mut _,
                    targets.len() as i32,
                    &mut id,
                )
            },
            "vaCreateContext",
        )?;
        Ok(Context { va: self.clone(), id })
    }

    pub fn image(&self, mut format: sys::VAImageFormat, w: u32, h: u32) -> Result<Image> {
        let mut img = sys::VAImage::default();
        // SAFETY: img is written on success
        check(
            unsafe { sys::vaCreateImage(self.dpy(), &mut format, w as i32, h as i32, &mut img) },
            "vaCreateImage",
        )?;
        Ok(Image { va: self.clone(), img })
    }
}

impl Va {
    /// the surface exported as DMA-BUF (read only, separate layers): its objects' fds, for poll()ing the work writing it
    pub fn export_fds(&self, surf: VASurfaceID) -> Result<Vec<OwnedFd>> {
        let mut d = sys::VADRMPRIMESurfaceDescriptor::default();
        // SAFETY: d is written on success; the fds it holds are ours to close
        check(
            unsafe {
                sys::vaExportSurfaceHandle(
                    self.dpy(),
                    surf,
                    sys::VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
                    sys::VA_EXPORT_SURFACE_READ_ONLY | sys::VA_EXPORT_SURFACE_SEPARATE_LAYERS,
                    &mut d as *mut _ as *mut _,
                )
            },
            "vaExportSurfaceHandle",
        )?;
        Ok(d.objects[..d.num_objects as usize]
            .iter()
            .map(|o| unsafe { OwnedFd::from_raw_fd(o.fd) })
            .collect())
    }
}

/// wait up to timeout_ms for the fences in a DMA-BUF's reservation (POLLOUT: all of them, the VPP's write among them)
pub fn fence_wait(fd: &OwnedFd, timeout_ms: i32) {
    let mut p = libc::pollfd {
        fd: fd.as_raw_fd(),
        events: libc::POLLOUT,
        revents: 0,
    };
    // SAFETY: one valid pollfd
    unsafe { libc::poll(&mut p, 1, timeout_ms) };
}

pub struct Config {
    va: Va,
    pub id: VAConfigID,
}

impl Drop for Config {
    fn drop(&mut self) {
        // SAFETY: id was created on this display
        unsafe { sys::vaDestroyConfig(self.va.dpy(), self.id) };
    }
}

pub struct Surfaces {
    va: Va,
    pub ids: Vec<VASurfaceID>,
}

impl Drop for Surfaces {
    fn drop(&mut self) {
        // SAFETY: the ids were created on this display
        unsafe { sys::vaDestroySurfaces(self.va.dpy(), self.ids.as_mut_ptr(), self.ids.len() as i32) };
    }
}

pub struct Context {
    va: Va,
    pub id: VAContextID,
}

impl Context {
    /// a buffer holding one T (a parameter struct) or `bytes`
    pub fn buffer<T>(&self, kind: sys::VABufferType::Type, data: &T) -> Result<Buffer> {
        self.buffer_raw(kind, std::mem::size_of::<T>(), data as *const T as *mut _)
    }

    pub fn buffer_bytes(&self, kind: sys::VABufferType::Type, bytes: &[u8]) -> Result<Buffer> {
        self.buffer_raw(kind, bytes.len(), bytes.as_ptr() as *mut _)
    }

    /// a buffer of `size` bytes left for the driver (the coded buffer)
    pub fn buffer_empty(&self, kind: sys::VABufferType::Type, size: usize) -> Result<Buffer> {
        self.buffer_raw(kind, size, std::ptr::null_mut())
    }

    fn buffer_raw(&self, kind: sys::VABufferType::Type, size: usize, data: *mut std::ffi::c_void) -> Result<Buffer> {
        let mut id = 0;
        // SAFETY: data is null or points at size readable bytes, copied by the driver
        check(
            unsafe { sys::vaCreateBuffer(self.va.dpy(), self.id, kind, size as u32, 1, data, &mut id) },
            "vaCreateBuffer",
        )?;
        Ok(Buffer {
            va: self.va.clone(),
            id,
        })
    }

    /// one picture onto `target` from `bufs`, not waited for
    pub fn render(&self, target: VASurfaceID, bufs: &[Buffer]) -> Result<()> {
        let dpy = self.va.dpy();
        let mut ids: Vec<VABufferID> = bufs.iter().map(|b| b.id).collect();
        // SAFETY: the context, target and buffers live on this display; ids is valid for the call
        unsafe {
            check(sys::vaBeginPicture(dpy, self.id, target), "vaBeginPicture")?;
            let rendered = check(
                sys::vaRenderPicture(dpy, self.id, ids.as_mut_ptr(), ids.len() as i32),
                "vaRenderPicture",
            );
            let ended = check(sys::vaEndPicture(dpy, self.id), "vaEndPicture");
            rendered.and(ended)
        }
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        // SAFETY: id was created on this display
        unsafe { sys::vaDestroyContext(self.va.dpy(), self.id) };
    }
}

pub struct Buffer {
    va: Va,
    pub id: VABufferID,
}

impl Buffer {
    /// wait for the work writing this buffer: in Mesa vaSyncBuffer holds only the context's lock (vaSyncSurface would
    /// hold the driver's)
    pub fn sync(&self) -> Result<()> {
        // SAFETY: id lives on this display
        check(
            unsafe { sys::vaSyncBuffer(self.va.dpy(), self.id, u64::MAX) },
            "vaSyncBuffer",
        )
    }

    /// the coded buffer's segments, appended to `out`; returns the reported average QP (0: none)
    pub fn read_coded(&self, out: &mut Vec<u8>) -> Result<u32> {
        let dpy = self.va.dpy();
        let mut seg: *mut sys::VACodedBufferSegment = std::ptr::null_mut();
        let mut qp = 0;
        // SAFETY: a mapped coded buffer is a list of segments, valid until vaUnmapBuffer
        unsafe {
            check(
                sys::vaMapBuffer(dpy, self.id, &mut seg as *mut _ as *mut _),
                "vaMapBuffer",
            )?;
            while let Some(s) = seg.as_ref() {
                out.extend_from_slice(std::slice::from_raw_parts(s.buf as *const u8, s.size as usize));
                if s.status & sys::VA_CODED_BUF_STATUS_PICTURE_AVE_QP_MASK != 0 {
                    qp = s.status & sys::VA_CODED_BUF_STATUS_PICTURE_AVE_QP_MASK;
                }
                seg = s.next as *mut _;
            }
            sys::vaUnmapBuffer(dpy, self.id);
        }
        Ok(qp)
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        // SAFETY: id was created on this display
        unsafe { sys::vaDestroyBuffer(self.va.dpy(), self.id) };
    }
}

pub struct Image {
    va: Va,
    pub img: sys::VAImage,
}

impl Image {
    /// the image's planes mapped for writing; `f` gets the bytes, offsets and pitches
    pub fn write(&self, f: impl FnOnce(&mut [u8], &[u32; 3], &[u32; 3])) -> Result<()> {
        let dpy = self.va.dpy();
        let mut p: *mut u8 = std::ptr::null_mut();
        // SAFETY: the mapped buffer is data_size bytes until vaUnmapBuffer
        unsafe {
            check(
                sys::vaMapBuffer(dpy, self.img.buf, &mut p as *mut _ as *mut _),
                "vaMapBuffer",
            )?;
            f(
                std::slice::from_raw_parts_mut(p, self.img.data_size as usize),
                &self.img.offsets,
                &self.img.pitches,
            );
            sys::vaUnmapBuffer(dpy, self.img.buf);
        }
        Ok(())
    }

    /// the image into the whole of `surf` (same size)
    pub fn put(&self, surf: VASurfaceID) -> Result<()> {
        let (w, h) = (self.img.width as u32, self.img.height as u32);
        // SAFETY: the surface and image live on this display
        check(
            unsafe { sys::vaPutImage(self.va.dpy(), surf, self.img.image_id, 0, 0, w, h, 0, 0, w, h) },
            "vaPutImage",
        )
    }
}

impl Drop for Image {
    fn drop(&mut self) {
        // SAFETY: the image was created on this display
        unsafe { sys::vaDestroyImage(self.va.dpy(), self.img.image_id) };
    }
}

/// The VPP's colour: NV12 BT.601 limited range (what libyuv gives Chromium's encoders and what av1enc's sequence
/// header says) or RGB full range (a cast, the preview).
fn color(yuv: bool) -> sys::VAProcColorProperties {
    sys::VAProcColorProperties {
        colour_primaries: 1,
        transfer_characteristics: 13,
        matrix_coefficients: if yuv { 6 } else { 0 },
        color_range: if yuv {
            sys::VA_SOURCE_RANGE_REDUCED
        } else {
            sys::VA_SOURCE_RANGE_FULL
        } as u8,
        ..Default::default()
    }
}

/// One VPP pass of `input` onto the whole of `out` (w x h) on `ctx`, not waited for.
pub fn vpp_submit(
    ctx: &Context,
    w: u32,
    h: u32,
    input: VASurfaceID,
    out: VASurfaceID,
    yuv_in: bool,
    yuv_out: bool,
) -> Result<()> {
    let dst = sys::VARectangle {
        x: 0,
        y: 0,
        width: w as u16,
        height: h as u16,
    };
    let mut p = sys::VAProcPipelineParameterBuffer {
        surface: input,
        output_region: &dst,
        output_background_color: 0xff000000,
        surface_color_standard: sys::_VAProcColorStandardType_VAProcColorStandardNone,
        output_color_standard: sys::_VAProcColorStandardType_VAProcColorStandardNone,
        filter_flags: sys::VA_FILTER_SCALING_DEFAULT,
        ..Default::default()
    };
    if yuv_in || yuv_out {
        p.surface_color_standard = sys::_VAProcColorStandardType_VAProcColorStandardExplicit;
        p.output_color_standard = sys::_VAProcColorStandardType_VAProcColorStandardExplicit;
        p.input_color_properties = color(yuv_in);
        p.output_color_properties = color(yuv_out);
    }
    let b = ctx.buffer(sys::VABufferType::VAProcPipelineParameterBufferType, &p)?;
    ctx.render(out, &[b])
}
