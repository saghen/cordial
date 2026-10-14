# cordial

Discord UI renderer built on top of discord's existing core.

Discord's desktop client is a React UI over a large JavaScript core: 564 Flux stores, action creators, the gateway
and REST clients, and Chromium's WebRTC for voice. cordial loads Discord's web client (discord.com/app) in a small
Electron shell of our own, keeps that core running, and replaces the React UI with a small, fast renderer. Performance
is the point: interaction latency first, then memory and CPU. Screen sharing uses a custom backend that lives in its own repo.

## Why this can work

Measured in the lab (stock Equibop 3.2.2, Discord stable, October 2026):

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
shell is ~515 MB (PSS with its swapped share) against stock Equibop's ~620, of which arRPC is 94;
Electron's other processes (~280 MB) stay. Phase 3 trims them; Tauri was ruled out (no Discord voice in
WebKitGTK yet, no CDP for the lab, no memory gain).

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

What makes it fragile, and what keeps it in check (from Vencord's core-access history, Oct 2024 - Oct 2026: 21 commits
to store access and 34 to core utilities, against 750 plugin commits):

| Layer | Stability | Expected breakage | Mitigation |
|---|---|---|---|
| Stores by name, their methods, dispatch action types | high | 1-2 a year (roles moved from GuildStore to GuildRoleStore) | startup self-check |
| Action creators | medium | 4-6 small find fixes a year, around Discord's big updates | finds by code string, self-check after each update |
| Behaviour Discord keeps in its UI (session start, managers, subscriptions, fetches, acks, typing) | low, failures silent | divergence rather than crashes | keep the App class (anchor), diff what we send against stock per scenario |
| Discord CSS and class names | none | | own stylesheet |

If a find breaks after a Discord update, Discord's own UI shows instead and the console names what's missing.

## Working on it

[CLAUDE.md](CLAUDE.md) is the guide: build and check commands, how a feature is built and verified against stock, the
performance budgets, and the code conventions.

## Layout

| Path | What |
|---|---|
| `src/shell/` | the Electron shell: `main.js` opens discord.com/app (zoom, `<userData>/config.json`), `preload.js` injects `dist/cordial.js` before Discord's scripts run, with the config as `cordial.config` |
| `src/adapter/` | the only code that touches Discord internals: `webpack.ts` hooks Discord's webpack (its require, module search, source patches), `anchor.ts` keeps Discord's App class and renders our root, `needs.ts` resolves what we use (`S`, `A`) and checks it at startup, `discord.ts` types them |
| `src/api/` | what the UI calls (conventions in `CLAUDE.md`): `store.ts` (Discord's stores as Solid dependencies), `records.ts` (its records, typed as far as we read them), `strings.ts` (stock's text by message name, its date formats), `hooks.ts` (onAction, useNow, useFileDrop), `session.ts` (connection, badge, login), `users.ts` (names, avatars, presence), `guilds.ts` (icons, folders, invites), `channels.ts` (the channel list, DMs, read and mute states, voice channels), `notifications.ts` (the bell's rules), `messages.ts` (the list, grouping, jumps, reactions, pins, the menu's actions), `pickers.ts` (emoji images, reactions, the pickers' sections, searches and GIFs), `search.ts` (message search), `composer.ts` (useComposer: the box's state and stock's send, edit, draft and upload actions; who's typing; autocomplete's queries), `voice.ts` (voice states, the connection, join and leave), `audio.ts` (mute, deafen, camera, devices, voice settings), `calls.ts` (DM calls, ringing), `streams.ts` (Go Live, videos), `sounds.ts` (stock's voice sounds, the ringtone), `soundboard.ts` (its sections, search, play), `members.ts` (the member list's rows and subscriptions), `cdn.ts`, `triggers.ts` (what Discord's UI did for the core), `preload.ts` (channels loaded before they open), `lab.ts` (`window.cordial` for lab scripts) |
| `src/primitives/` | generic pieces, each with its `.css`: `icon.tsx` (Discord's icons, `icons.ts`, as CSS masks), `button.tsx` (Button, IconButton, Toggle), `badge.tsx`, `status.tsx`, `row.tsx` (list rows), `menu.tsx` (menus as data, submenus, context menus, `menu.css`), `popout.tsx`, `modal.tsx`, `search.tsx`, `fields.tsx`, `sections.tsx` (a picker's search, rail, sections and footer) with `lazy_chunks.tsx` |
| `src/components/` | Discord-aware pieces: `message/` (a message row: head, content, attachments, embeds, reactions), `markdown.tsx` (markdown AST to DOM), `media.tsx` (images, videos, GIFs), `viewer.tsx` (an image full size), `emoji.tsx`, `pickers.tsx` (emoji, GIF, sticker), `time.tsx` (a message's time, stock's formats), `avatar.tsx`, `name.tsx`, `guild_icon.tsx`, `channel_icon.tsx`, `dm_icon.tsx`, `tile.tsx` (someone in a call), `video.tsx` |
| `src/views/` | a file per region of the grid: `server_bar.tsx`, `channels.tsx` (channel and DM lists, voice rows, the channel menu), `chat.tsx` (messages, their menu, who's typing) with `scroller.ts`, `header.tsx`, `composer.tsx` (the reply bar, uploads, the box, autocomplete), `user_panel.tsx` (account, status, mute/deafen, voice panel), `call.tsx`, `members.tsx`, `login.tsx` |
| `src/app.tsx`, `src/app.css`, `src/index.tsx` | the grid and the CSS join (every `.css` under `src/`, by layer), the shell's CSS, the entry (UI in Solid 2, JSX compiled by Vite, `npm run build` into `dist/cordial.js`) |
| `boundary.mjs` | the layer boundary, run by `npm run check`: views, components and primitives never import `adapter/`, primitives no `api/` |
| `global-keybinds/` | config.json's global keybinds through the desktop's GlobalShortcuts portal, presses and releases (push to talk), for the shell |
| `flake.nix` | the package (Vite build, nixpkgs' Electron) and a dev shell |

Testing happens in a lab outside this repo: isolated headless Electron instances driven over CDP, running scripted
scenarios against cordial and stock Discord side by side (what each sends, diffed), the budgets, and screenshots.

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
