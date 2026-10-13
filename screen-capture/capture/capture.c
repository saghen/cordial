// capture: mincord's Go Live encoder. It creates a niri screen cast of a window or an output itself (the Mutter
// ScreenCast D-Bus API niri implements), takes the cast as DMA-BUF, VPP-scales it to NV12 in VRAM and encodes AV1 on
// the same GPU through VA-API: only the bitstream (~20 kB a frame) leaves VRAM. A small BGRx preview (1 fps) is read
// back for Discord's own preview and thumbnail. mincord's main process starts it and talks to it over stdin
// (commands, at command()) and stdout (frames, preview, info, stats, at send_msg()). History and measurements: Equibop's
// native/castscale/README.md (branch screenshare; its socket protocol is gone, the rest applies).
//
//   capture (--window ID | --output NAME | --node ID) [--size WxH] [--fps 60] [--cursor embedded|hidden] ...
//   capture --clip F.i420 --clip-size WxH [--encode-out F.ivf] ...   test input instead of a cast (lab)
//
// Threads: the PipeWire loop thread dequeues niri's newest buffer, submits the VPP into a free slot of the encode
// ring (and into the preview surface when one is due) and requeues the buffer at once; it never waits for the GPU.
// It also reads the commands from stdin. The main thread is the worker: it encodes submitted slots (waiting for the
// VPP with poll() on the slot's DMA-BUF), reads the preview back, writes to stdout and runs D-Bus.
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <getopt.h>
#include <inttypes.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/uio.h>
#include <time.h>
#include <unistd.h>

#include <drm_fourcc.h>
#include <gbm.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>

#include <systemd/sd-bus.h>

#include <va/va.h>
#include <va/va_drm.h>
#include <va/va_drmcommon.h>
#include <va/va_vpp.h>

#include "av1enc.h"

#include <pipewire/pipewire.h>
#include <spa/param/video/format-utils.h>
#include <spa/param/video/type-info.h>
#include <spa/debug/types.h>
#include <spa/utils/result.h>

#define MAX_MODS 128
#define MAX_BUFS 32
#define RING 3
#define MSG_MAGIC 0x315a5343u // "CSZ1"
enum { MSG_FRAME = 2, MSG_INFO = 3, MSG_PREVIEW = 4 };
#define MUTTER "org.gnome.Mutter.ScreenCast"
#define MUTTER_PATH "/org/gnome/Mutter/ScreenCast"

struct inbuf {
	struct pw_buffer *pwb;
	VASurfaceID surf; // niri's buffer, imported
	bool failed;
};

// an encode ring slot: the VPP's NV12 target, exported as DMA-BUF (fds[0] is polled for the VPP's fence). state,
// t_submit and seq are guarded by the loop lock.
enum { SLOT_FREE, SLOT_SUBMITTED, SLOT_BUSY };
struct slot {
	VASurfaceID surf;
	int fds[4], n_fds;
	int state;
	double t_submit;
	uint64_t seq;
};

static struct {
	// options
	int source; // 'w' window, 'o' output, 'n' node, 'c' clip
	uint64_t window_id;
	const char *output;
	uint32_t node;
	unsigned cursor;            // Mutter's cursor-mode: 0 hidden, 1 embedded
	uint32_t max_w, max_h, fps; // --size: the box the source is fitted into
	uint32_t prev_box_w, prev_box_h;
	double prev_interval;       // 1 / --preview-fps
	const char *device;
	double seconds;
	uint32_t kbps;       // --kbps: target until told otherwise
	unsigned refs;       // --av1-refs 1|2
	unsigned min_qindex; // --av1-min-q
	double drop_ms;      // --drop-ms: frame dropper threshold (0: off)
	double repeat_ms;    // --repeat-ms: re-encode the last frame when the cast has been idle this long
	const char *clip;    // --clip: raw I420 played in real time instead of a cast
	uint32_t clip_w, clip_h;
	FILE *ivf;           // --encode-out
	unsigned long ivf_frames;

	// D-Bus (worker thread only)
	sd_bus *bus;
	char session[256];
	bool cast_closed;

	// PipeWire
	struct pw_thread_loop *tl;
	struct pw_context *ctx;
	struct pw_core *core;
	struct spa_hook core_listener;
	struct pw_stream *in;
	struct spa_hook in_listener;
	struct spa_video_info_raw in_fmt;
	struct spa_source *stdin_src;
	char rbuf[512];
	size_t rlen;
	volatile sig_atomic_t quit;
	char quit_reason[64];
	uint64_t mods[MAX_MODS]; // what the GPU can import (EGL): offered to niri
	int n_mods;

	// VA-API: the loop thread imports and runs the VPP, the worker encodes and reads the preview back
	int drm_fd;
	VADisplay va;
	VAConfigID va_cfg;
	struct inbuf bufs[MAX_BUFS];
	VASurfaceID last_surf; // niri's buffer processed last (loop lock): what a static cast is encoded from
	bool supported; // the device can encode AV1

	// encoder. Control: loop lock. The ring and the encoder belong to the worker, which (re)creates them with the loop
	// lock held.
	bool active;              // encoding ("start", --start)
	uint32_t req_kbps, req_h; // target and maximum height (0: --size's)
	bool want_key, failed;
	uint32_t want_w, want_h;  // the encode size for the current input and request (0: unknown yet)
	uint32_t full_w, full_h;  // ... with no height asked for: the stream's full size
	struct av1enc *enc;
	struct slot slots[RING];
	VAContextID ring_ctx;
	uint32_t ring_w, ring_h;
	int last_slot;           // the slot encoded last (an idle cast re-encodes it), -1: none
	double last_enc_t, debt; // frame dropper: bits sent over the target
	uint64_t seq;

	// preview: one BGRx surface, its VPP context, read through a derived image (or vaGetImage into prev_img)
	VASurfaceID prev_surf;
	VAContextID prev_ctx;
	VAImage prev_img;
	bool prev_derived;
	uint32_t prev_w, prev_h, prev_want_w, prev_want_h;
	int prev_state;
	double prev_next;

	// pacing (loop thread): token bucket, one token per 1/fps
	double last_in, credit;

	// stdout: frames and previews from the worker, info from both threads
	pthread_mutex_t out_mtx;

	// stats (per second; loop lock)
	double t_start, t_tick;
	unsigned long total_in, total_sub, total_enc;
	unsigned n_in, n_skip, n_nofree, n_empty, n_enc, n_key, n_repeat, n_dropper, n_outdrop, n_prev;
	double ms_enc, max_enc, ms_lat, max_lat, ms_enc_total;
	uint64_t bytes;
	struct rusage ru_tick;
} S = {
	.fps = 60, .cursor = 1, .prev_box_w = 640, .prev_box_h = 360, .prev_interval = 1.0, .device = "auto",
	.kbps = 6000, .refs = 2, .min_qindex = 10, .drop_ms = 300, .repeat_ms = 1000, .drm_fd = -1, .credit = 1.0,
	.va_cfg = VA_INVALID_ID, .ring_ctx = VA_INVALID_ID, .last_surf = VA_INVALID_SURFACE, .last_slot = -1, .prev_surf = VA_INVALID_SURFACE,
	.prev_ctx = VA_INVALID_ID, .prev_img.image_id = VA_INVALID_ID, .out_mtx = PTHREAD_MUTEX_INITIALIZER,
};

static double now(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec + ts.tv_nsec / 1e9;
}

static double ru_sec(const struct rusage *r)
{
	return r->ru_utime.tv_sec + r->ru_utime.tv_usec / 1e6 + r->ru_stime.tv_sec + r->ru_stime.tv_usec / 1e6;
}

static void request_quit(const char *why)
{
	if (!S.quit && why)
		snprintf(S.quit_reason, sizeof(S.quit_reason), "%s", why);
	S.quit = 1;
	if (S.tl)
		pw_thread_loop_signal(S.tl, false);
}

// stderr is /dev/null (as mincord starts us): the log goes to $XDG_RUNTIME_DIR/mincord-capture/<pid>.log (logs older
// than a day are removed)
static void stderr_to_log(void)
{
	struct stat st, null;
	const char *rt = getenv("XDG_RUNTIME_DIR");
	char dir[300], path[600];
	if (!rt || fstat(2, &st) < 0 || stat("/dev/null", &null) < 0 || !S_ISCHR(st.st_mode) || st.st_rdev != null.st_rdev)
		return;
	snprintf(dir, sizeof(dir), "%s/mincord-capture", rt);
	mkdir(dir, 0700);
	DIR *d = opendir(dir);
	struct dirent *e;
	while (d && (e = readdir(d))) {
		snprintf(path, sizeof(path), "%s/%s", dir, e->d_name);
		if (strstr(e->d_name, ".log") && stat(path, &st) == 0 && st.st_mtime < time(NULL) - 86400)
			unlink(path);
	}
	if (d)
		closedir(d);
	snprintf(path, sizeof(path), "%s/%d.log", dir, getpid());
	int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
	if (fd >= 0) {
		dup2(fd, 2);
		close(fd);
		setvbuf(stderr, NULL, _IOLBF, 0);
	}
}

// ---------------------------------------------------------------- stdout
//
// A message: a 24-byte header (u32 LE: magic "CSZ1", type, payload size, seq, then u64 µs of CLOCK_MONOTONIC) +
// payload. frame: u32 flags (1: key), u32 w | h << 16, u32 qindex (0: none), u32 submit -> encoded µs, then the
// temporal unit (OBUs, no temporal delimiter); its time is the frame's VPP submit. preview: u32 w | h << 16, then
// w x h BGRx, rows packed. info: JSON.

// one message to stdout (non-blocking). 1: sent, 0: dropped (droppable and the pipe was full before a byte went
// out), -1: broken (error, or stuck > 2 s mid-message)
static int send_msg(uint32_t type, uint32_t seq, double t, const void *a, size_t alen, const void *b, size_t blen,
		    bool droppable)
{
	uint64_t us = (uint64_t)(t * 1e6);
	uint32_t hdr[6] = {MSG_MAGIC, type, (uint32_t)(alen + blen), seq, (uint32_t)us, (uint32_t)(us >> 32)};
	struct iovec iov[3] = {{hdr, sizeof(hdr)}, {(void *)a, alen}, {(void *)b, blen}};
	size_t total = sizeof(hdr) + alen + blen, sent = 0;
	double deadline = now() + 2.0;
	int ret = 1;
	pthread_mutex_lock(&S.out_mtx);
	while (sent < total) {
		struct iovec v[3];
		int n = 0;
		size_t skip = sent;
		for (int i = 0; i < 3; i++) {
			if (skip >= iov[i].iov_len) {
				skip -= iov[i].iov_len;
				continue;
			}
			v[n].iov_base = (uint8_t *)iov[i].iov_base + skip;
			v[n++].iov_len = iov[i].iov_len - skip;
			skip = 0;
		}
		ssize_t w = writev(1, v, n);
		if (w > 0) {
			sent += w;
			continue;
		}
		if (w < 0 && errno == EINTR)
			continue;
		if (w < 0 && errno != EAGAIN) {
			ret = -1;
			break;
		}
		if (!sent && droppable) {
			ret = 0;
			break;
		}
		struct pollfd pfd = {.fd = 1, .events = POLLOUT};
		int ms = (int)((deadline - now()) * 1e3);
		if (ms <= 0 || poll(&pfd, 1, ms) <= 0) {
			ret = -1;
			break;
		}
	}
	pthread_mutex_unlock(&S.out_mtx);
	if (ret < 0)
		request_quit("stdout broken");
	return ret;
}

static void info(const char *fmt, ...)
{
	char json[512];
	va_list ap;
	va_start(ap, fmt);
	vsnprintf(json, sizeof(json), fmt, ap);
	va_end(ap);
	fprintf(stderr, "info: %s\n", json);
	send_msg(MSG_INFO, 0, now(), json, strlen(json), NULL, 0, false);
}

// Startup trace: a stage reached, as an info message (the header's time is when) and into the log. mincord's main
// process puts them into the stream's startup trace (src/main/startupTrace.ts).
static double t_main;
static void stage(const char *name)
{
	fprintf(stderr, "stage: %s at %.1f ms\n", name, (now() - t_main) * 1e3);
	info("{\"type\":\"stage\",\"name\":\"%s\"}", name);
}
#define STAGE_ONCE(name)                  \
	do {                              \
		static bool _done;        \
		if (!_done) {             \
			_done = true;     \
			stage(name);      \
		}                         \
	} while (0)

// ---------------------------------------------------------------- the cast (D-Bus, main thread)

static int on_stream_added(sd_bus_message *m, void *data, sd_bus_error *err)
{
	if (sd_bus_message_read(m, "u", &S.node) < 0)
		S.node = 0;
	return 0;
}

static int on_session_closed(sd_bus_message *m, void *data, sd_bus_error *err)
{
	S.cast_closed = true;
	return 0;
}

#define BUS_CHECK(expr, what)                                                                              \
	do {                                                                                               \
		int _r = (expr);                                                                           \
		if (_r < 0) {                                                                              \
			fprintf(stderr, "dbus: %s: %s\n", what, err.message ? err.message : strerror(-_r)); \
			goto fail;                                                                         \
		}                                                                                          \
	} while (0)

// a niri cast of the window / output: CreateSession, RecordWindow / RecordMonitor, Start, then the stream's node
static int cast_start(void)
{
	sd_bus_error err = SD_BUS_ERROR_NULL;
	sd_bus_message *reply = NULL;
	const char *path;
	char stream[256];
	BUS_CHECK(sd_bus_open_user(&S.bus), "connect");
	stage("bus");
	BUS_CHECK(sd_bus_call_method(S.bus, MUTTER, MUTTER_PATH, MUTTER, "CreateSession", &err, &reply, "a{sv}", 0),
		  "CreateSession");
	BUS_CHECK(sd_bus_message_read(reply, "o", &path), "CreateSession reply");
	snprintf(S.session, sizeof(S.session), "%s", path);
	reply = sd_bus_message_unref(reply);
	stage("session");
	BUS_CHECK(sd_bus_match_signal(S.bus, NULL, NULL, S.session, MUTTER ".Session", "Closed", on_session_closed, NULL),
		  "match Closed");
	if (S.source == 'w')
		BUS_CHECK(sd_bus_call_method(S.bus, MUTTER, S.session, MUTTER ".Session", "RecordWindow", &err, &reply, "a{sv}", 2,
					     "window-id", "t", S.window_id, "cursor-mode", "u", S.cursor),
			  "RecordWindow");
	else
		BUS_CHECK(sd_bus_call_method(S.bus, MUTTER, S.session, MUTTER ".Session", "RecordMonitor", &err, &reply, "sa{sv}",
					     S.output, 1, "cursor-mode", "u", S.cursor),
			  "RecordMonitor");
	BUS_CHECK(sd_bus_message_read(reply, "o", &path), "Record reply");
	stage("record");
	snprintf(stream, sizeof(stream), "%s", path);
	reply = sd_bus_message_unref(reply);
	BUS_CHECK(sd_bus_match_signal(S.bus, NULL, NULL, stream, MUTTER ".Stream", "PipeWireStreamAdded", on_stream_added, NULL),
		  "match PipeWireStreamAdded");
	BUS_CHECK(sd_bus_call_method(S.bus, MUTTER, S.session, MUTTER ".Session", "Start", &err, NULL, ""), "Start");
	stage("cast-started");
	for (double deadline = now() + 10; !S.node && !S.cast_closed && !S.quit && now() < deadline;)
		if (sd_bus_process(S.bus, NULL) == 0)
			sd_bus_wait(S.bus, 100000);
	if (!S.node) {
		fprintf(stderr, "dbus: no PipeWire stream from the cast\n");
		goto fail;
	}
	fprintf(stderr, "cast: session %s, node %u\n", S.session, S.node);
	stage("node");
	return 0;
fail:
	sd_bus_error_free(&err);
	sd_bus_message_unref(reply);
	return -1;
}

// niri keeps a cast alive after its D-Bus client is gone: stop it (mincord also stops a cast of ours left behind
// through niri's IPC, should we be killed)
static void cast_stop(void)
{
	if (!S.bus)
		return;
	if (S.session[0] && !S.cast_closed) {
		sd_bus_error err = SD_BUS_ERROR_NULL;
		if (sd_bus_call_method(S.bus, MUTTER, S.session, MUTTER ".Session", "Stop", &err, NULL, "") < 0)
			fprintf(stderr, "dbus: Stop: %s\n", err.message ? err.message : "failed");
		sd_bus_error_free(&err);
	}
	sd_bus_flush_close_unref(S.bus);
	S.bus = NULL;
}

// ---------------------------------------------------------------- VA-API

// the modifiers EGL can import XRGB8888 with on the device
static int query_modifiers(void)
{
	int fd = open(S.device, O_RDWR | O_CLOEXEC);
	struct gbm_device *gbm = fd >= 0 ? gbm_create_device(fd) : NULL;
	PFNEGLGETPLATFORMDISPLAYEXTPROC get_dpy = (void *)eglGetProcAddress("eglGetPlatformDisplayEXT");
	PFNEGLQUERYDMABUFMODIFIERSEXTPROC query = (void *)eglGetProcAddress("eglQueryDmaBufModifiersEXT");
	EGLDisplay dpy = gbm && get_dpy ? get_dpy(EGL_PLATFORM_GBM_KHR, gbm, NULL) : EGL_NO_DISPLAY;
	EGLint maj, min, n = 0;
	EGLuint64KHR mods[MAX_MODS];
	if (dpy == EGL_NO_DISPLAY || !query || !eglInitialize(dpy, &maj, &min) ||
	    !query(dpy, DRM_FORMAT_XRGB8888, MAX_MODS, mods, NULL, &n)) {
		fprintf(stderr, "egl: no modifier list on %s: 0x%x\n", S.device, eglGetError());
		return -1;
	}
	fprintf(stderr, "egl: %s, %d modifiers for XRGB8888\n", eglQueryString(dpy, EGL_VENDOR), n);
	for (int i = 0; i < n; i++)
		S.mods[i] = mods[i];
	S.n_mods = n;
	eglTerminate(dpy);
	gbm_device_destroy(gbm);
	close(fd);
	return n > 0 ? 0 : -1;
}

#define VA_CHECK(expr)                                                                                     \
	({                                                                                                 \
		VAStatus _st = (expr);                                                                     \
		if (_st != VA_STATUS_SUCCESS)                                                              \
			fprintf(stderr, "%s: %s (%d)\n", #expr, vaErrorStr(_st), _st);                     \
		_st;                                                                                       \
	})

static int va_init(void)
{
	for (int i = 0; i < RING; i++)
		S.slots[i] = (struct slot){.surf = VA_INVALID_SURFACE};
	S.drm_fd = open(S.device, O_RDWR | O_CLOEXEC);
	if (S.drm_fd < 0) {
		fprintf(stderr, "open %s: %m\n", S.device);
		return -1;
	}
	S.va = vaGetDisplayDRM(S.drm_fd);
	int maj, min;
	if (!S.va || VA_CHECK(vaInitialize(S.va, &maj, &min)) ||
	    VA_CHECK(vaCreateConfig(S.va, VAProfileNone, VAEntrypointVideoProc, NULL, 0, &S.va_cfg)))
		return -1;
	S.supported = av1enc_supported(S.va);
	fprintf(stderr, "va: %s: %s, AV1 encode: %s\n", S.device, vaQueryVendorString(S.va), S.supported ? "yes" : "no");
	return 0;
}

static VASurfaceID import_buffer(struct pw_buffer *b)
{
	struct spa_buffer *sb = b->buffer;
	VADRMPRIMESurfaceDescriptor d = {
		.fourcc = VA_FOURCC_BGRX,
		.width = S.in_fmt.size.width,
		.height = S.in_fmt.size.height,
		.num_layers = 1,
		.layers[0] = {.drm_format = DRM_FORMAT_XRGB8888, .num_planes = sb->n_datas},
	};
	if (sb->n_datas > 4)
		return VA_INVALID_SURFACE;
	for (uint32_t i = 0; i < sb->n_datas; i++) {
		struct spa_data *sd = &sb->datas[i];
		int obj = -1;
		for (uint32_t o = 0; o < d.num_objects; o++)
			if ((int)d.objects[o].fd == sd->fd)
				obj = o;
		if (obj < 0) {
			obj = d.num_objects++;
			off_t sz = lseek(sd->fd, 0, SEEK_END);
			d.objects[obj].fd = sd->fd;
			d.objects[obj].size = sz > 0 ? (uint32_t)sz : 0;
			d.objects[obj].drm_format_modifier = S.in_fmt.modifier;
		}
		d.layers[0].object_index[i] = obj;
		d.layers[0].offset[i] = sd->chunk->offset;
		d.layers[0].pitch[i] = sd->chunk->stride;
	}
	VASurfaceAttrib attrs[2] = {
		{.type = VASurfaceAttribMemoryType, .flags = VA_SURFACE_ATTRIB_SETTABLE,
		 .value = {.type = VAGenericValueTypeInteger, .value.i = VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2}},
		{.type = VASurfaceAttribExternalBufferDescriptor, .flags = VA_SURFACE_ATTRIB_SETTABLE,
		 .value = {.type = VAGenericValueTypePointer, .value.p = &d}},
	};
	VASurfaceID s = VA_INVALID_SURFACE;
	VAStatus st = vaCreateSurfaces(S.va, VA_RT_FORMAT_RGB32, d.width, d.height, &s, 1, attrs, 2);
	if (st != VA_STATUS_SUCCESS)
		fprintf(stderr, "va import failed: %s (%d); %ux%u modifier 0x%" PRIx64 " planes %u objects %u\n", vaErrorStr(st),
			st, d.width, d.height, d.objects[0].drm_format_modifier, d.layers[0].num_planes, d.num_objects);
	return st == VA_STATUS_SUCCESS ? s : VA_INVALID_SURFACE;
}

static struct inbuf *inbuf_for(struct pw_buffer *b)
{
	for (int i = 0; i < MAX_BUFS; i++)
		if (S.bufs[i].pwb == b)
			return &S.bufs[i];
	return NULL;
}

static void drop_surfaces(void)
{
	S.last_surf = VA_INVALID_SURFACE;
	for (int i = 0; i < MAX_BUFS; i++) {
		if (S.bufs[i].pwb && S.bufs[i].surf != VA_INVALID_SURFACE)
			vaDestroySurfaces(S.va, &S.bufs[i].surf, 1);
		S.bufs[i].surf = VA_INVALID_SURFACE;
		S.bufs[i].failed = false;
	}
}

// One VPP pass of `in` onto the whole of `out` (w x h) on context ctx, not waited for. In: RGB (a cast) or NV12
// BT.601 limited (--clip). Out: NV12 BT.601 limited range (what libyuv gives Chromium's encoders and what av1enc's
// sequence header says), or RGB full range (the preview).
static int vpp_submit(VAContextID ctx, uint32_t w, uint32_t h, VASurfaceID in, VASurfaceID out, bool yuv_in, bool yuv_out)
{
	VARectangle dst = {0, 0, (uint16_t)w, (uint16_t)h};
	VAProcPipelineParameterBuffer p = {
		.surface = in,
		.output_region = &dst,
		.output_background_color = 0xff000000,
		.surface_color_standard = VAProcColorStandardNone,
		.output_color_standard = VAProcColorStandardNone,
		.filter_flags = VA_FILTER_SCALING_DEFAULT,
	};
	if (yuv_in || yuv_out) {
		p.surface_color_standard = p.output_color_standard = VAProcColorStandardExplicit;
		p.input_color_properties = (VAProcColorProperties){
			.colour_primaries = 1, .transfer_characteristics = 13, .matrix_coefficients = yuv_in ? 6 : 0,
			.color_range = yuv_in ? VA_SOURCE_RANGE_REDUCED : VA_SOURCE_RANGE_FULL};
		p.output_color_properties = (VAProcColorProperties){
			.colour_primaries = 1, .transfer_characteristics = 13, .matrix_coefficients = yuv_out ? 6 : 0,
			.color_range = yuv_out ? VA_SOURCE_RANGE_REDUCED : VA_SOURCE_RANGE_FULL};
	}
	VABufferID pb;
	if (VA_CHECK(vaCreateBuffer(S.va, ctx, VAProcPipelineParameterBufferType, sizeof(p), 1, &p, &pb)))
		return -1;
	int ret = -1;
	if (!VA_CHECK(vaBeginPicture(S.va, ctx, out))) {
		bool ok = !VA_CHECK(vaRenderPicture(S.va, ctx, &pb, 1));
		ret = !VA_CHECK(vaEndPicture(S.va, ctx)) && ok ? 0 : -1;
	}
	vaDestroyBuffer(S.va, pb);
	return ret;
}

// wait up to timeout_ms for the fences in slot s's DMA-BUF reservation (the VPP's write; POLLOUT: all fences)
static void slot_wait(struct slot *s, int timeout_ms)
{
	struct pollfd pfd = {.fd = s->fds[0], .events = POLLOUT};
	poll(&pfd, 1, timeout_ms);
}

// worker with the loop lock held (or after the loop stopped), no slot BUSY: the encode ring and the encoder off
static void ring_destroy(void)
{
	for (int i = 0; i < RING; i++) {
		struct slot *s = &S.slots[i];
		if (s->state == SLOT_SUBMITTED && s->n_fds)
			slot_wait(s, 1000);
		if (s->surf != VA_INVALID_SURFACE)
			vaDestroySurfaces(S.va, &s->surf, 1);
		for (int o = 0; o < s->n_fds; o++)
			close(s->fds[o]);
		*s = (struct slot){.surf = VA_INVALID_SURFACE};
	}
	if (S.ring_ctx != VA_INVALID_ID)
		vaDestroyContext(S.va, S.ring_ctx);
	S.ring_ctx = VA_INVALID_ID;
	S.ring_w = S.ring_h = 0;
	S.last_slot = -1;
	av1enc_close(S.enc);
	S.enc = NULL;
}

// RING NV12 surfaces (VPP target, encoder input), each exported once so the worker can poll() the VPP's fence, a VPP
// context on them and the encoder, at want_w x want_h
static int ring_create(void)
{
	uint32_t w = S.want_w, h = S.want_h;
	VASurfaceAttrib attr = {.type = VASurfaceAttribUsageHint, .flags = VA_SURFACE_ATTRIB_SETTABLE,
				.value = {.type = VAGenericValueTypeInteger,
					  .value.i = VA_SURFACE_ATTRIB_USAGE_HINT_VPP_WRITE | VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER |
						     VA_SURFACE_ATTRIB_USAGE_HINT_EXPORT}};
	VASurfaceID surfs[RING];
	if (VA_CHECK(vaCreateSurfaces(S.va, VA_RT_FORMAT_YUV420, w, h, surfs, RING, &attr, 1)))
		return -1;
	for (int i = 0; i < RING; i++) {
		struct slot *s = &S.slots[i];
		s->surf = surfs[i];
		VADRMPRIMESurfaceDescriptor d = {0};
		if (VA_CHECK(vaExportSurfaceHandle(S.va, s->surf, VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
						   VA_EXPORT_SURFACE_READ_ONLY | VA_EXPORT_SURFACE_SEPARATE_LAYERS, &d)))
			return -1;
		s->n_fds = d.num_objects;
		for (uint32_t o = 0; o < d.num_objects; o++)
			s->fds[o] = d.objects[o].fd;
	}
	if (VA_CHECK(vaCreateContext(S.va, S.va_cfg, w, h, VA_PROGRESSIVE, surfs, RING, &S.ring_ctx)))
		return -1;
	S.ring_w = w;
	S.ring_h = h;
	struct av1enc_cfg cfg = {.width = w, .height = h, .fps = S.fps, .kbps = S.req_kbps ? S.req_kbps : S.kbps,
				 .min_qindex = S.min_qindex, .refs = S.refs};
	return (S.enc = av1enc_open(S.va, &cfg)) ? 0 : -1;
}

static void preview_destroy(void)
{
	if (S.prev_img.image_id != VA_INVALID_ID)
		vaDestroyImage(S.va, S.prev_img.image_id);
	if (S.prev_ctx != VA_INVALID_ID)
		vaDestroyContext(S.va, S.prev_ctx);
	if (S.prev_surf != VA_INVALID_SURFACE)
		vaDestroySurfaces(S.va, &S.prev_surf, 1);
	S.prev_img.image_id = VA_INVALID_ID;
	S.prev_ctx = VA_INVALID_ID;
	S.prev_surf = VA_INVALID_SURFACE;
	S.prev_w = S.prev_h = 0;
}

// the preview surface (BGRx), read back through a derived image (the map blits it to a staging buffer and waits),
// or through vaGetImage where the driver can't derive
static int preview_create(void)
{
	uint32_t w = S.prev_want_w, h = S.prev_want_h;
	VASurfaceAttrib attr[2] = {
		{.type = VASurfaceAttribPixelFormat, .flags = VA_SURFACE_ATTRIB_SETTABLE,
		 .value = {.type = VAGenericValueTypeInteger, .value.i = VA_FOURCC_BGRX}},
		{.type = VASurfaceAttribUsageHint, .flags = VA_SURFACE_ATTRIB_SETTABLE,
		 .value = {.type = VAGenericValueTypeInteger, .value.i = VA_SURFACE_ATTRIB_USAGE_HINT_VPP_WRITE}},
	};
	if (VA_CHECK(vaCreateSurfaces(S.va, VA_RT_FORMAT_RGB32, w, h, &S.prev_surf, 1, attr, 2)) ||
	    VA_CHECK(vaCreateContext(S.va, S.va_cfg, w, h, VA_PROGRESSIVE, &S.prev_surf, 1, &S.prev_ctx)))
		return -1;
	VAImage *img = &S.prev_img;
	S.prev_derived = vaDeriveImage(S.va, S.prev_surf, img) == VA_STATUS_SUCCESS;
	if (S.prev_derived && !((img->format.fourcc == VA_FOURCC_BGRX || img->format.fourcc == VA_FOURCC_BGRA) &&
				img->num_planes == 1 && img->pitches[0] >= w * 4)) {
		vaDestroyImage(S.va, img->image_id);
		S.prev_derived = false;
	}
	if (!S.prev_derived) {
		VAImageFormat bgrx = {.fourcc = VA_FOURCC_BGRX, .byte_order = VA_LSB_FIRST, .bits_per_pixel = 32,
				      .depth = 24, .red_mask = 0xff0000, .green_mask = 0xff00, .blue_mask = 0xff};
		if (VA_CHECK(vaCreateImage(S.va, &bgrx, w, h, img)))
			return -1;
	}
	S.prev_w = w;
	S.prev_h = h;
	return 0;
}

static struct slot *free_slot(void)
{
	// rather not the slot encoded last: it's what an idle cast re-encodes
	struct slot *any = NULL;
	for (int i = 0; S.ring_w && i < RING; i++)
		if (S.slots[i].state == SLOT_FREE) {
			if (i != S.last_slot)
				return &S.slots[i];
			any = &S.slots[i];
		}
	return any;
}

static struct slot *oldest_submitted(void)
{
	struct slot *best = NULL;
	for (int i = 0; i < RING; i++)
		if (S.slots[i].state == SLOT_SUBMITTED && (!best || S.slots[i].seq < best->seq))
			best = &S.slots[i];
	return best;
}

// iw x ih fitted inside bw x bh, aspect kept, never upscaled; width a multiple of wa, height of 2, both >= min
static void fit(uint32_t iw, uint32_t ih, uint32_t bw, uint32_t bh, uint32_t wa, uint32_t min, uint32_t *w, uint32_t *h)
{
	uint64_t fw = iw, fh = ih;
	if (iw > bw || ih > bh) {
		if ((uint64_t)iw * bh >= (uint64_t)ih * bw) {
			fw = bw;
			fh = (uint64_t)ih * bw / iw;
		} else {
			fh = bh;
			fw = (uint64_t)iw * bh / ih;
		}
	}
	*w = SPA_MAX((uint32_t)fw / wa * wa, min);
	*h = SPA_MAX((uint32_t)fh & ~1u, min);
}

// loop lock held: the encode size (the source fitted into --size and the asked maximum height; width a multiple of 8,
// height of 2: VCN 5's AV1 alignment, no padding columns) and the preview's. The worker resizes.
static void update_sizes(void)
{
	uint32_t iw = S.clip ? S.clip_w : S.in_fmt.size.width, ih = S.clip ? S.clip_h : S.in_fmt.size.height;
	uint32_t bw = S.max_w, bh = S.max_h;
	if (!iw || !ih)
		return;
	if (S.req_h && S.req_h < bh) {
		bw = (uint32_t)((uint64_t)bw * S.req_h / bh);
		bh = S.req_h;
	}
	fit(iw, ih, S.max_w, S.max_h, 8, 16, &S.full_w, &S.full_h);
	fit(iw, ih, bw, bh, 8, 16, &S.want_w, &S.want_h);
	if (S.prev_box_w)
		fit(iw, ih, S.prev_box_w, S.prev_box_h, 2, 2, &S.prev_want_w, &S.prev_want_h);
	pw_thread_loop_signal(S.tl, false);
}

// ---------------------------------------------------------------- commands (stdin, loop thread)

static uint32_t kv(const char *line, const char *key, uint32_t def)
{
	const char *p = strstr(line, key);
	return p ? (uint32_t)strtoul(p + strlen(key), NULL, 10) : def;
}

// loop lock held. One per line:
//   start [kbps=N] [height=N]   encode (the preview runs regardless)
//   bitrate N                   new target (kbps), from the next frame
//   key                         the next frame a keyframe
//   height N                    maximum encode height (0: --size's); a new size starts with a keyframe
//   stop                        exit, stopping the cast (as does EOF)
static void command(char *line)
{
	if (!strncmp(line, "start", 5)) {
		if (!S.supported) {
			info("{\"type\":\"error\",\"message\":\"no AV1 encoder on %s\"}", S.device);
			return;
		}
		S.active = true;
		S.req_kbps = kv(line, "kbps=", S.req_kbps ? S.req_kbps : S.kbps);
		S.req_h = kv(line, "height=", S.req_h);
		S.want_key = true;
		S.failed = false;
		update_sizes();
		fprintf(stderr, "cmd: start %u kbps, height %u\n", S.req_kbps, S.req_h);
		STAGE_ONCE("start");
	} else if (!strncmp(line, "bitrate ", 8)) {
		S.req_kbps = SPA_CLAMP(strtoul(line + 8, NULL, 10), 100ul, 100000ul);
	} else if (!strcmp(line, "key")) {
		S.want_key = true;
		pw_thread_loop_signal(S.tl, false);
	} else if (!strncmp(line, "height ", 7)) {
		S.req_h = strtoul(line + 7, NULL, 10);
		update_sizes();
	} else if (!strcmp(line, "stop")) {
		request_quit("stopped");
	}
}

static void on_stdin(void *data, int fd, uint32_t mask)
{
	ssize_t n = read(fd, S.rbuf + S.rlen, sizeof(S.rbuf) - 1 - S.rlen);
	if (n <= 0) {
		if (n < 0 && (errno == EAGAIN || errno == EINTR))
			return;
		pw_loop_destroy_source(pw_thread_loop_get_loop(S.tl), S.stdin_src);
		S.stdin_src = NULL;
		request_quit("stdin closed");
		return;
	}
	S.rlen += n;
	S.rbuf[S.rlen] = 0;
	char *line = S.rbuf, *nl;
	while ((nl = strchr(line, '\n'))) {
		*nl = 0;
		command(line);
		line = nl + 1;
	}
	S.rlen = strlen(line);
	memmove(S.rbuf, line, S.rlen + 1);
	if (S.rlen == sizeof(S.rbuf) - 1)
		S.rlen = 0; // garbage
}

// ---------------------------------------------------------------- stats

// worker, loop lock held: every second a "stats" info (also into the log)
static void tick(void)
{
	double t = now();
	if (t - S.t_tick < 1.0)
		return;
	struct rusage ru;
	getrusage(RUSAGE_SELF, &ru);
	double dt = t - S.t_tick, cpu = (ru_sec(&ru) - ru_sec(&S.ru_tick)) / dt * 100;
	unsigned ne = S.n_enc ? S.n_enc : 1;
	char json[640];
	snprintf(json, sizeof(json),
		 "{\"type\":\"stats\",\"in\":%.1f,\"fps\":%.1f,\"kbps\":%.0f,\"target\":%u,\"width\":%u,\"height\":%u,"
		 "\"keys\":%u,\"repeats\":%u,\"skipped\":%u,\"busy\":%u,\"dropper\":%u,\"outDrops\":%u,\"encodeMs\":%.2f,"
		 "\"maxEncodeMs\":%.2f,\"latencyMs\":%.2f,\"maxLatencyMs\":%.2f,\"previews\":%u,\"cpu\":%.1f}",
		 S.n_in / dt, S.n_enc / dt, S.bytes * 8 / dt / 1e3, S.req_kbps ? S.req_kbps : S.kbps, S.ring_w, S.ring_h,
		 S.n_key, S.n_repeat, S.n_skip, S.n_nofree, S.n_dropper, S.n_outdrop, S.ms_enc / ne, S.max_enc, S.ms_lat / ne,
		 S.max_lat, S.n_prev, cpu);
	fprintf(stderr, "[%5.1fs] %s\n", t - S.t_start, json);
	S.total_in += S.n_in;
	S.n_in = S.n_skip = S.n_nofree = S.n_empty = S.n_enc = S.n_key = S.n_repeat = S.n_dropper = S.n_outdrop = S.n_prev = 0;
	S.ms_enc = S.max_enc = S.ms_lat = S.max_lat = 0;
	S.bytes = 0;
	S.t_tick = t;
	S.ru_tick = ru;
	if (S.seconds > 0 && t - S.t_start >= S.seconds)
		request_quit("--seconds");
	pw_thread_loop_unlock(S.tl);
	send_msg(MSG_INFO, 0, t, json, strlen(json), NULL, 0, true);
	pw_thread_loop_lock(S.tl);
}

// GPU time of this process: amdgpu's fdinfo drm-engine-<engine> (ns busy), summed over our distinct DRM clients,
// per GPU (drm-pdev), into buf, in ms per frame over `frames`
static void gpu_ms(char *buf, size_t len, unsigned long frames)
{
	char ids[16][32] = {{0}}, devs[4][32] = {{0}}, names[4][8][32] = {{{0}}}, path[300], line[256];
	double ms[4][8] = {{0}};
	int n_ids = 0;
	DIR *d = opendir("/proc/self/fdinfo");
	struct dirent *e;
	while (d && (e = readdir(d))) {
		snprintf(path, sizeof(path), "/proc/self/fdinfo/%s", e->d_name);
		FILE *f = fopen(path, "r");
		if (!f)
			continue;
		bool skip = false;
		int dev = 0;
		while (!skip && fgets(line, sizeof(line), f)) {
			char name[32], id[32];
			unsigned long long ns;
			if (sscanf(line, "drm-client-id: %31s", id) == 1) {
				for (int i = 0; i < n_ids; i++)
					skip |= !strcmp(ids[i], id);
				if (!skip && n_ids < 16)
					snprintf(ids[n_ids++], sizeof(ids[0]), "%s", id);
			} else if (sscanf(line, "drm-pdev: %31s", id) == 1) {
				const char *short_id = strncmp(id, "0000:", 5) ? id : id + 5;
				for (dev = 0; dev < 3 && devs[dev][0] && strcmp(devs[dev], short_id); dev++)
					;
				snprintf(devs[dev], sizeof(devs[0]), "%s", short_id);
			} else if (strncmp(line, "drm-engine-capacity-", 20) && sscanf(line, "drm-engine-%31[^:]: %llu ns", name, &ns) == 2) {
				for (int i = 0; i < 8; i++)
					if (!names[dev][i][0] || !strcmp(names[dev][i], name)) {
						snprintf(names[dev][i], sizeof(names[0][0]), "%s", name);
						ms[dev][i] += ns / 1e6;
						break;
					}
			}
		}
		fclose(f);
	}
	if (d)
		closedir(d);
	buf[0] = 0;
	for (int g = 0; g < 4 && devs[g][0]; g++) {
		double sum = 0;
		size_t n = strlen(buf);
		n += snprintf(buf + n, len - n, "%s [%s]", g ? ";" : "", devs[g]);
		for (int i = 0; i < 8 && names[g][i][0] && n < len; i++)
			if (ms[g][i] > 0) {
				sum += ms[g][i];
				n += snprintf(buf + n, len - n, " %s %.1f", names[g][i], ms[g][i]);
			}
		if (n < len)
			snprintf(buf + n, len - n, " = %.2f ms/frame", frames ? sum / frames : 0);
	}
}

// ---------------------------------------------------------------- worker: encode, preview

// IVF (--encode-out): "DKIF", version 0, header size 32, "AV01", w, h, timebase 1/fps, frames; rewritten at the end
static void ivf_header(void)
{
	uint8_t h[32] = "DKIF";
	uint16_t hs = 32, w = S.ring_w, ht = S.ring_h;
	uint32_t den = S.fps, num = 1, n = S.ivf_frames;
	memcpy(h + 6, &hs, 2);
	memcpy(h + 8, "AV01", 4);
	memcpy(h + 12, &w, 2);
	memcpy(h + 14, &ht, 2);
	memcpy(h + 16, &den, 4);
	memcpy(h + 20, &num, 4);
	memcpy(h + 24, &n, 4);
	fseek(S.ivf, 0, SEEK_SET);
	fwrite(h, 1, 32, S.ivf);
	fseek(S.ivf, 0, SEEK_END);
}

// worker, loop lock held: the encode ring + encoder at the wanted size while encoding (none otherwise), the preview
// surface at its size
static void reconcile(void)
{
	bool want = S.active && S.want_w && !S.failed;
	if (S.ring_w && (!want || S.ring_w != S.want_w || S.ring_h != S.want_h)) {
		fprintf(stderr, "enc: %ux%u off%s\n", S.ring_w, S.ring_h, want ? " (resize)" : "");
		ring_destroy();
	}
	if (want && !S.ring_w) {
		if (ring_create() < 0) {
			ring_destroy();
			S.failed = true;
			info("{\"type\":\"error\",\"message\":\"encoder setup failed\"}");
		} else {
			S.want_key = true;
			STAGE_ONCE("encoder");
			info("{\"type\":\"started\",\"width\":%u,\"height\":%u}", S.ring_w, S.ring_h);
		}
	}
	if (S.prev_state != SLOT_FREE)
		return;
	if (S.prev_w && (S.prev_w != S.prev_want_w || S.prev_h != S.prev_want_h))
		preview_destroy();
	if (!S.prev_w && S.prev_want_w) {
		if (preview_create() < 0) {
			preview_destroy();
			S.prev_box_w = S.prev_want_w = 0; // no preview, but the stream goes on
		} else
			STAGE_ONCE("preview-ready");
	}
}

// worker, called with the loop lock held and returns with it: encode slot s, send the temporal unit
static void encode(struct slot *s, bool repeat)
{
	s->state = SLOT_BUSY;
	bool key = S.want_key;
	S.want_key = false;
	uint32_t kbps = S.req_kbps ? S.req_kbps : S.kbps, wh = S.ring_w | S.ring_h << 16;
	pw_thread_loop_unlock(S.tl);

	if (!repeat)
		slot_wait(s, 1000);
	// frame dropper (libwebrtc's FrameDropper, roughly): radeonsi doesn't enforce the HRD, so a scene cut can come out
	// as one frame worth most of a second of the budget, and everything behind it stalls in the pacer. Bits over the
	// target are a debt draining at the target rate; while it's over --drop-ms worth, frames aren't encoded at all.
	// A keyframe request is never dropped.
	double t_now = now(), per_s = kbps * 1000.0;
	if (S.last_enc_t)
		S.debt = SPA_MAX(0.0, S.debt - per_s * SPA_MIN(t_now - S.last_enc_t, 1.0));
	S.last_enc_t = t_now;
	bool drop = S.drop_ms > 0 && !key && S.debt > per_s * S.drop_ms / 1000;
	const uint8_t *data = NULL;
	struct av1enc_frame fi = {0};
	long len = -1;
	if (!drop) {
		av1enc_set_kbps(S.enc, kbps);
		len = av1enc_encode(S.enc, s->surf, key, &data, &fi);
	}
	int r = 1;
	if (len > 0) {
		S.debt += len * 8.0;
		if (S.ivf) {
			uint32_t sz = (uint32_t)len;
			uint64_t pts = S.ivf_frames++;
			fwrite(&sz, 4, 1, S.ivf);
			fwrite(&pts, 8, 1, S.ivf);
			fwrite(data, 1, len, S.ivf);
		}
		uint32_t pre[4] = {fi.key, wh, fi.qp, (uint32_t)((now() - s->t_submit) * 1e6)};
		r = send_msg(MSG_FRAME, (uint32_t)s->seq, s->t_submit, pre, sizeof(pre), data, len, true);
		if (r > 0)
			STAGE_ONCE("first-frame");
	}
	double lat = (now() - s->t_submit) * 1e3;

	pw_thread_loop_lock(S.tl);
	if (len > 0) {
		S.n_enc++;
		S.total_enc++;
		S.n_key += fi.key;
		S.n_repeat += repeat;
		S.ms_enc += fi.ms_encode;
		S.ms_enc_total += fi.ms_encode;
		S.max_enc = SPA_MAX(S.max_enc, fi.ms_encode);
		S.ms_lat += lat;
		S.max_lat = SPA_MAX(S.max_lat, lat);
		S.bytes += len;
	} else if (drop) {
		S.n_dropper++;
	} else {
		S.failed = true; // the encoder broke: mincord falls back
		info("{\"type\":\"error\",\"message\":\"encode failed\"}");
	}
	if (r == 0) {
		S.n_outdrop++;
		S.want_key = true; // mincord lost a frame: restart the stream
	}
	S.last_slot = (int)(s - S.slots);
	s->state = SLOT_FREE;
}

// worker, called with the loop lock held and returns with it: read the submitted preview back and send it
static void preview_send(void)
{
	S.prev_state = SLOT_BUSY;
	uint32_t w = S.prev_w, h = S.prev_h;
	double t = now();
	pw_thread_loop_unlock(S.tl);
	size_t size = (size_t)w * h * 4 + 4;
	uint8_t *buf = malloc(size), *p;
	VAImage *img = &S.prev_img;
	bool ok = buf && !VA_CHECK(vaSyncSurface(S.va, S.prev_surf)) &&
		  (S.prev_derived || !VA_CHECK(vaGetImage(S.va, S.prev_surf, 0, 0, w, h, img->image_id))) &&
		  !VA_CHECK(vaMapBuffer2(S.va, img->buf, (void **)&p, VA_MAPBUFFER_FLAG_READ));
	if (ok) {
		uint32_t wh = w | h << 16;
		memcpy(buf, &wh, 4);
		// X forced to 0xff: radeonsi's VPP leaves the red channel there, which Chromium takes for premultiplied
		// alpha and divides by (dark colours came out near white)
		for (uint32_t y = 0; y < h; y++) {
			uint32_t *d = (uint32_t *)(buf + 4 + (size_t)y * w * 4);
			const uint32_t *s = (const uint32_t *)(p + img->offsets[0] + (size_t)y * img->pitches[0]);
			for (uint32_t x = 0; x < w; x++)
				d[x] = s[x] | 0xff000000u;
		}
		vaUnmapBuffer(S.va, img->buf);
		if (send_msg(MSG_PREVIEW, 0, t, buf, size, NULL, 0, true) > 0)
			STAGE_ONCE("preview");
	}
	free(buf);
	pw_thread_loop_lock(S.tl);
	S.n_prev += ok;
	S.prev_state = SLOT_FREE;
}

// worker: the D-Bus session's signals (niri closing the cast: the window went away)
static void bus_poll(void)
{
	while (S.bus && sd_bus_process(S.bus, NULL) > 0)
		;
	if (S.cast_closed)
		request_quit("cast closed");
}

// worker, loop lock held: nothing new from niri (it sends no frames while the source doesn't change), so the last
// frame again: a keyframe request is answered at once and the stream stays alive. The slot encoded last, or, when
// the encoder has only just started on a static cast, niri's last buffer once more through the VPP (requeued, but
// niri renders into it only for a new frame, which then comes anyway). False if there's nothing to repeat.
static bool repeat(void)
{
	if (S.last_slot >= 0 && S.slots[S.last_slot].state == SLOT_FREE) {
		struct slot *s = &S.slots[S.last_slot];
		s->t_submit = now();
		s->seq = S.seq++;
		encode(s, true);
		return true;
	}
	struct slot *s = S.last_slot < 0 && S.last_surf != VA_INVALID_SURFACE ? free_slot() : NULL;
	if (!s || vpp_submit(S.ring_ctx, S.ring_w, S.ring_h, S.last_surf, s->surf, false, true) < 0)
		return false;
	s->state = SLOT_SUBMITTED;
	s->t_submit = now();
	s->seq = S.seq++;
	return true;
}

// called and returns with the loop lock held; drops it for everything slow
static void worker_run(void)
{
	while (!S.quit) {
		tick();
		pw_thread_loop_unlock(S.tl);
		bus_poll();
		pw_thread_loop_lock(S.tl);
		reconcile();
		struct slot *s = oldest_submitted();
		double idle_ms = (now() - S.last_enc_t) * 1e3;
		if (s)
			encode(s, false);
		else if (S.prev_state == SLOT_SUBMITTED)
			preview_send();
		else if (S.enc && (S.want_key || idle_ms >= S.repeat_ms) && repeat())
			;
		else {
			struct timespec abstime;
			pw_thread_loop_get_time(S.tl, &abstime, 30 * SPA_NSEC_PER_MSEC);
			pw_thread_loop_timed_wait_full(S.tl, &abstime);
		}
	}
}

// ---------------------------------------------------------------- --clip: test input instead of a cast
//
// A raw I420 file played in real time (the lab's file source: same frames, the frame index stamped as the bench's
// barcode), uploaded to NV12 and VPP-scaled into the encode ring like a cast frame (put straight into the slot at
// its own size: Mesa's VPP isn't an exact copy). The upload is CPU work the real path doesn't have.

#define CLIP_RING 6
static struct {
	int fd;
	uint32_t w, h;
	unsigned long count, want;
	uint8_t *buf[CLIP_RING];
	unsigned long have[CLIP_RING]; // index + 1 held by each slot (0: empty)
	pthread_mutex_t mtx;
	pthread_cond_t cond;
	bool stop;
} C = {.mtx = PTHREAD_MUTEX_INITIALIZER, .cond = PTHREAD_COND_INITIALIZER};

// frames read, stamped and interleaved to NV12 ahead of time (a 5.5 MB read per 1440p frame in the encode loop made
// the clip play at 45-50 fps)
static void *clip_reader(void *arg)
{
	size_t ysize = (size_t)C.w * C.h, fsize = ysize * 3 / 2;
	uint8_t *raw = malloc(fsize);
	for (unsigned long idx = 0;; idx++) {
		pthread_mutex_lock(&C.mtx);
		while (!C.stop && idx >= C.want + CLIP_RING)
			pthread_cond_wait(&C.cond, &C.mtx);
		bool stop = C.stop;
		pthread_mutex_unlock(&C.mtx);
		if (stop)
			break;
		if (pread(C.fd, raw, fsize, (off_t)((idx % C.count) * fsize)) != (ssize_t)fsize)
			memset(raw, 128, fsize);
		// barcode: the frame index's 16 bits as 32x32 blocks along the bottom
		for (int b = 0; b < 16; b++)
			for (uint32_t r = C.h - 32; r < C.h; r++)
				memset(raw + (size_t)r * C.w + b * 32, (idx >> b) & 1 ? 235 : 16, 32);
		uint8_t *d = C.buf[idx % CLIP_RING];
		memcpy(d, raw, ysize);
		const uint8_t *u = raw + ysize, *v = u + ysize / 4;
		for (size_t i = 0; i < ysize / 4; i++) {
			d[ysize + 2 * i] = u[i];
			d[ysize + 2 * i + 1] = v[i];
		}
		pthread_mutex_lock(&C.mtx);
		C.have[idx % CLIP_RING] = idx + 1;
		pthread_cond_broadcast(&C.cond);
		pthread_mutex_unlock(&C.mtx);
	}
	free(raw);
	return NULL;
}

// entered and left with the loop lock held
static void clip_run(void)
{
	uint32_t w = S.clip_w, h = S.clip_h;
	size_t ysize = (size_t)w * h;
	C.fd = open(S.clip, O_RDONLY | O_CLOEXEC);
	if (C.fd < 0) {
		fprintf(stderr, "clip %s: %m\n", S.clip);
		return;
	}
	C.w = w, C.h = h;
	C.count = lseek(C.fd, 0, SEEK_END) / (ysize * 3 / 2);
	VASurfaceID src;
	VAImage img = {.image_id = VA_INVALID_ID};
	VAImageFormat nv12 = {.fourcc = VA_FOURCC_NV12, .byte_order = VA_LSB_FIRST, .bits_per_pixel = 12};
	if (!C.count || VA_CHECK(vaCreateSurfaces(S.va, VA_RT_FORMAT_YUV420, w, h, &src, 1, NULL, 0)) ||
	    VA_CHECK(vaCreateImage(S.va, &nv12, w, h, &img)))
		return;
	for (int i = 0; i < CLIP_RING; i++)
		C.buf[i] = malloc(ysize * 3 / 2);
	pthread_t reader;
	pthread_create(&reader, NULL, clip_reader, NULL);
	fprintf(stderr, "clip: %s %ux%u, %lu frames at %u fps\n", S.clip, w, h, C.count, S.fps);
	unsigned long idx = 0;
	double next = 0;
	update_sizes();
	info("{\"type\":\"input\",\"width\":%u,\"height\":%u,\"encodeWidth\":%u,\"encodeHeight\":%u}", w, h, S.full_w,
	     S.full_h);
	while (!S.quit) {
		tick();
		reconcile();
		if (S.prev_state == SLOT_SUBMITTED)
			preview_send();
		pw_thread_loop_unlock(S.tl);
		double t = now();
		if (!next)
			next = t;
		if (next > t)
			usleep((useconds_t)((next - t) * 1e6));
		next += 1.0 / S.fps;
		if (now() - next > 0.5)
			next = now(); // way behind (stopped in a debugger...): don't burst
		pthread_mutex_lock(&C.mtx);
		while (C.have[idx % CLIP_RING] != idx + 1)
			pthread_cond_wait(&C.cond, &C.mtx);
		pthread_mutex_unlock(&C.mtx);
		const uint8_t *f = C.buf[idx % CLIP_RING];
		uint8_t *p;
		if (!VA_CHECK(vaMapBuffer(S.va, img.buf, (void **)&p))) {
			for (uint32_t r = 0; r < h; r++)
				memcpy(p + img.offsets[0] + (size_t)r * img.pitches[0], f + (size_t)r * w, w);
			for (uint32_t r = 0; r < h / 2; r++)
				memcpy(p + img.offsets[1] + (size_t)r * img.pitches[1], f + ysize + (size_t)r * w, w);
			vaUnmapBuffer(S.va, img.buf);
		}
		pthread_mutex_lock(&C.mtx);
		C.want = idx + 1;
		pthread_cond_broadcast(&C.cond);
		pthread_mutex_unlock(&C.mtx);
		pw_thread_loop_lock(S.tl);
		S.n_in++;
		t = now();
		bool uploaded = !VA_CHECK(vaPutImage(S.va, src, img.image_id, 0, 0, w, h, 0, 0, w, h));
		if (uploaded && S.prev_w && S.prev_state == SLOT_FREE && t >= S.prev_next &&
		    vpp_submit(S.prev_ctx, S.prev_w, S.prev_h, src, S.prev_surf, true, false) == 0) {
			S.prev_state = SLOT_SUBMITTED;
			S.prev_next = t + S.prev_interval;
		}
		struct slot *s = S.enc ? free_slot() : NULL;
		if (uploaded && s) {
			bool direct = S.ring_w == w && S.ring_h == h;
			if (direct ? !VA_CHECK(vaPutImage(S.va, s->surf, img.image_id, 0, 0, w, h, 0, 0, w, h))
				   : vpp_submit(S.ring_ctx, S.ring_w, S.ring_h, src, s->surf, true, true) == 0) {
				s->state = SLOT_SUBMITTED;
				s->t_submit = t;
				s->seq = idx;
				S.total_sub++;
				encode(s, false);
			}
		}
		idx++;
		if (S.ivf && S.seconds <= 0 && idx >= C.count)
			break;
	}
	pthread_mutex_lock(&C.mtx);
	C.stop = true;
	pthread_cond_broadcast(&C.cond);
	pthread_mutex_unlock(&C.mtx);
	pw_thread_loop_unlock(S.tl);
	pthread_join(reader, NULL);
	vaDestroyImage(S.va, img.image_id);
	vaDestroySurfaces(S.va, &src, 1);
	for (int i = 0; i < CLIP_RING; i++)
		free(C.buf[i]);
	close(C.fd);
	pw_thread_loop_lock(S.tl);
}

// ---------------------------------------------------------------- input stream (the cast; loop thread)

static const struct spa_pod *build_in_format(struct spa_pod_builder *b)
{
	struct spa_pod_frame f[2];
	spa_pod_builder_push_object(b, &f[0], SPA_TYPE_OBJECT_Format, SPA_PARAM_EnumFormat);
	spa_pod_builder_add(b, SPA_FORMAT_mediaType, SPA_POD_Id(SPA_MEDIA_TYPE_video),
			    SPA_FORMAT_mediaSubtype, SPA_POD_Id(SPA_MEDIA_SUBTYPE_raw),
			    SPA_FORMAT_VIDEO_format, SPA_POD_Id(SPA_VIDEO_FORMAT_BGRx), 0);
	spa_pod_builder_prop(b, SPA_FORMAT_VIDEO_modifier, SPA_POD_PROP_FLAG_MANDATORY | SPA_POD_PROP_FLAG_DONT_FIXATE);
	spa_pod_builder_push_choice(b, &f[1], SPA_CHOICE_Enum, 0);
	spa_pod_builder_long(b, S.mods[0]);
	for (int i = 0; i < S.n_mods; i++)
		spa_pod_builder_long(b, S.mods[i]);
	spa_pod_builder_pop(b, &f[1]);
	spa_pod_builder_add(b,
			    SPA_FORMAT_VIDEO_size, SPA_POD_CHOICE_RANGE_Rectangle(&SPA_RECTANGLE(3840, 2160), &SPA_RECTANGLE(1, 1), &SPA_RECTANGLE(16384, 16384)),
			    SPA_FORMAT_VIDEO_framerate, SPA_POD_Fraction(&SPA_FRACTION(0, 1)),
			    SPA_FORMAT_VIDEO_maxFramerate, SPA_POD_CHOICE_RANGE_Fraction(&SPA_FRACTION(S.fps, 1), &SPA_FRACTION(0, 1), &SPA_FRACTION(S.fps, 1)),
			    0);
	return spa_pod_builder_pop(b, &f[0]);
}

// a modifier VA can't import: offer niri the others (as OBS does)
static void renegotiate_without(uint64_t bad)
{
	int j = 0;
	for (int i = 0; i < S.n_mods; i++)
		if (S.mods[i] != bad)
			S.mods[j++] = S.mods[i];
	S.n_mods = j;
	if (!S.n_mods) {
		request_quit("no importable modifiers");
		return;
	}
	fprintf(stderr, "renegotiating without modifier 0x%" PRIx64 " (%d left)\n", bad, S.n_mods);
	drop_surfaces();
	uint8_t buf[4096];
	struct spa_pod_builder b = SPA_POD_BUILDER_INIT(buf, sizeof(buf));
	const struct spa_pod *p = build_in_format(&b);
	pw_stream_update_params(S.in, &p, 1);
}

static void in_state_changed(void *data, enum pw_stream_state old, enum pw_stream_state state, const char *error)
{
	fprintf(stderr, "input: %s%s%s\n", pw_stream_state_as_string(state), error ? ": " : "", error ? error : "");
	if (state == PW_STREAM_STATE_PAUSED)
		STAGE_ONCE("pw-paused");
	else if (state == PW_STREAM_STATE_STREAMING)
		STAGE_ONCE("pw-streaming");
	if (state == PW_STREAM_STATE_ERROR || state == PW_STREAM_STATE_UNCONNECTED)
		request_quit("cast closed");
}

static void in_param_changed(void *data, uint32_t id, const struct spa_pod *param)
{
	uint32_t mt, mst;
	if (id != SPA_PARAM_Format || !param || spa_format_parse(param, &mt, &mst) < 0 || mt != SPA_MEDIA_TYPE_video ||
	    mst != SPA_MEDIA_SUBTYPE_raw)
		return;
	struct spa_video_info_raw fmt = {0};
	spa_format_video_raw_parse(param, &fmt);
	const struct spa_pod_prop *mod = spa_pod_find_prop(param, NULL, SPA_FORMAT_VIDEO_modifier);
	if (mod && (mod->flags & SPA_POD_PROP_FLAG_DONT_FIXATE)) {
		fprintf(stderr, "input: format with unfixated modifier list, waiting for the producer to fixate\n");
		STAGE_ONCE("format-offered");
		return;
	}
	S.in_fmt = fmt;
	fprintf(stderr, "input: format %s %ux%u modifier 0x%" PRIx64 "%s max %u/%u\n",
		spa_debug_type_find_short_name(spa_type_video_format, fmt.format), fmt.size.width, fmt.size.height,
		fmt.modifier, mod ? "" : " (no modifier: not DMA-BUF)", fmt.max_framerate.num, fmt.max_framerate.denom);
	drop_surfaces();
	STAGE_ONCE("format");
	if (fmt.size.width && fmt.size.height) {
		update_sizes();
		info("{\"type\":\"input\",\"width\":%u,\"height\":%u,\"encodeWidth\":%u,\"encodeHeight\":%u}", fmt.size.width,
		     fmt.size.height, S.full_w, S.full_h);
	}
	uint8_t buf[1024];
	struct spa_pod_builder b = SPA_POD_BUILDER_INIT(buf, sizeof(buf));
	const struct spa_pod *params[2] = {
		spa_pod_builder_add_object(&b, SPA_TYPE_OBJECT_ParamBuffers, SPA_PARAM_Buffers,
					   SPA_PARAM_BUFFERS_buffers, SPA_POD_CHOICE_RANGE_Int(4, 2, MAX_BUFS),
					   SPA_PARAM_BUFFERS_dataType, SPA_POD_CHOICE_FLAGS_Int(1 << SPA_DATA_DmaBuf)),
		spa_pod_builder_add_object(&b, SPA_TYPE_OBJECT_ParamMeta, SPA_PARAM_Meta,
					   SPA_PARAM_META_type, SPA_POD_Id(SPA_META_Header),
					   SPA_PARAM_META_size, SPA_POD_Int(sizeof(struct spa_meta_header))),
	};
	pw_stream_update_params(S.in, params, 2);
}

static void in_add_buffer(void *data, struct pw_buffer *b)
{
	struct inbuf *ib = inbuf_for(NULL);
	if (ib)
		*ib = (struct inbuf){.pwb = b, .surf = VA_INVALID_SURFACE};
	STAGE_ONCE("buffers");
}

static void in_remove_buffer(void *data, struct pw_buffer *b)
{
	struct inbuf *ib = inbuf_for(b);
	if (!ib)
		return;
	if (ib->surf == S.last_surf)
		S.last_surf = VA_INVALID_SURFACE;
	if (ib->surf != VA_INVALID_SURFACE)
		vaDestroySurfaces(S.va, &ib->surf, 1);
	*ib = (struct inbuf){0};
}

// Pacing, a free slot, import and VPP of niri's buffer b into the slot (and into the preview when one is due);
// never waits for the GPU. Returns -1 if b doesn't import (b requeued, renegotiating), 0 otherwise.
static int submit_frame(struct pw_buffer *b)
{
	// pacing: at most --fps on average, but tolerate jitter (niri on a 240 Hz output delivers a 60 fps cast at
	// 12.5/16.7/20.8 ms intervals). Frames over budget go back untouched.
	double t0 = now();
	S.credit = SPA_MIN(S.credit + (t0 - S.last_in) * S.fps, 2.0);
	S.last_in = t0;
	bool want_enc = S.ring_w && S.ring_w == S.want_w && S.ring_h == S.want_h;
	bool want_prev = S.prev_w && S.prev_state == SLOT_FREE && t0 >= S.prev_next;
	if (want_enc && S.credit < 1.0) {
		S.n_skip++;
		want_enc = false;
	}
	struct slot *s = want_enc ? free_slot() : NULL;
	S.n_nofree += want_enc && !s; // the worker is behind: drop rather than wait
	struct inbuf *ib = inbuf_for(b);
	if ((!s && !want_prev) || !ib || ib->failed)
		return 0;
	if (ib->surf == VA_INVALID_SURFACE) {
		ib->surf = import_buffer(b);
		if (ib->surf == VA_INVALID_SURFACE) {
			ib->failed = true;
			pw_stream_queue_buffer(S.in, b);
			renegotiate_without(S.in_fmt.modifier);
			return -1;
		}
	}
	S.last_surf = ib->surf;
	if (want_prev && vpp_submit(S.prev_ctx, S.prev_w, S.prev_h, ib->surf, S.prev_surf, false, false) == 0) {
		STAGE_ONCE("first-vpp");
		S.prev_state = SLOT_SUBMITTED;
		S.prev_next = t0 + S.prev_interval;
	}
	if (s && vpp_submit(S.ring_ctx, S.ring_w, S.ring_h, ib->surf, s->surf, false, true) == 0) {
		STAGE_ONCE("first-encode-vpp");
		s->state = SLOT_SUBMITTED;
		s->t_submit = now();
		s->seq = S.seq++;
		S.credit -= 1.0;
		S.total_sub++;
	}
	pw_thread_loop_signal(S.tl, false);
	return 0;
}

// Dequeue, pick the newest frame, submit it, requeue it at once: the VPP's read is only queued on the GPU, but
// amdgpu's implicit sync makes niri's next render into this buffer wait for it (see README).
static void in_process(void *data)
{
	struct pw_buffer *b, *last = NULL;
	while ((b = pw_stream_dequeue_buffer(S.in))) {
		if (last)
			pw_stream_queue_buffer(S.in, last);
		last = b;
		S.n_in++;
	}
	if (!last)
		return;
	STAGE_ONCE("first-buffer");
	struct spa_meta_header *h = spa_buffer_find_meta_data(last->buffer, SPA_META_Header, sizeof(*h));
	struct spa_data *d = &last->buffer->datas[0];
	if ((h && (h->flags & SPA_META_HEADER_FLAG_CORRUPTED)) || (d->chunk->flags & SPA_CHUNK_FLAG_CORRUPTED) ||
	    d->type != SPA_DATA_DmaBuf)
		S.n_empty++;
	else if (submit_frame(last) < 0)
		return;
	pw_stream_queue_buffer(S.in, last);
}

static const struct pw_stream_events in_events = {
	PW_VERSION_STREAM_EVENTS,
	.state_changed = in_state_changed,
	.param_changed = in_param_changed,
	.add_buffer = in_add_buffer,
	.remove_buffer = in_remove_buffer,
	.process = in_process,
};

// ---------------------------------------------------------------- main

static void on_core_error(void *data, uint32_t id, int seq, int res, const char *message)
{
	fprintf(stderr, "pipewire error id %u: %s (%s)\n", id, message, spa_strerror(res));
	if (id == PW_ID_CORE && res == -EPIPE)
		request_quit("pipewire gone");
}

static const struct pw_core_events core_events = {PW_VERSION_CORE_EVENTS, .error = on_core_error};

static void on_signal(int sig)
{
	S.quit = 1; // the worker notices within 30 ms
}

// --device auto: the render node with the most dedicated VRAM (amdgpu's mem_info_vram_total; a node without it counts
// as 0), ties to the lowest node: the dGPU, where niri renders and whose VCN encodes AV1
static void pick_device(void)
{
	static char best[64];
	unsigned long long best_vram = 0;
	int best_n = 1 << 30;
	DIR *d = opendir("/sys/class/drm");
	struct dirent *e;
	while (d && (e = readdir(d))) {
		int n;
		if (sscanf(e->d_name, "renderD%d", &n) != 1)
			continue;
		char path[300];
		unsigned long long vram = 0;
		snprintf(path, sizeof(path), "/sys/class/drm/%s/device/mem_info_vram_total", e->d_name);
		FILE *f = fopen(path, "r");
		if (f) {
			if (fscanf(f, "%llu", &vram) != 1)
				vram = 0;
			fclose(f);
		}
		if (!best[0] || vram > best_vram || (vram == best_vram && n < best_n)) {
			best_vram = vram, best_n = n;
			snprintf(best, sizeof(best), "/dev/dri/%.32s", e->d_name);
		}
	}
	if (d)
		closedir(d);
	S.device = best[0] ? best : "/dev/dri/renderD128";
}

static void usage(void)
{
	fprintf(stderr,
		"usage: capture (--window ID | --output NAME | --node ID) [--size WxH] [--fps 60] [--cursor embedded|hidden]\n"
		"               [--device auto|/dev/dri/renderDN] [--kbps 6000] [--av1-refs 1|2] [--av1-min-q 10]\n"
		"               [--drop-ms 300] [--repeat-ms 1000] [--preview WxH] [--preview-fps 1] [--seconds N]\n"
		"               [--start] [--encode-out FILE.ivf]\n"
		"       capture --clip FILE.i420 --clip-size WxH [the same options]\n"
		"stdin: start [kbps=N] [height=N] | bitrate N | key | height N | stop; stdout: see README\n");
	exit(2);
}

static void parse_size(const char *s, uint32_t *w, uint32_t *h, uint32_t min)
{
	if (sscanf(s, "%ux%u", w, h) != 2 || *w < min || *h < min)
		usage();
}

int main(int argc, char **argv)
{
	static const struct option opts[] = {
		{"window", required_argument, 0, 'w'}, {"output", required_argument, 0, 'o'},
		{"node", required_argument, 0, 'n'}, {"clip", required_argument, 0, 'C'},
		{"clip-size", required_argument, 0, 'Z'}, {"size", required_argument, 0, 's'},
		{"fps", required_argument, 0, 'f'}, {"cursor", required_argument, 0, 'c'},
		{"device", required_argument, 0, 'd'}, {"kbps", required_argument, 0, 'K'},
		{"av1-refs", required_argument, 0, 'X'}, {"av1-min-q", required_argument, 0, 'q'},
		{"drop-ms", required_argument, 0, 'P'}, {"repeat-ms", required_argument, 0, 'R'},
		{"preview", required_argument, 0, 'p'}, {"preview-fps", required_argument, 0, 'F'},
		{"seconds", required_argument, 0, 't'}, {"start", no_argument, 0, 'S'},
		{"encode-out", required_argument, 0, 'W'}, {"help", no_argument, 0, 'h'}, {0},
	};
	const char *ivf_path = NULL;
	bool start = false;
	int c;
	while ((c = getopt_long(argc, argv, "", opts, NULL)) != -1) {
		switch (c) {
		case 'w': S.window_id = strtoull(optarg, NULL, 10); S.source = 'w'; break;
		case 'o': S.output = optarg; S.source = 'o'; break;
		case 'n': S.node = strtoul(optarg, NULL, 10); S.source = 'n'; break;
		case 'C': S.clip = optarg; S.source = 'c'; break;
		case 'Z': parse_size(optarg, &S.clip_w, &S.clip_h, 16); break;
		case 's': parse_size(optarg, &S.max_w, &S.max_h, 16); break;
		case 'f': S.fps = strtoul(optarg, NULL, 10); break;
		case 'c': S.cursor = !strcmp(optarg, "hidden") ? 0 : 1; break;
		case 'd': S.device = optarg; break;
		case 'K': S.kbps = strtoul(optarg, NULL, 10); break;
		case 'X': S.refs = strtoul(optarg, NULL, 10); break;
		case 'q': S.min_qindex = strtoul(optarg, NULL, 10); break;
		case 'P': S.drop_ms = strtod(optarg, NULL); break;
		case 'R': S.repeat_ms = strtod(optarg, NULL); break;
		case 'p': parse_size(optarg, &S.prev_box_w, &S.prev_box_h, 0); break;
		case 'F': S.prev_interval = 1.0 / SPA_MAX(strtod(optarg, NULL), 0.01); break;
		case 't': S.seconds = strtod(optarg, NULL); break;
		case 'S': start = true; break;
		case 'W': ivf_path = optarg; break;
		default: usage();
		}
	}
	if (optind < argc || !S.source || !S.fps || (S.source == 'c' && !S.clip_w))
		usage();
	if (!S.max_w)
		S.max_w = S.max_h = 16384; // no box: the source's own size
	if (!S.prev_box_h)
		S.prev_box_w = 0; // --preview 0x0: none
	t_main = now();
	prctl(PR_SET_PDEATHSIG, SIGTERM);
	stderr_to_log();
	// stdout: a pipe to mincord, written non-blocking (a full pipe drops the frame, the next is a keyframe)
	fcntl(1, F_SETPIPE_SZ, 1 << 20);
	fcntl(1, F_SETFL, fcntl(1, F_GETFL) | O_NONBLOCK);
	if (!strcmp(S.device, "auto"))
		pick_device();
	stage("main");
	// the GPU side first: EGL's modifiers for the device (what niri is offered; not for --clip), then VA-API
	if (S.source != 'c') {
		if (query_modifiers() < 0) {
			info("{\"type\":\"error\",\"message\":\"no VA-API on %s\"}", S.device);
			return 1;
		}
		stage("modifiers");
	}
	if (va_init() < 0) {
		info("{\"type\":\"error\",\"message\":\"no VA-API on %s\"}", S.device);
		return 1;
	}
	stage("va");

	struct sigaction sa = {.sa_handler = on_signal};
	sigaction(SIGINT, &sa, NULL);
	sigaction(SIGTERM, &sa, NULL);
	signal(SIGPIPE, SIG_IGN);

	if (S.source == 'w' || S.source == 'o') {
		if (cast_start() < 0) {
			info("{\"type\":\"error\",\"message\":\"could not start the cast\"}");
			cast_stop();
			return 1;
		}
		// the session's number is niri's cast session id: mincord stops the cast through niri's IPC should we die
		const char *u = strrchr(S.session, 'u');
		info("{\"type\":\"cast\",\"session\":\"%s\",\"sessionId\":%s,\"node\":%u}", S.session,
		     u && u[1] >= '0' && u[1] <= '9' ? u + 1 : "null", S.node);
	}

	// PipeWire
	pw_init(&argc, &argv);
	S.tl = pw_thread_loop_new("mincord-capture", NULL);
	if (pw_thread_loop_start(S.tl) < 0) {
		fprintf(stderr, "pw_thread_loop_start failed\n");
		return 1;
	}
	pw_thread_loop_lock(S.tl);
	S.ctx = pw_context_new(pw_thread_loop_get_loop(S.tl), NULL, 0);
	if (S.source != 'c') {
		S.core = pw_context_connect(S.ctx, NULL, 0);
		if (!S.core) {
			fprintf(stderr, "pw_context_connect: %m\n");
			request_quit("no PipeWire");
		} else
			pw_core_add_listener(S.core, &S.core_listener, &core_events, NULL);
	}
	if (ivf_path) {
		if (!S.supported || !(S.ivf = fopen(ivf_path, "wb"))) {
			fprintf(stderr, "--encode-out: %s\n", S.supported ? strerror(errno) : "no AV1 encoder");
			cast_stop();
			return 1;
		}
		fseek(S.ivf, 32, SEEK_SET);
		start = true;
	}
	if (start && S.supported)
		S.active = S.want_key = true;

	// commands from a pipe (mincord); stdin from /dev/null or a terminal isn't watched (lab and cost runs)
	struct stat st;
	if (fstat(0, &st) == 0 && (S_ISFIFO(st.st_mode) || S_ISSOCK(st.st_mode))) {
		fcntl(0, F_SETFL, fcntl(0, F_GETFL) | O_NONBLOCK);
		S.stdin_src = pw_loop_add_io(pw_thread_loop_get_loop(S.tl), 0, SPA_IO_IN | SPA_IO_HUP | SPA_IO_ERR, false,
					     on_stdin, NULL);
	}
	if (S.core) {
		S.in = pw_stream_new(S.core, "mincord-capture",
				     pw_properties_new(PW_KEY_MEDIA_TYPE, "Video", PW_KEY_MEDIA_CATEGORY, "Capture",
						       PW_KEY_MEDIA_ROLE, "Screen", NULL));
		pw_stream_add_listener(S.in, &S.in_listener, &in_events, NULL);
		uint8_t buf[4096];
		struct spa_pod_builder b = SPA_POD_BUILDER_INIT(buf, sizeof(buf));
		const struct spa_pod *p = build_in_format(&b);
		int r = pw_stream_connect(S.in, PW_DIRECTION_INPUT, S.node, PW_STREAM_FLAG_AUTOCONNECT, &p, 1);
		if (r < 0) {
			fprintf(stderr, "pw_stream_connect: %s\n", spa_strerror(r));
			request_quit("cast not connectable");
		}
		stage("pw-connect");
	}

	S.t_start = S.t_tick = S.last_in = now();
	getrusage(RUSAGE_SELF, &S.ru_tick);
	if (S.source == 'c')
		clip_run();
	else
		worker_run();

	fprintf(stderr, "quit: %s\n", S.quit_reason[0] ? S.quit_reason : "signal");
	// the cast ended by itself (the window closed): mincord ends the stream instead of falling back
	if (!strcmp(S.quit_reason, "cast closed"))
		info("{\"type\":\"ended\",\"reason\":\"cast closed\"}");
	else if (strcmp(S.quit_reason, "stopped") && strcmp(S.quit_reason, "stdin closed") && strcmp(S.quit_reason, "--seconds"))
		info("{\"type\":\"error\",\"message\":\"%s\"}", S.quit_reason[0] ? S.quit_reason : "terminated");
	struct rusage ru;
	getrusage(RUSAGE_SELF, &ru);
	double el = now() - S.t_start;
	char eng[512];
	gpu_ms(eng, sizeof(eng), S.total_sub);
	fprintf(stderr, "total: %.1f s, in %lu frames, processed %lu, encoded %lu (%.2f ms each), cpu %.1f%% (%.2f ms per frame)\n",
		el, S.total_in + S.n_in, S.total_sub, S.total_enc, S.total_enc ? S.ms_enc_total / S.total_enc : 0,
		ru_sec(&ru) / el * 100, S.total_sub ? ru_sec(&ru) * 1e3 / S.total_sub : 0);
	fprintf(stderr, "gpu: busy ms:%s\n", eng[0] ? eng : " (no drm-engine-* in fdinfo)");
	if (S.ivf) {
		ivf_header();
		fclose(S.ivf);
	}
	ring_destroy();
	pw_thread_loop_unlock(S.tl);
	pw_thread_loop_stop(S.tl);
	if (S.in)
		pw_stream_destroy(S.in);
	if (S.core)
		pw_core_disconnect(S.core);
	pw_context_destroy(S.ctx);
	pw_thread_loop_destroy(S.tl);
	drop_surfaces();
	preview_destroy();
	if (S.va_cfg != VA_INVALID_ID)
		vaDestroyConfig(S.va, S.va_cfg);
	if (S.va)
		vaTerminate(S.va);
	cast_stop();
	pw_deinit();
	return 0;
}
