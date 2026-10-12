# mincord

Discord UI renderer built on top of discord's existing core.

Discord's desktop client is a React UI over a large JavaScript core: 564 Flux stores, action creators, the gateway
and REST clients, and Chromium's WebRTC for voice. mincord keeps that core running inside Discord's own Electron app
(Equibop) and replaces the React UI with a small, fast renderer of our own. Performance is the point: interaction
latency first, then memory and CPU. Screen sharing uses a custom backend that lives in its own repo.

## Why this can work

Measured in the lab (`atlas/data/`, stock Equibop 3.2.2, Discord stable, October 2026):

| | Stock Discord | Core only, no UI |
|---|---|---|
| Main-thread work for a warm channel switch | 230-290 ms | 8 ms |
| Main-thread work during startup | 5.9 s | 2.9 s |
| Idle main thread | 1.6-13 ms/s | 1.0 ms/s |
| JS heap after GC | 114 MB (171 MB after a session) | 84 MB |
| Renderer process memory | 424 MB (612 MB after a session) | 359 MB |
| DOM nodes | 5,800 | 1,350 |

Nearly all of the cost of an interaction is the UI. The core with no UI attached still connects, syncs and keeps the
same data (same guilds, DMs, friends and presences).

Targets for the renderer: cached switches in 1-2 frames (15-25 ms at 144 Hz), popouts and menus in one frame, typing
painted in the same frame, ~1 ms/s idle, 70-90 MB heap. The whole app only shrinks 10-20 %: Electron's other
processes (~700 MB) stay, and going below that means leaving Electron (see future ideas).

## How it fits together

```
Our renderer          own components, own small stylesheet, no Discord CSS
   ↕
Adapter               typed access to stores by name, action creators by code string,
                      and the triggers Discord keeps in its UI (subscriptions, fetches, acks)
   ↕
Discord's core        stores, actions, gateway, REST, voice: untouched, so traffic stays identical to the official client
   ↕
Anchor patch          Discord's root App component stays mounted (it starts the session and ~60 managers);
                      only its render is replaced with ours
```

What makes it fragile, and what keeps it in check, is in [ROADMAP.md](ROADMAP.md#robustness). In short: stores and
dispatch action types are stable, action creators need occasional new finds, and behaviour that Discord keeps inside
its UI is caught by diffing what our renderer sends against stock Discord for the same scripted scenario.

## Planning

- **Feature map**: https://claude.ai/artifact/VfUwXYd3rQ3yiEBPRJ7KDx, every feature of the client as a tree with
  measured element counts, backing stores, and a phase (1-4 or not included) and note per item. It is the source of
  truth for scope.
- `atlas/plan.md`: the map's saved plan rendered per phase (`python3 atlas/scripts/plan_report.py atlas/plan-export/plan`).
- [ROADMAP.md](ROADMAP.md): Phase 0 (foundations), how phases 1-4 are built, budgets, open decisions.
- [LOG.md](LOG.md): what each work session did, measured and decided; open questions at the top.
- [CLAUDE.md](CLAUDE.md): how agents work on this repo (the iteration loop and its rules).

## Layout

| Path | What |
|---|---|
| `atlas/` | the feature map (`feature-map.html`), its data (element counts, stores, enums), the saved plan, and the CDP scripts that measured them |
| `adapter/` | the only code that touches Discord internals: `anchor.ts` keeps Discord's App class and renders our root, `core.ts` resolves what we use (`S`, `A`) and checks it at startup, `triggers.ts` does what Discord's UI did for the core |
| `renderer/` | the UI; `index.ts` is the entry Equibop imports |
| `nix/` | `equibop.nix`: stock Equibop with `adapter/` and `renderer/` built in |
| `lab/` | test account login and server setup, scenarios, the conformance recorder (`conformance.py`), the budget runner (`budgets.py`), measurements (`lab/data/`) |

The lab harness itself (isolated headless Equibop, CDP client, input-driven benchmarks) lives in
`~/code/personal/discord-uiprof`; mincord's scripts import its `cdp.py` and `bench.py`.

## Test accounts

Anything that writes (sending, reacting, typing, voice, invites) runs on the test account in `.env` (`USERNAME`,
`EMAIL`, `PASSWORD`; git-ignored), in its own lab profile. The main account is only ever used read-only, through a
copied profile that stays out of the repo.

## Possible future ideas

- [freya](https://github.com/marc2332/freya): UI framework
- [discord-user-rs](https://github.com/lengoclongk59/discord-user-rs): text/user account support
- [Songbird](https://github.com/serenity-rs/songbird): voice support
  - [Serenity](https://github.com/serenity-rs/serenity): text support which songbird is built on. can we use songbird on discord-user-rs?

Leaving Electron means owning the protocol: the bot API is documented and much of the user API is documented by the
community, but the state logic in Discord's stores (permissions, unreads, caching, member list subscriptions,
end-to-end encrypted voice) is not, and traffic would no longer match the official client.
