# screen-capture

cordial's Go Live source: screen sharing whose in-game cost stays around 1 % on a single GPU. A native `capture`
process takes the screen cast as DMA-BUFs, scales it on the GPU and encodes AV1 there through VA-API, so only the
bitstream leaves VRAM. Discord's own Go Live sender (Chromium's WebRTC, with DAVE encryption) then sends those frames
in place of its own encode ("the swap"). Where that can't run, there are fallbacks (below).

Status: Go Live through `capture` on niri and on any desktop's ScreenCast portal, with the shared app's sound on niri.
In game: +0.5 % frame time, within noise (Witcher 3 at 3840x2160 on an RX 9070 XT, capture encoding 1440p60 AV1).
`capture/` builds with `nix build .#capture`, or `cargo build --release` in the dev shell.

## Paths

| Path | What |
|---|---|
| zero-copy (default) | `capture` encodes AV1 in VRAM; the renderer swaps its frames into the Go Live sender in front of DAVE |
| raw | for calls in another codec (a stock viewer makes the call VP9) or a GPU without AV1 encode: `capture` scales into NV12 surfaces and hands them over as DMA-BUFs; Electron's `sharedTexture` imports them and Chromium encodes, reading each frame back (VP9 1080p60: about 1.7 cores) |
| fallback | Chromium's own capture through the portal (no `capture` binary, or `capture` died) |

## Layout

| Path | What |
|---|---|
| `capture/` | the native capture and encode process, in Rust (a port of castscale, the Equibop work's C, renamed) |
| `addon/` | Node addon for Electron's main process: a socketpair whose messages carry fds (`fdsock`), for the raw path |
| `src/main/` | main-process side: starting `capture`, its protocol, the portal's sources, raw's imports, the stream log |
| `src/preload/` | raw's frames into the page |
| `src/renderer/` | renderer side: the cast session and its track, the swap, rate and padding, stream quality rules, AV1 receiving under DAVE, a watched stream's health |

cordial uses it through `src/` (the shell starts `capture`, the adapter routes `getDisplayMedia` and the Go Live
sender); the Go Live UI is cordial's (Share Your Screen and the stream's status in the voice panel, watching in the
call view). It's tested on a loopback bench set up like Discord's Go Live (with a DAVE stand-in) and in calls between
test accounts; that tooling is local.
