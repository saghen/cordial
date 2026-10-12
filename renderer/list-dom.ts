/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Message list, plain DOM (ROADMAP 0.6 variant "dom"). Message records are immutable (an edit replaces the record),
// so each row's element is cached by its record: re-rendering a channel only builds rows for records it hasn't seen,
// and the list is reconciled by moving existing elements.

import { S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { renderAST } from "./content";
import { authorOf, contentAST, Message, messagesOf, startsGroup, when } from "./model";
import type { ListFactory } from "./list";
import { createScroller } from "./scroller";

function div(cls: string) {
    const e = document.createElement("div");
    e.className = cls;
    return e;
}

function row(m: Message, head: boolean, channelId: Id, guildId: Id | null) {
    const r = div(head ? "mc-msg mc-head" : "mc-msg");
    r.dataset.id = m.id;
    const content = div("mc-content");
    if (m.type !== 0 && m.type !== 19) {
        content.classList.add("mc-system");
        content.textContent = m.content || `(message type ${m.type})`;
    } else renderAST(contentAST(m, channelId), content);
    if (m.editedTimestamp) {
        const e = document.createElement("span");
        e.className = "mc-edited";
        e.textContent = " (edited)";
        content.append(e);
    }
    if (!head) {
        r.append(content);
        return r;
    }
    const a = authorOf(m, guildId);
    const img = document.createElement("img");
    img.className = "mc-avatar";
    img.src = a.avatar;
    img.alt = "";
    img.loading = "lazy";
    const body = div("mc-body");
    const meta = div("mc-meta");
    const name = document.createElement("span");
    name.className = "mc-name";
    name.dataset.mc = `author:${a.id}`;
    name.textContent = a.name;
    if (a.color) name.style.color = a.color;
    const ts = document.createElement("span");
    ts.className = "mc-ts";
    ts.textContent = when(m.timestamp);
    meta.append(name, ts);
    body.append(meta, content);
    r.append(img, body);
    return r;
}

export const createDomList: ListFactory = (host, onShown) => {
    let channelId: Id | null = null;
    const { inner, rendered } = createScroller(host, () => channelId);

    // a record's row with and without its header
    let heads = new WeakMap<Message, HTMLElement>();
    let rest = new WeakMap<Message, HTMLElement>();
    let shown: unknown = null;

    function render() {
        if (!channelId) {
            inner.replaceChildren();
            shown = null;
            return;
        }
        const ms = S.Message.getMessages(channelId);
        if (ms === shown) return;
        const switched = (shown as any)?.channelId !== channelId;
        shown = ms;
        const guildId = S.Channel.getChannel(channelId)?.guild_id ?? null;
        const list = messagesOf(channelId);
        let cur = inner.firstChild;
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            const head = startsGroup(list[i - 1], m);
            const cache = head ? heads : rest;
            let e = cache.get(m);
            if (!e) cache.set(m, e = row(m, head, channelId, guildId));
            if (cur === e) cur = cur.nextSibling;
            else inner.insertBefore(e, cur);
        }
        while (cur) {
            const next = cur.nextSibling;
            cur.remove();
            cur = next;
        }
        rendered(switched);
        if (ms.ready) onShown(channelId);
    }

    S.Message.addChangeListener(render);

    return {
        show(id) {
            channelId = id;
            render();
        },
        reset() {
            heads = new WeakMap();
            rest = new WeakMap();
            inner.replaceChildren();
            shown = null;
        },
        dispose() {
            S.Message.removeChangeListener(render);
            host.replaceChildren();
        }
    };
};
