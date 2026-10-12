/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entry point Equibop imports (nix/equibop.nix). Until the framework is chosen (ROADMAP 0.6) the root is a plain-DOM
// placeholder: who is connected and how much the core has synced, so a glance shows the core is alive.

import { findStore } from "@equicord/types/webpack";

import { setMount } from "../adapter/anchor";

const STORES = ["GatewayConnectionStore", "UserStore", "GuildStore", "SelectedChannelStore"];

setMount(host => {
    host.style.cssText =
        "position:fixed;inset:0;z-index:1;display:flex;flex-direction:column;gap:8px;padding:24px;" +
        "background:#1e1f22;color:#dbdee1;font:14px/1.4 system-ui,sans-serif";
    const title = document.createElement("div");
    title.textContent = "mincord";
    title.style.cssText = "font-size:20px;font-weight:600";
    const status = document.createElement("div");
    host.replaceChildren(title, status);

    const stores = STORES.map(name => findStore(name) as any);
    const [gateway, users, guilds, selected] = stores;
    const update = () => {
        const user = users.getCurrentUser();
        status.textContent = [
            gateway.isConnected() ? "connected" : "connecting",
            user ? `as ${user.username}` : "",
            `${Object.keys(guilds.getGuilds()).length} servers`,
            `channel ${selected.getChannelId() ?? "none"}`
        ].filter(Boolean).join(" · ");
    };
    update();
    for (const s of stores) s.addChangeListener(update);
    return () => {
        for (const s of stores) s.removeChangeListener(update);
        host.replaceChildren();
    };
});
