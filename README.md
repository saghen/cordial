<h2 align="center">Cordial</h2>

<p align="center">
  Fast, minimal Discord client for Linux, with a new UI built on top of the official core.
</p>

**Cordial** loads the official client, leaving the core untouched, and swaps the UI for our own. We can do this because Discord's web client keeps its logic (stores, actions, the gateway, REST, voice) separate from the React UI. Similar to Equibop/Vesktop, we provide shims for improved screen sharing, rich presence, and global keybinds. All three are written from scratch for Cordial, not forked from Equibop or Vesktop.

- **Screen sharing:** Matches or exceeds Windows' quality (hardware AV1, CPU VP9 fallback, ~1% overhead on niri)
- **Rich game presence:** Using a shim for Discord's official IPC
- **Global keybinds:** Push to talk, mute, go live, ... on Wayland
- **Debloated:** No store, nitro, games (activities), gift button, ...
- **Light:** -70% CPU usage, -20% RAM usage (still high, ideas welcome!)
- **Fast:** <20ms click latency for all actions

### Install

```sh
nix run github:saghen/cordial
```

Or add it to your system from your flake:

```nix
inputs.cordial.url = "github:saghen/cordial";
# ...
environment.systemPackages = [ inputs.cordial.packages.x86_64-linux.default ];
```

### Dropping Electron

Going native would mean rewriting the entire core of Discord. Much of Discord's API is documented by the community or officially in the bot API docs. However, the state logic does not have documentation, and would have to be determined from the Discord source (permissions, unreads, caching, subscriptions, e2ee voice, ...), and traffic would no longer look like the official client. The potential simplicity of the screen share stack alongside a natively rendered UI though...

- [freya](https://github.com/marc2332/freya): UI framework
- [discord-user-rs](https://github.com/lengoclongk59/discord-user-rs): text/user account support
- [Songbird](https://github.com/serenity-rs/songbird): voice support
  - [Serenity](https://github.com/serenity-rs/serenity): text support which songbird is built on. can we use songbird on discord-user-rs?

### AI Usage

The original idea came after exploring the Equicord and Vencord projects, seeing how they hooked into the core's stores and actions. Afterwards, I wrote the adapters, screen sharing research, file structure, feature list, and behavior myself, then handed them to an AI along with a style guide and plan. It wrote the first draft of the project, under careful guidance.

This project started as a learning experiment, I never intended to release the results. Since then I've been rewriting the all of the UI code by hand, but this is ongoing. The screen capture, global keybinds and game detection crates will remain AI-written for now, as I don't have the time to deep dive into them yet.
