# screen-capture

cordial's Go Live source: screen sharing whose in-game cost stays around 1 % on a single GPU. A native `capture`
process takes the screen cast as DMA-BUFs, scales it on the GPU and encodes it there (AV1 or H.264 through VA-API),
so only the bitstream leaves VRAM. Discord's own Go Live sender (Chromium's WebRTC, with DAVE encryption) then sends
those frames in place of its own encode ("the swap"). Where that can't run, there are fallbacks (below).

Status: P1-P3 done (the C port, the Rust port, Rust chosen); P4 (the portal source, H.264, the fallback) next.
`capture/` builds with `nix build .#capture`, or `cargo build --release` in the dev shell.
Plan, state and the work loop are in `ai/`.

## Paths

| Path | What |
|---|---|
| zero-copy (default) | `capture` encodes in VRAM; the renderer swaps its frames into the Go Live sender in front of DAVE. Measured in the Equibop lab: +0.6-1.0 % frame time in game (Witcher 3, RX 9070 XT, 1440p60 AV1) |
| fallback | `capture` scales into NV12 surfaces and hands them over as DMA-BUFs; Electron's `sharedTexture` imports them into a `MediaStreamTrackGenerator`, and Chromium encodes in any codec (VP9 included), reading each frame back. Measured: GPU process 17 % CPU, renderer 12.5 % (1080p60) |
| last resort | Chromium's own capture through the portal (no `capture` binary, no VA-API) |

## Layout

| Path | What |
|---|---|
| `capture/` | the native capture and encode process, in Rust (a port of castscale, the Equibop work's C, renamed) |
| `addon/` | Node addon for Electron's main process: a socketpair whose messages carry fds (`fdsock`), for the fallback path |
| `src/main/` | main-process side: starting `capture`, its protocol, relaying frames to the renderer |
| `src/renderer/` | renderer side: the cast session and its track, the swap, rate and padding, stream quality rules |
| `lab/` | the bench (a loopback RTCPeerConnection set up like Discord's Go Live, with a DAVE stand-in) and its scripts |
| `ai/` | `PLAN.md` (goals, decisions, phases, sources), `LOG.md` (state, finds, questions), `LOOP.md` (how an iteration runs), `crates.md` (the Rust crate research) |

cordial uses it through `src/` (the shell starts `capture`, the adapter routes `getDisplayMedia` and the Go Live sender);
the Go Live UI is cordial's (Phase 4 of its plan).
