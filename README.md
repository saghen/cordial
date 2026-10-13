# mincord

Discord UI renderer built on top of discord's existing core.

Discord's desktop client is a React UI over a large JavaScript core: 564 Flux stores, action creators, the gateway
and REST clients, and Chromium's WebRTC for voice. mincord loads Discord's web client (discord.com/app) in a small
Electron shell of our own, keeps that core running, and replaces the React UI with a small, fast renderer. Performance
is the point: interaction latency first, then memory and CPU. Screen sharing uses a custom backend that lives in its own repo.

## Why this can work

Measured in the lab (`ai/atlas/data/`, stock Equibop 3.2.2, Discord stable, October 2026):

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
painted in the same frame, ~1 ms/s idle, 70-90 MB heap. The whole app only shrinks 5-20 %: on the test account our
shell is ~515 MB (PSS with its swapped share, `ai/lab/pss.py`) against stock Equibop's ~620, of which arRPC is 94;
Electron's other processes (~280 MB) stay. Phase 3 trims them; Tauri was ruled out (`ai/atlas/tauri.md`: no Discord
voice in WebKitGTK yet, no CDP for the lab, no memory gain).

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

What makes it fragile, and what keeps it in check, is in [ai/ROADMAP.md](ai/ROADMAP.md#robustness). In short: stores and
dispatch action types are stable, action creators need occasional new finds, and behaviour that Discord keeps inside
its UI is caught by diffing what our renderer sends against stock Discord for the same scripted scenario.

## Planning

- **Feature map**: https://claude.ai/artifact/VfUwXYd3rQ3yiEBPRJ7KDx, every feature of the client as a tree with
  measured element counts, backing stores, and a phase (1-4 or not included) and note per item. It is the source of
  truth for scope.
- `ai/atlas/plan.md`: the map's saved plan rendered per phase (`python3 ai/atlas/scripts/plan_report.py ai/atlas/plan-export/plan`).
- [ai/ROADMAP.md](ai/ROADMAP.md): Phase 0 (foundations), how phases 1-4 are built, budgets, open decisions.
- [ai/LOG.md](ai/LOG.md): open questions, the current state, key finds and decisions (the history is `git log`).
- [ai/CLAUDE.md](ai/CLAUDE.md): how agents work on this repo (the iteration loop and its rules).

## Layout

| Path | What |
|---|---|
| `src/shell/` | the Electron shell: `main.js` opens discord.com/app (zoom, `<userData>/config.json`), `preload.js` injects `dist/mincord.js` before Discord's scripts run, with the config as `mincord.config` |
| `src/adapter/` | the only code that touches Discord internals: `webpack.ts` hooks Discord's webpack (its require, module search, source patches), `anchor.ts` keeps Discord's App class and renders our root, `needs.ts` resolves what we use (`S`, `A`) and checks it at startup, `discord.ts` types them |
| `src/api/` | what the UI calls (being built, ai/RESTRUCTURE.md): `store.ts` (Discord's stores as Solid dependencies), `records.ts` (its records, typed as far as we read them), `strings.ts` (stock's text by message name, its date formats), `hooks.ts` (onAction, useNow, useFileDrop), `model.ts` (grouping, authors, names, permissions), `triggers.ts` (what Discord's UI did for the core), `preload.ts` (channels loaded before they open), `lab.ts` (`window.mincord` for lab scripts) |
| `src/primitives/` | generic pieces, each with its `.css`: `icon.tsx` (Discord's icons, `icons.ts`, as CSS masks), `button.tsx` (IconButton, Toggle), `menu.tsx` (menus as data, context menus) with `popover.ts`, `popout.tsx`, `modal.tsx`, `search.tsx`, `fields.tsx` |
| `src/components/` | Discord-aware pieces: `markdown.ts` (markdown AST to DOM), `embeds.tsx` (link embeds), `pickers.tsx` (emoji, GIF, sticker) |
| `src/views/` | a file per region of the grid: `server_bar.tsx`, `channels.tsx` (channel and DM lists, voice rows, the shared row), `chat.tsx` (messages and their menu) with `scroller.ts`, `header.tsx`, `composer.tsx` (box, edit mode, autocomplete), `user_panel.tsx` (account, status, mute/deafen, voice panel), `call.tsx`, `members.tsx`, `login.tsx` |
| `src/app.tsx`, `src/app.css`, `src/index.tsx` | the grid and the CSS join (every `.css` under `src/`), the shell's CSS, the entry (UI in Solid 2, JSX compiled by Vite, `npm run build` into `dist/mincord.js`) |
| `boundary.mjs` | the layer boundary, run by `npm run check`: views, components and primitives never import `adapter/`, primitives no `api/` |
| `global-keybinds/` | config.json's global keybinds through the desktop's GlobalShortcuts portal, presses and releases (push to talk), for the shell |
| `flake.nix` | the package (Vite build, nixpkgs' Electron) and a dev shell |
| `ai/` | what agents work from: `CLAUDE.md`, `LOG.md`, `ROADMAP.md` |
| `ai/atlas/` | the feature map (`feature-map.html`), its data (element counts, stores, enums), the saved plan, and the CDP scripts that measured them |
| `ai/lab/` | test account login and server setup, scenarios, the conformance recorder (`conformance.py`), the budget runner (`budgets.py`), the grouping check against stock (`grouping.py`), the login fallback check (`loggedout.py`), the older-history rule check (`older.py`), the status setter check (`status.py`), screenshots before and after a CSS change (`shots.py`, with `--diff`), the unattended build check (`buildcheck.py`, against the differences accepted in `expected.json`), measurements (`ai/lab/data/`) |
| `design/` | the Phase 1 design draft (`phase1.md`) and its mockup |

The lab harness itself (isolated headless Electron, CDP client, input-driven benchmarks) lives in
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
