/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entry point Equibop imports (nix/equibop.nix). Until the framework is chosen (ROADMAP 0.6) the shell is plain DOM:
// status, server/channel/DM lists that navigate, and the selected channel's message list (list.ts: one of the
// variants 0.6 compares). It follows the lab's conventions, so the budget runner (lab/budgets.py) drives it.
//
// Lab conventions (the real renderer keeps them):
//   data-mc="guild:ID" | "channel:ID" | "dm:ID"   the element a click on navigates there
//   #mincord-root[data-view="channel:ID"]          set in the task that puts that channel's messages in the DOM
//   data-mc="messages"                              the message list's scroller
//   data-mc="author:ID"                             an author's name in the list

import { setMount } from "../adapter/anchor";
import { A, checkReport, S } from "../adapter/core";
import type { FluxStore } from "../adapter/discord";
import * as triggers from "../adapter/triggers";
import { createList, CSS, listVariant } from "./list";

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
    const view = el("div", "min-height:0;background:var(--bg)");
    const style = el("style", "", CSS);
    host.replaceChildren(style, status, guilds, channels, view);
    const list = createList(view, cid => {
        if (cid === S.SelectedChannel.getChannelId()) host.dataset.view = `channel:${cid}`;
    });
    Object.assign(VesktopPatchGlobals, { mincordList: list });

    const updateStatus = () => {
        const user = S.User.getCurrentUser();
        status.textContent = [
            `mincord (list: ${listVariant()})`,
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

    let shown: string | null = null;
    const updateView = () => {
        const cid = S.SelectedChannel.getChannelId();
        if (cid === shown) return;
        shown = cid;
        delete host.dataset.view;
        list.show(cid);
    };

    const listeners: [FluxStore, () => void][] = [
        [S.Gateway, updateStatus], [S.User, updateStatus],
        [S.SelectedGuild, updateLists], [S.SelectedChannel, updateLists], [S.SortedGuild, updateLists],
        [S.GuildChannel, updateLists], [S.PrivateChannelSort, updateLists],
        [S.SelectedChannel, updateView]
    ];
    updateStatus();
    updateLists();
    updateView();
    for (const [s, fn] of listeners) s.addChangeListener(fn);
    return () => {
        for (const [s, fn] of listeners) s.removeChangeListener(fn);
        list.dispose();
        host.replaceChildren();
    };
});
