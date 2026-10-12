/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entry point Equibop imports (nix/equibop.nix). Until the framework is chosen (ROADMAP 0.6) the root is a plain-DOM
// placeholder: who is connected and how much the core has synced, so a glance shows the core is alive.

import { setMount } from "../adapter/anchor";
import { A, checkReport, S } from "../adapter/core";
import * as triggers from "../adapter/triggers";

// for lab scripts over CDP
Object.assign(VesktopPatchGlobals, { mincordAdapter: { S, A, checkReport, ...triggers } });

setMount(host => {
    host.style.cssText =
        "position:fixed;inset:0;z-index:1;display:flex;flex-direction:column;gap:8px;padding:24px;" +
        "background:#1e1f22;color:#dbdee1;font:14px/1.4 system-ui,sans-serif";
    const title = document.createElement("div");
    title.textContent = "mincord";
    title.style.cssText = "font-size:20px;font-weight:600";
    const status = document.createElement("div");
    host.replaceChildren(title, status);

    const stores = [S.Gateway, S.User, S.Guild, S.SelectedChannel];
    const update = () => {
        const user = S.User.getCurrentUser();
        status.textContent = [
            S.Gateway.isConnected() ? "connected" : "connecting",
            user ? `as ${user.username}` : "",
            `${Object.keys(S.Guild.getGuilds()).length} servers`,
            `channel ${S.SelectedChannel.getChannelId() ?? "none"}`
        ].filter(Boolean).join(" · ");
    };
    update();
    for (const s of stores) s.addChangeListener(update);
    return () => {
        for (const s of stores) s.removeChangeListener(update);
        host.replaceChildren();
    };
});
