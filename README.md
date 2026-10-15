<h2 align="center">Cordial</h2>

<p align="center">
  Fast, minimal Discord client for Linux, with a custom UI built on the official core
</p>

**Cordial** loads the official client, leaving the core untouched, and swaps the UI for our own. We can do this because Discord's web client keeps its logic (stores, actions, the gateway, REST, voice) separate from the React UI. Similar to Equibop/Vesktop, we provide shims for improved screen sharing, rich presence, and global keybinds. All three are written from scratch for Cordial, not forked from Equibop or Vesktop.

- **Screen sharing:** Matches or exceeds Windows' quality (hardware AV1, CPU VP9 fallback, ~1% overhead on niri)
- **Rich game presence:** Using a shim for Discord's official IPC
- **Global keybinds:** Push to talk, mute, go live, ... on Wayland
- **Debloated:** No store, nitro, games (activities), gift button, ...
- **Light:** -70% CPU usage, -20% RAM usage (still high, ideas welcome!)
- **Fast:** <20ms click latency for all actions

Unlike my other projects, this project has been entirely vibe-coded, use at your own risk!

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
- [songbird](https://github.com/serenity-rs/songbird): voice support, including E2EE via DAVE

### AI Usage

The original idea came after exploring the Equicord and Vencord projects, seeing how they hooked into the core's stores and actions. Afterwards, I wrote the adapters, screen sharing research, file structure, feature list, and behavior myself. Since then, this project has been entirely vibe-coded and will remain this way. It's a learning experiment and I never intended to release the results. Please note that unless stated otherwise, my projects are written entirely by hand (blink.cmp, blink.pairs, frizbee, ...).
