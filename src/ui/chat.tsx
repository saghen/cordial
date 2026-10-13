// The selected channel's messages. One element per message (two with its author line): the avatar is the row's
// ::before, the timestamp the name's ::after. Message records are immutable (an edit replaces the record), so a row's
// content is built once per record and cached; only whether it starts a group can change.

import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { embed } from "./embeds";
import { renderAST } from "./lib/content";
import { type Attachment, authorOf, can as allowed, contentAST, dayOf, type Message, nameOf, PERMS, type Reaction, startsGroup, when } from "./lib/model";
import { popAt } from "./lib/popover";
import { createScroller } from "./lib/scroller";
import { $ } from "./lib/store";

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
        // as stock: emoji alone (up to 30) show large
        const shown = nodes.filter(n => n.nodeType !== 3 || n.textContent!.trim());
        if (shown.length <= 30 && shown.every(n => n.nodeName === "IMG")) for (const n of shown) (n as Element).classList.add("jumbo");
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
        return users.map(u => nameOf(u)).join(", ") + (more > 0 ? ` and ${more} more` : "");
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

// stock's Resend (its menu's chunk, not loaded without it): the failed copy goes, the same message is sent again with
// its nonce. Stock adds the options SendMessageOptionsStore kept for it, also not loaded: a reply's mention setting
function resend(channelId: Id, m: Message) {
    A.messages.deleteMessage(channelId, m.id, true);
    A.messages.sendMessage(channelId, { content: m.content, tts: m.tts, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined,
        { nonce: m.nonce, flags: m.flags, messageReference: m.messageReference ?? undefined, location: "explicit_retry" });
}

export function Chat(p: { root: HTMLElement; }) {
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
            class={{ sending: m.state === "SENDING", failed: m.state === "SEND_FAILED", head: head(), system: m.type !== 0 && m.type !== 19, new: unread() === m.id, edited: !!m.editedTimestamp, day: !!day(), reply: !!ref() }}
            style={author() ? { "--av": `url(${author()!.avatar})` } : undefined}
        >
            <Show when={ref()}>{r => <q data-mc="reply-to" onClick={() => view.querySelector(`[data-id="${r().message?.id}"]`)?.scrollIntoView({ block: "center" })}>
                {r().message ? `${authorOf(r().message as Message, channel()?.guild_id).name}: ${r().message!.content || "Click to see attachment"}` : "Original message was deleted or isn't loaded"}
            </q>}</Show>
            <Show when={author()}>{a => <b data-mc={`author:${a().id}`} data-ts={when(m.timestamp)} data-day={day()} style={{ color: a().color ?? undefined }}>
                {a().name}<Show when={a().bot}><i>APP</i></Show>
            </b>}</Show>
            {nodes}
            {m.attachments?.map(attachment)}
            {m.embeds?.map(embed)}
            <Show when={m.reactions?.length}>
                <p data-mc="reactions">{m.reactions.map(react(m))}</p>
            </Show>
            <Show when={m.state === "SEND_FAILED"}>
                <p data-mc="failed">Not sent.
                    <button data-mc="retry" onClick={() => resend(m.channel_id, m)}>Retry</button>
                    <button data-mc="discard" onClick={() => A.messages.deleteMessage(m.channel_id, m.id, true)}>Delete</button>
                </p>
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

// stock's Mark Unread: a manual ack of the message before this one (or of the millisecond before it), with the
// mentions after it as the count
function markUnread(channelId: Id, messageId: Id) {
    const me = S.User.getCurrentUser()!, all = S.Message.getMessages(channelId).toArray() as Message[];
    const before = all.filter(m => BigInt(m.id) < BigInt(messageId)).at(-1)?.id ?? String(((BigInt(messageId) >> 22n) - 1n) << 22n);
    const mentions = all.filter(m => BigInt(m.id) > BigInt(before) && A.readStates.countsAsMention(m, me)).length;
    A.rest.post({ url: A.endpoints.MESSAGE_ACK(channelId, before), body: { manual: true, mention_count: mentions }, oldFormErrors: true, rejectWithError: true });
}

// the message menu (right click on a message)
function MessageMenu(p: { list: HTMLElement; channelId: () => Id | null; }) {
    const [target, setTarget] = createSignal<Message | null>(null);
    // deleting takes a second click
    const [sure, setSure] = createSignal(false);
    // the four most used reactions on top, as stock; React swaps the items for an emoji search: the most used, then
    // what the query matches
    const [query, setQuery] = createSignal<string | null>(null);
    let menu!: HTMLMenuElement;

    p.list.addEventListener("contextmenu", e => {
        const id = (e.target as Element).closest("article")?.dataset.id, channelId = p.channelId();
        const m = id && channelId ? S.Message.getMessage(channelId, id) as Message | undefined : undefined;
        if (!m) return;
        setTarget(m);
        setSure(false);
        setQuery(null);
        popAt(menu, e);
    });

    const channel = () => S.Channel.getChannel(target()!.channel_id)!;
    const own = () => target()!.author.id === S.User.getCurrentUser()?.id;
    const can = (permission: bigint) => allowed(permission, channel());
    const act = (fn: () => void) => () => {
        menu.hidePopover();
        fn();
    };
    const recent = () => S.Emoji.emojiReactionFrecencyWithoutFetchingLatest.frequently;
    const emojis = () => (query()
        ? S.Emoji.searchWithoutFetchingLatest({ channel: channel(), query: query()!, count: 24, intention: 0 }).unlocked
        : recent()).slice(0, 24);
    const react = (e: Record<string, any>) => act(() => A.reactions.add(channel().id, target()!.id,
        e.id ? { id: e.id, name: e.name, animated: e.animated } : { id: null, name: e.surrogates }, "Message Context Menu"));
    const Emojis = (p: { each: Record<string, any>[]; }) => <p><For each={p.each}>{e =>
        <button data-mc={`react:${e.id ?? e.name}`} title={`:${e.name}:`} onClick={react(e)}>
            {e.id ? <img alt={e.name} src={`https://cdn.discordapp.com/emojis/${e.id}.webp?size=44`} /> : e.surrogates}
        </button>
    }</For></p>;
    const box = () => document.querySelector<HTMLTextAreaElement>("[data-mc=composer]")?.focus();

    return <menu ref={menu} data-mc="message-menu" popover onToggle={e => e.newState === "closed" && setQuery(null)}>
        <Show when={target() && query() != null}>
            <input data-mc="react:search" placeholder="Find an emoji" ref={i => queueMicrotask(() => i.focus())}
                onInput={e => setQuery(e.currentTarget.value)}
                onKeyDown={e => e.key === "Enter" && emojis()[0] && react(emojis()[0])()} />
            <Emojis each={emojis()} />
        </Show>
        <Show when={target() && query() == null}>
            <Show when={can(PERMS.ADD_REACTIONS)}>
                <Emojis each={recent().slice(0, 4)} />
                <button data-mc="menu:react" onClick={() => setQuery("")}>React</button>
            </Show>
            <Show when={can(PERMS.SEND_MESSAGES)}>
                <button data-mc="menu:reply" onClick={act(() => {
                    A.replies.create({ message: target()!, channel: channel(), shouldMention: !own(), showMentionToggle: !own() });
                    box();
                })}>Reply</button>
            </Show>
            <Show when={own()}>
                <button data-mc="menu:edit" onClick={act(() => {
                    A.messages.startEditMessageRecord(channel().id, target()!);
                    box();
                })}>Edit</button>
            </Show>
            <Show when={(target()!.type === 0 || target()!.type === 19) && can(PERMS.PIN_MESSAGES) && can(PERMS.READ_MESSAGE_HISTORY)}>
                <button data-mc="menu:pin" onClick={act(() => {
                    const url = A.endpoints.PIN(channel().id, target()!.id);
                    if (target()!.pinned) A.rest.del({ url, oldFormErrors: true, rejectWithError: true });
                    else A.rest.put({ url, rejectWithError: true });
                })}>{target()!.pinned ? "Unpin" : "Pin"}</button>
            </Show>
            <button data-mc="menu:unread" onClick={act(() => markUnread(channel().id, target()!.id))}>Mark Unread</button>
            <button data-mc="menu:copy" onClick={act(() => navigator.clipboard.writeText(target()!.content))}>Copy text</button>
            <button data-mc="menu:link" onClick={act(() => navigator.clipboard.writeText(
                `https://discord.com/channels/${channel().guild_id ?? "@me"}/${channel().id}/${target()!.id}`))}>Copy link</button>
            <Show when={own() || can(PERMS.MANAGE_MESSAGES)}>
                <button data-mc="menu:delete" class="danger" onClick={() => sure()
                    ? act(() => A.messages.deleteMessage(channel().id, target()!.id))()
                    : setSure(true)}>{sure() ? "Delete: click again" : "Delete"}</button>
            </Show>
        </Show>
    </menu>;
}
