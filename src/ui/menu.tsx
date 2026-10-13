// The message context menu (right click on a row): stock's basics, each as it's built. A popover at the pointer.

import { createSignal, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import type { Message } from "./model";

const MANAGE_MESSAGES = 8192n, SEND_MESSAGES = 2048n, ADD_REACTIONS = 64n;

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
        e.preventDefault();
        setTarget(m);
        setSure(false);
        setQuery(null);
        Object.assign(menu.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
        // on Linux this fires on the press: opened before the release, the release would light-dismiss it
        if (e.buttons) addEventListener("pointerup", () => menu.showPopover(), { once: true });
        else menu.showPopover();
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

    return <menu ref={menu} data-mc="message-menu" popover>
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
