/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entry point Equibop imports (nix/equibop.nix). Until the framework is chosen (ROADMAP 0.6) the root is a plain-DOM
// placeholder: status, server/channel/DM lists that navigate, and the selected channel's message count. It follows
// the lab's conventions, so the budget runner (lab/budgets.py) measures switches through it: the core's own cost
// under a trivial renderer.
//
// Lab conventions (the real renderer keeps them):
//   data-mc="guild:ID" | "channel:ID" | "dm:ID"   the element a click on navigates there
//   #mincord-root[data-view="channel:ID"]          set in the frame that shows that channel's messages

import { setMount } from "../adapter/anchor";
import { A, checkReport, S } from "../adapter/core";
import type { FluxStore } from "../adapter/discord";
import * as triggers from "../adapter/triggers";

// for lab scripts over CDP
Object.assign(VesktopPatchGlobals, { mincordAdapter: { S, A, checkReport, ...triggers } });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = "") {
    const e = document.createElement(tag);
    e.style.cssText = css;
    e.textContent = text;
    return e;
}

const COL = "display:flex;flex-direction:column;gap:2px;overflow:auto;padding:8px;min-width:0";
const ITEM = "all:unset;cursor:pointer;padding:4px 8px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

function item(mc: string, text: string, selected: boolean, go: () => void) {
    const b = el("button", ITEM + (selected ? ";background:#404249;color:#fff" : ""), text);
    b.dataset.mc = mc;
    b.onclick = go;
    return b;
}

setMount(host => {
    host.style.cssText =
        "position:fixed;inset:0;z-index:1;display:grid;grid-template-columns:200px 240px 1fr;grid-template-rows:auto 1fr;" +
        "background:#1e1f22;color:#dbdee1;font:14px/1.4 system-ui,sans-serif";
    const status = el("div", "grid-column:1/-1;padding:8px 16px;border-bottom:1px solid #2b2d31");
    const guilds = el("div", COL);
    const channels = el("div", COL + ";background:#2b2d31");
    const view = el("div", "padding:16px;overflow:auto");
    host.replaceChildren(status, guilds, channels, view);

    const updateStatus = () => {
        const user = S.User.getCurrentUser();
        status.textContent = [
            "mincord",
            S.Gateway.isConnected() ? "connected" : "connecting",
            user ? `as ${user.username}` : ""
        ].filter(Boolean).join(" · ");
    };

    let listKey = "";
    const updateLists = () => {
        const gid = S.SelectedGuild.getGuildId();
        const cid = S.SelectedChannel.getChannelId();
        const ids = S.SortedGuild.getFlattenedGuildIds();
        const key = `${gid}|${cid}|${ids.join()}`;
        if (key === listKey) return;
        listKey = key;
        guilds.replaceChildren(
            item("dms", "Direct Messages", gid == null, () => A.nav.transitionTo("/channels/@me")),
            ...ids.map(id => item(`guild:${id}`, S.Guild.getGuild(id)?.name ?? id, id === gid, () => A.nav.transitionToGuild(id)))
        );
        if (gid) {
            const text = (S.GuildChannel.getChannels(gid).SELECTABLE ?? []).map((x: any) => x.channel).filter((c: any) => c.type === 0 || c.type === 5);
            channels.replaceChildren(...text.map((c: any) =>
                item(`channel:${c.id}`, `# ${c.name}`, c.id === cid, () => A.nav.transitionTo(`/channels/${gid}/${c.id}`))));
        } else {
            channels.replaceChildren(...S.PrivateChannelSort.getPrivateChannelIds().slice(0, 50).map(id => {
                const c = S.Channel.getChannel(id);
                const name = c?.name || c?.rawRecipients?.map((r: any) => r.global_name ?? r.username).join(", ") || id;
                return item(`dm:${id}`, name, id === cid, () => A.nav.transitionTo(`/channels/@me/${id}`));
            }));
        }
    };

    let shown = "";
    const updateView = () => {
        const cid = S.SelectedChannel.getChannelId();
        if (!cid) {
            if (shown) view.replaceChildren();
            shown = "";
            delete host.dataset.view;
            return;
        }
        const messages = S.Message.getMessages(cid);
        const c = S.Channel.getChannel(cid);
        const key = `${cid}|${messages.ready}|${messages.length}`;
        if (key === shown) return;
        shown = key;
        view.textContent = messages.ready ? `${c?.name ?? cid}: ${messages.length} messages loaded` : `${c?.name ?? cid}: loading`;
        if (messages.ready) host.dataset.view = `channel:${cid}`;
        else delete host.dataset.view;
    };

    const listeners: [FluxStore, () => void][] = [
        [S.Gateway, updateStatus], [S.User, updateStatus],
        [S.SelectedGuild, updateLists], [S.SelectedChannel, updateLists], [S.SortedGuild, updateLists],
        [S.GuildChannel, updateLists], [S.PrivateChannelSort, updateLists],
        [S.SelectedChannel, updateView], [S.Message, updateView]
    ];
    updateStatus();
    updateLists();
    updateView();
    for (const [s, fn] of listeners) s.addChangeListener(fn);
    return () => {
        for (const [s, fn] of listeners) s.removeChangeListener(fn);
        host.replaceChildren();
    };
});
