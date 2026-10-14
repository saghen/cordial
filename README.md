# cordial

A fast, minimal Discord client for Linux, with a new UI built on Discord's core.

- **Screen sharing:** Matches or exceeds Windows' quality (Hardware AV1, CPU VP9 fallback, ~1% overhead on niri)
- **Rich game presence:** Using a shim for Discord's official IPC
- **Global keybinds:** Push to talk, mute, go live, ... on wayland
- **Debloated:** No store, nitro, games (activities), gift button, ...
- **Minimal:** -70% cpu usage, -20% RAM usage (still high, ideas welcome!)
- **Fast:** <20ms click latency for all actions

Run with `nix run`

## How it works

Discord's web client keeps its logic (stores, actions, the gateway, REST, voice) separate from the React UI. Cordial loads the official client, leaving the core untouched, and swaps the UI for our own. Similar to Equibop/Vesktop, we provide shims for improved screen sharing, rich presence, and global keybinds. All three are written from scratch for Cordial, not forked from Equibop or Vesktop.

- **Renderer:** SolidJS + plain CSS
- **API:** abstraction layer between renderer and adapter, to avoid logic in the renderer
- **Adapter:** typed stores by name, actions, and triggers to use Discord's UI
- **Discord's core:** stores, actions, gateway, REST, voice: untouched, so traffic stays identical to the official client
- **Native helpers:** Rust programs that fill in for Discord desktop's native modules: screen capture, game detection/rich presence and global keybinds

## Dropping Electron

Going native would mean rewriting the entire core of Discord. Much of Discord's API is documented by the community or officially in the bot API docs. However, the state logic does not have documentation, and would have to be determined from the Discord source (permissions, unreads, caching, subscriptions, e2ee voice, ...), and traffic would no longer look like the official client. The potential simplicity of the screen share stack alongside a natively rendered UI though...

- [freya](https://github.com/marc2332/freya): UI framework
- [discord-user-rs](https://github.com/lengoclongk59/discord-user-rs): text/user account support
- [Songbird](https://github.com/serenity-rs/songbird): voice support
  - [Serenity](https://github.com/serenity-rs/serenity): text support which songbird is built on. can we use songbird on discord-user-rs?

## AI Usage

The original idea came after exploring the Equicord and Vencord projects, seeing how they hooked into the core's stores and actions. Afterwards, I wrote the core adapters, screen sharing scaffold, file structure, feature list/behavior, and so on myself. The core along with a style guide and hand-written plan was passed off to an AI to iterate on. The first draft of this project was written by AI, with extensive human guidance. This project was meant to be a learning experiment for myself, I never intended to release the results. Since then, I've taken over the project slowly working through all of the UI code, but this work is on-going. The screen capture, global keybinds and game detection crates will remain AI-only for the time being, as I don't have the time to deep dive into them yet.
