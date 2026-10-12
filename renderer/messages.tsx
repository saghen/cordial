/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The selected channel's messages. One element per message (two with its author line): the avatar is the row's
// ::before, the timestamp the name's ::after, the content goes straight into the row. Rows follow message records,
// which are immutable (an edit replaces the record), so a row never updates its content; only whether it starts a
// group can change. Content is cached per record, so a channel shown again doesn't parse its markdown again.

import { createEffect, createMemo, For, Show, untrack } from "solid-js";

import { S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { renderAST } from "./content";
import { authorOf, contentAST, type Message, startsGroup, when } from "./model";
import { createScroller } from "./scroller";
import { $ } from "./store";

let built = new WeakMap<Message, globalThis.Node[]>();

// ai/lab/budgets.py --cold: every row parses its content again
export function resetContent() {
    built = new WeakMap();
}

function content(m: Message, channelId: Id) {
    let nodes = built.get(m);
    if (!nodes) {
        // anything but a default message or a reply is a system message: its text, as a placeholder
        const f = m.type === 0 || m.type === 19
            ? renderAST(contentAST(m, channelId), document.createDocumentFragment())
            : document.createTextNode(m.content || `(message type ${m.type})`);
        built.set(m, nodes = f instanceof DocumentFragment ? [...f.childNodes] : [f]);
    }
    return nodes;
}

export function Messages(p: { root: HTMLElement; }) {
    const channelId = createMemo(() => $.SelectedChannel.getChannelId());
    const channel = createMemo(() => $.Channel.getChannel(channelId()!));
    // a new ChannelMessages object on every change to the channel's messages
    const messages = createMemo(() => channelId() ? $.Message.getMessages(channelId()!) : null);
    const list = createMemo(() => (messages()?.toArray() ?? []) as Message[]);
    const unread = createMemo(() => channelId() && $.ReadState.getOldestUnreadMessageId(channelId()!));

    const Row = (m: Message, i: () => number) => {
        const head = createMemo(() => startsGroup(channel(), list()[i() - 1], m));
        const author = createMemo(() => head() ? authorOf(m, channel()?.guild_id) : null);
        const nodes = content(m, untrack(channelId)!);
        return <article
            class={{ head: head(), system: m.type !== 0 && m.type !== 19, new: unread() === m.id, edited: !!m.editedTimestamp }}
            style={author() ? { "--av": `url(${author()!.avatar})` } : undefined}
        >
            <Show when={author()}>{a => <b data-mc={`author:${a().id}`} data-ts={when(m.timestamp)} style={{ color: a().color ?? undefined }}>{a().name}</b>}</Show>
            {nodes}
        </article>;
    };

    const view = <div class="messages" data-mc="messages"><div><For each={list()}>{Row}</For></div></div> as HTMLElement;

    // after the rows are in the DOM (effects run after rendering, in the same task): the scroller's position and acks,
    // and the lab's marker that this channel is shown
    const rendered = createScroller(view, channelId);
    createEffect(() => [channelId(), list(), messages()?.ready] as const, ([id, , ready], prev) => {
        rendered(id !== prev?.[0]);
        if (id && ready) p.root.dataset.view = `channel:${id}`;
        else delete p.root.dataset.view;
    });
    return view;
}
