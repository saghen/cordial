// The selected channel's messages. One element per message (two with its author line): the avatar is the row's
// ::before, the timestamp the name's ::after. Message records are immutable (an edit replaces the record), so a row's
// content is built once per record and cached; only whether it starts a group can change.

import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";

import { A } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { renderAST } from "./content";
import { type Attachment, authorOf, contentAST, dayOf, type Message, type Reaction, startsGroup, when } from "./model";
import { MessageMenu } from "./menu";
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

// images and videos inline, scaled to fit 400x300 (images from the media proxy at that size), anything else a link
const attachment = (a: Attachment) => {
    const type = a.content_type?.split("/")[0], scale = Math.min(1, 400 / (a.width || 400), 300 / (a.height || 300));
    const width = Math.round((a.width ?? 0) * scale), height = Math.round((a.height ?? 0) * scale);
    if (type === "image" && a.width) return <img class="media" alt={a.filename} width={width} height={height} loading="lazy"
        src={`${a.proxy_url}${a.proxy_url.includes("?") ? "&" : "?"}width=${width}&height=${height}`} />;
    if (type === "video") return <video class="media" controls preload="metadata" width={width || undefined} height={height || undefined} src={a.url} />;
    return <a class="file" href={a.url} target="_blank" rel="noreferrer noopener" data-size={size(a.size)}>{a.filename}</a>;
};
const size = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

// a chip per emoji: the emoji, the count, mine highlighted; a click adds or removes mine. Hovered, its title names up
// to three who reacted, as stock's tooltip (the store fetches them on the first read)
const react = (m: Message) => (r: Reaction) => {
    const [hovered, setHovered] = createSignal(false);
    const title = () => {
        if (!hovered()) return undefined;
        const users = [...$.MessageReactions.getReactions(m.channel_id, m.id, r.emoji, 3, 0).values()];
        const more = r.count - users.length;
        return users.map(u => u.globalName ?? u.username).join(", ") + (more > 0 ? ` and ${more} more` : "");
    };
    return <button data-mc={`reaction:${r.emoji.id ?? r.emoji.name}`} class={{ me: r.me }} title={title()}
        onPointerEnter={() => setHovered(true)}
        onClick={() => r.me
            ? A.reactions.remove({ channelId: m.channel_id, messageId: m.id, emoji: r.emoji, location: "Message Inline Button" })
            : A.reactions.add(m.channel_id, m.id, r.emoji, "Message Inline Button")}>
        {r.emoji.id ? <img alt={r.emoji.name} src={`https://cdn.discordapp.com/emojis/${r.emoji.id}.webp?size=44`} /> : r.emoji.name}
        {r.count}
    </button>;
};

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
        // a new day always starts a group, so the author line carries the divider
        const day = createMemo(() => dayOf(list()[i() - 1], m));
        // a reply's message, once loaded (ReferencedMessageStore)
        const ref = createMemo(() => m.type === 19 ? $.ReferencedMessage.getMessageByReference(m.messageReference) : null);
        const nodes = content(m, untrack(channelId)!);
        return <article data-id={m.id}
            class={{ head: head(), system: m.type !== 0 && m.type !== 19, new: unread() === m.id, edited: !!m.editedTimestamp, day: !!day(), reply: !!ref() }}
            style={author() ? { "--av": `url(${author()!.avatar})` } : undefined}
        >
            <Show when={ref()}>{r => <q data-mc="reply-to" onClick={() => view.querySelector(`[data-id="${r().message?.id}"]`)?.scrollIntoView({ block: "center" })}>
                {r().message ? `${authorOf(r().message as Message, channel()?.guild_id).name}: ${r().message!.content}` : "Original message was deleted or isn't loaded"}
            </q>}</Show>
            <Show when={author()}>{a => <b data-mc={`author:${a().id}`} data-ts={when(m.timestamp)} data-day={day()} style={{ color: a().color ?? undefined }}>
                {a().name}<Show when={a().bot}><i>APP</i></Show>
            </b>}</Show>
            {nodes}
            {m.attachments?.map(attachment)}
            <Show when={m.reactions?.length}>
                <p data-mc="reactions">{m.reactions.map(react(m))}</p>
            </Show>
        </article>;
    };

    const view = <div class="messages" data-mc="messages"><div><For each={list()}>{Row}</For></div></div> as HTMLElement;

    // after the rows are in the DOM: the scroller, and the lab's marker that this channel is shown
    const rendered = createScroller(view, channelId);
    createEffect(() => [channelId(), list(), messages()?.ready] as const, ([id, , ready], prev) => {
        rendered(id !== prev?.[0]);
        if (id && ready) p.root.dataset.view = `channel:${id}`;
        else delete p.root.dataset.view;
    });
    return <>{view}<MessageMenu list={view} channelId={channelId} /></>;
}
