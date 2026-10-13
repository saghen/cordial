// The context menus (right click on a message, on a server): popovers at the pointer.

import { createSignal, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import type { Message } from "./model";
import { $ } from "./store";

export function popAt(menu: HTMLElement, e: MouseEvent) {
    e.preventDefault();
    // at the pointer, above it or to its left where it wouldn't fit
    const show = () => {
        menu.showPopover();
        const { width, height } = menu.getBoundingClientRect();
        Object.assign(menu.style, {
            left: `${e.clientX + width > innerWidth ? e.clientX - width : e.clientX}px`,
            top: `${e.clientY + height > innerHeight ? e.clientY - height : e.clientY}px`
        });
    };
    // on Linux contextmenu fires on the press: opened before the release, the release would light-dismiss it
    if (e.buttons) addEventListener("pointerup", show, { once: true });
    else show();
}

const MANAGE_MESSAGES = 8192n, SEND_MESSAGES = 2048n, ADD_REACTIONS = 64n, READ_MESSAGE_HISTORY = 65536n, PIN_MESSAGES = 1n << 51n;

// stock's Mark Unread: a manual ack of the message before this one (or of the millisecond before it), with the
// mentions after it as the count
function markUnread(channelId: Id, messageId: Id) {
    const me = S.User.getCurrentUser()!, all = S.Message.getMessages(channelId).toArray() as Message[];
    const before = all.filter(m => BigInt(m.id) < BigInt(messageId)).at(-1)?.id ?? String(((BigInt(messageId) >> 22n) - 1n) << 22n);
    const mentions = all.filter(m => BigInt(m.id) > BigInt(before) && A.readStates.countsAsMention(m, me)).length;
    A.rest.post({ url: A.endpoints.MESSAGE_ACK(channelId, before), body: { manual: true, mention_count: mentions }, oldFormErrors: true, rejectWithError: true });
}

export function MessageMenu(p: { list: HTMLElement; channelId: () => Id | null; }) {
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
    const can = (permission: bigint) => channel().isPrivate() || S.Permission.can(permission, channel());
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
            <Show when={can(ADD_REACTIONS)}>
                <Emojis each={recent().slice(0, 4)} />
                <button data-mc="menu:react" onClick={() => setQuery("")}>React</button>
            </Show>
            <Show when={can(SEND_MESSAGES)}>
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
            <Show when={(target()!.type === 0 || target()!.type === 19) && can(PIN_MESSAGES) && can(READ_MESSAGE_HISTORY)}>
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
            <Show when={own() || can(MANAGE_MESSAGES)}>
                <button data-mc="menu:delete" class="danger" onClick={() => sure()
                    ? act(() => A.messages.deleteMessage(channel().id, target()!.id))()
                    : setSure(true)}>{sure() ? "Delete: click again" : "Delete"}</button>
            </Show>
        </Show>
    </menu>;
}

export function ServerMenu(p: { bar: HTMLElement; }) {
    const [guild, setGuild] = createSignal<Id | null>(null);
    let menu!: HTMLMenuElement;
    p.bar.addEventListener("contextmenu", e => {
        const id = (e.target as Element).closest<HTMLElement>("[data-mc^='guild:']")?.dataset.mc!.slice(6);
        if (!id) return;
        setGuild(id);
        popAt(menu, e);
    });
    const act = (fn: (id: Id) => void) => () => {
        menu.hidePopover();
        fn(guild()!);
    };
    const muted = () => $.UserGuildSettings.isMuted(guild()!);

    return <menu ref={menu} data-mc="server-menu" popover>
        <Show when={guild()}>
            <button data-mc="menu:read" disabled={!$.GuildReadState.getGuildHasUnreadIgnoreMuted(guild()!)}
                onClick={act(id => A.markGuildsRead([id], "Guild List"))}>Mark As Read</button>
            <button data-mc="menu:mute" onClick={act(id => A.notifications.updateGuildNotificationSettings(id,
                { muted: !muted() }, muted() ? "unmuted" : "muted"))}>{muted() ? "Unmute Server" : "Mute Server"}</button>
            <button data-mc="menu:copy-id" onClick={act(id => navigator.clipboard.writeText(id))}>Copy Server ID</button>
        </Show>
    </menu>;
}
