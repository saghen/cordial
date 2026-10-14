# cordial

Performant, minimal Discord UI rewrite on top of the official core for Linux.

- **Screen-sharing:** Matches or exceeds Windows' quality (Hardware AV1, CPU VP9 fallback, ~1% overhead on niri)
- **Rich game presence:** Using a shim for Discord's official IPC
- **Global keybinds:** Push to talk, mute, go live, ... on wayland
- **Debloated UI:** No store, nitro, games (activities), gift button, ...
- **Minimal:** -80% cpu usage, -20% RAM usage (still high, ideas welcome!)
- **Fast:** <20ms click latency for all actions

Discord's desktop/web client separates the core form the UI, where the core's read-only stores and actions containing the actual logic. As a result, we can intercept the loading of the primary UI and replace it with our own SolidJS based UI. Similar to Equibop/Vesktop, we can also provide shims for improved screen sharing, rich presence, and global keybinds.

```
Our renderer          SolidJS + CSS core
   ↕
Adapter               typed stores by name, actions, and triggers to use Discord's UI
   ↕
Discord's core        stores, actions, gateway, REST, voice: untouched, so traffic stays identical to the official client
   ↕
Anchor patch          Discord's render replaced with ours
```

Run with `nix run`

## Possible future ideas

Going native would mean rewriting the entire core of Discord. Much of the API is documented by the community or officially in the bot API docs. However, the state logic does not have documentation, and would have to be determined from the Discord source (permissions, unreads, caching, subscriptions, e2ee voice, ...), and traffic would no longer look like the official client. The potential simplicity of the screen share stack with a natively rendered UI though...

- [freya](https://github.com/marc2332/freya): UI framework
- [discord-user-rs](https://github.com/lengoclongk59/discord-user-rs): text/user account support
- [Songbird](https://github.com/serenity-rs/songbird): voice support
  - [Serenity](https://github.com/serenity-rs/serenity): text support which songbird is built on. can we use songbird on discord-user-rs?
