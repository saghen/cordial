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
npm run lint         # oxlint (config in .oxlintrc.json)
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
- **Names** are words: `channel`, `message`, `selected`, `category`, `hidden`, not `c`, `m`, `sel`, `cat`, `hid`.
  Single letters only for `$`, props `p`, an event `e`, an index `i`, an unused `_`, `A`/`S`/`G` and type parameters;
  a short form only where it's universal (`id`, `prev`, `ms`, `px`, `opts`). Props too. Module-level fixed data is
  CONSTANT_CASE. Don't shadow built-ins (`Message as Record`). Literals get a name: an enum member or a constant
  (`MessageType.Reply`, `DAY_MS`).
- **Expressions**: `Boolean(x)` over `!!x`; `??` for defaults, `||` only where empty strings or 0 fall through too. One
  declaration per `const`/`let`. No nested ternaries, no comma operator, no assignment used as a value, no negated
  comparison (`a >= b`, not `!(a < b)`). A ternary where `if (cond) return value` reads simpler becomes that. Few `!`
  assertions: narrow with a check where it's cheap. An effect's source returns an object, not a tuple.
- **Functions**: an arrow for one expression (`const id = (m: Message) => m.id`, `copy: (url) => invoke(url)`), a
  `function` declaration or method shorthand for anything longer (`function startsGroup(...) {}`, `find(e) {}`).
- **Types**: `any` stays in `src/adapter/`; the rest sees typed records. A global from the shell or Discord is cast
  once, where it's read. No `console.log`: `console.warn`/`console.error` for what a user should see in the console.
- **Tooling**: `npm run format` (prettier) and `npm run lint` (oxlint's recommended rules plus the above, in
  `.oxlintrc.json`) before committing.
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

## Commits

`scope: description`, one scope per commit:

| Scope | Covers |
|---|---|
| `ui(guilds)` | the server bar: servers, folders, the server menu, Add a Server, invites |
| `ui(channels)` | channel and DM lists, categories, the channel menu, voice channel rows |
| `ui(header)` | the top bar: name, topic, the bell, pins, search |
| `ui(chat)` | the message list and messages: history, scrolling, acks, jumps, the NEW line, the message menu, markdown, embeds, attachments, reactions, the media viewer |
| `ui(composer)` | the message box: send, edit, drafts, typing, uploads, autocomplete, the reply bar, the pickers |
| `ui(members)` | the member list |
| `ui(voice)` | the voice connection and panel: mute, deafen, devices, voice settings, sounds, the soundboard |
| `ui(call)` | the call view: tiles, DM calls, camera, watching streams |
| `ui(account)` | the user panel, status, login |
| `ui(components)` | shared primitives and components |
| `ui` | across regions: the root grid, tokens, base CSS |
| `core(adapter)` | webpack, the needs list, the self-check, patches |
| `core(api)` | api changes with no UI change: the store bridge, triggers, strings, dates, `window.cordial` |
| `core(shell)` | the Electron main process and preload |
| `capture(src)` | the capture binary's sources: the PipeWire and niri casts, the portal, the clip, app audio |
| `capture(enc)` | the capture binary's encoding: VA-API, AV1, sizes, quality, SSIM |
| `capture(live)` | `screen-capture/src/` and `addon/`: Go Live in the app (the cast session, the zero-copy swap, receive hooks, rate and quality, the picker and status panel, the stream log) |
| `capture` | `screen-capture/` across those, and the binary's startup and protocol (`main.rs`, `out.rs`) |
| `keybinds` | `global-keybinds/` |
| `presence` | `game-detection/`: game detection, Rich Presence, the Wine bridge |
| `build` | `flake.nix`, Vite, tsconfig, package.json, prettier |
| `refactor` | a refactor across scopes (a restructure, a simplification pass); one inside a scope takes that scope |
| `docs` | README, CLAUDE.md |

- **Scope by what the user sees**: a change to the UI takes its `ui(...)` scope even when most of the diff is in
  `src/api/`. Two scopes that really move together: `ui(chat|composer)`; more, split the commit.
- **The description**: short (around 40 characters, 72 at most), lowercase, starting with a verb that says what kind
  of change it is (add, fix, drop, move, rework, swap, speed up), never a bare topic; identifiers in backticks.
  `ui(chat): fix the jump button covering the last message`, `capture: default the AV1 quantizer floor to 50`,
  ``core(adapter): find `fetchMessages` by its code``.
- **The body** whenever there are numbers (budgets, memory, conformance), and otherwise when the why isn't obvious:
  what changed, how it was checked, the numbers with how they were measured. No references to git-ignored files,
  plans or their numbering (phases, slices, questions), and no personal names.

## Rules

- Never print, log or commit `.env` or a login token; gateway frames carry the token.
- Anything that writes to Discord (sending, reacting, typing, voice, invites, settings) runs on a test account in its
  own profile, never on a real person's account, and never messages real people.
- Stop processes you started by their pid, never by pattern (`pkill -f`, `killall electron`).
- Screen sharing is `screen-capture/` (Go Live through its own capture binary); it has its own docs and session.
