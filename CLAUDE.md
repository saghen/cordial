# cordial

cordial renders Discord on Discord's own core: it loads Discord's web client in a small Electron shell, keeps the core
(stores, actions, gateway, REST, voice) running, and replaces the React UI with a small, fast Solid renderer.
Performance is the point: interaction latency first, then memory and CPU. README.md has the design and the file map.

User-specific setup (accounts, the lab on this machine, the plan, decisions and status) lives in the git-ignored
`ai/`: @ai/CLAUDE.md

## Build and check

```sh
npm run build        # Vite lib build into dist/cordial.js (npm run watch to rebuild on change)
npm run check        # tsc over src and screen-capture/src (the shell's .js isn't checked)
npm run format       # prettier (config in package.json)
nix build            # the package: the build and nixpkgs' Electron; update npmDepsHash when package-lock.json changes
```

`global-keybinds/`, `game-detection/` and `screen-capture/capture/` are Rust crates built by the flake.

## How a feature is built

1. **adapter/api**: bind the stores and action creators it needs (`src/adapter/needs.ts`, checked at startup by the
   self-check); recreate any trigger Discord keeps inside its UI components (member list subscriptions, acks, older
   history, scroll position reports) in `src/api/`.
2. **Renderer**: the component, styled from the tokens in `src/app.css`.
3. **Verify against stock**: the same scripted scenario against stock Discord, diffing what each sends (gateway frames,
   REST requests and bodies, Flux dispatches). Every difference is either fixed or deliberate and written down. What
   our renderer sends must stay what the official client sends.
4. **Budgets** (main-thread work, measured): a warm channel, server or DM switch ≤ 20 ms (input to paint ≤ 35 ms), a
   popout or menu ≤ 8 ms, a key press in the composer ≤ 8 ms, idle ≤ 2 ms/s, JS heap after GC ≤ 95 MB, DOM nodes in a
   channel view ≤ 3,000 (a rough guide), no long frames while scrolling. Stock takes 230-290 ms for a switch.

## Code

- **A rough outline of Discord, not a 1:1 copy, with as little code as possible.** One element per row or item; CSS
  does the layout (one grid, subgrids, named areas, anchor positioning, `::before`/`::after` for decoration,
  attributes as state); one shared row abstraction.
- **Clarity beats line count**: a refactor is judged by whether the code is easier to reason about (one place per
  pattern, scoped rules, data over repeated markup). Code quality first, optimize later; the budgets still apply.
  Don't over-comment. Pin packages at least two weeks old.
- **Layers**: `src/adapter/` is the only code that touches Discord internals (webpack, the needs list, `S`/`A`, the
  self-check, patches; no Solid). `src/api/` is what the UI calls: every store read and action goes through it, with
  stock's rules, sequences, triggers, strings and dates. `src/primitives/` render from props and never import `api/`;
  `src/components/` are Discord-aware pieces; `src/views/` are the grid's regions, mounted once by `app.tsx`. Views,
  components and primitives never import `adapter/`. A piece used by two or more views goes in primitives or
  components; each has its `.css` beside it.
- **api modules** are imported as namespaces (`import * as channels from '../api/channels'`; `channels.unread(c)`).
  Arguments are what the view holds (channels, guilds, messages as records; users as ids). Return typed records
  (`api/types.ts`) on hot paths, not objects rebuilt in a memo. Reads go through `$` (`api/store.ts`) so they're
  reactive; `use*` hooks create effects and run in components; each wrapper names the stock store or action it calls.
- **Text** comes from stock's intl through `api/strings.ts` by message name (keys are hashes of the names, stable across
  builds); text stock lacks is marked as ours there. No text in CSS. Dates use stock's DateUtils formats.
- **Markup**: a class for what an element is (`.channel`, `.self-mute`), `data-id` for which one, an id only for the
  few looked up by it (popover targets, `#mc-composer`). No test-hook attributes: scripts find elements by the names the
  stylesheet uses. Names that collide with state classes (`.mute`, `.call`) stay element-qualified. No id selectors in
  CSS.
- **CSS**: each file is joined by layer (app.css, primitives, components, views) into one `<style>` scoped under our
  root. Scope a file to its root class; `@scope` only for donuts (`@scope (.message) to (.markdown)`). No selectors by
  position, no magic-number placement. Colours from tokens (`color-mix` for tints); `--surface` for anything that must
  match what's behind it. Stock's font sizes. Discord's own stylesheets leak globals (its reset, `body { user-select:
  none }`, `.emoji` at 22 px): don't reuse Discord's class names, and give selectable text `user-select: text`.
- **Solid 2 (RC)**: memos, `class` objects or arrays, Show/For, split `createEffect(compute, apply)`; no `batch`, `on`
  or `classList` (`node_modules/solid-js/CHEATSHEET.md`). `createEffect`'s apply runs on every re-run even with an equal
  value: put a memo between. Signal writes apply in a microtask; memos over `$` update a microtask after a dispatch.
  `$`'s signals use `ownedWrite: true` (a dispatch during a render throws in dev otherwise).

## Discord's core

- The anchor patch (`src/adapter/anchor.ts`) keeps Discord's App class mounted (its `componentDidMount` starts the
  session and ~60 managers) and replaces only its `render()`. A broken find falls back to Discord's own UI and the
  console names the missing need.
- `S`/`A` resolve at the App's first render: never use them at module top level.
- Discord deletes `localStorage`: flags that must survive a reload go in `window.name` (`cordial:stock` shows stock's
  UI in our shell, for comparing).
- Module ids change between builds: find modules by a code string, stores by name. Minified exports are found by their
  code (`mangled()` in `src/adapter/needs.ts`). Patches (`patch()` in `src/adapter/webpack.ts`) apply all-or-nothing,
  only to the entry bundle.
- Code that loads only with stock's UI (lazy chunks: pins, search, pickers, the chat input) is read in stock mode and
  ported, or its requests replayed through the REST client.
- `window.cordial` (`src/api/lab.ts`) exposes the adapter and ours to scripts over CDP.

## Rules

- Never print, log or commit `.env` or a login token; gateway frames carry the token.
- Anything that writes to Discord (sending, reacting, typing, voice, invites, settings) runs on a test account in its
  own profile, never on a real person's account, and never messages real people.
- Stop processes you started by their pid, never by pattern (`pkill -f`, `killall electron`).
- Screen sharing is `screen-capture/` (Go Live through its own capture binary); it has its own docs and session.
