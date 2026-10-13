// The channel list: a server's channels and voice channels, or the DMs. Server icons, channels, categories and DMs
// are all the same <a> (Item): its state is classes, its icon and badge the CSS's ::before and ::after.

import { createEffect, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id, Rec } from "../adapter/discord";
import { nameOf } from "./lib/model";
import { $, selected, selectedGuild } from "./lib/store";

export const url = (src?: string | null) => src ? { "--icon": `url(${src})` } : undefined;

export function Item(p: {
    mc?: string; label?: string; title?: string; icon?: string | null; status?: string;
    sel?: boolean; unread?: boolean; muted?: boolean; mentions?: number; go(): void;
}) {
    return <a data-mc={p.mc} title={p.title} style={url(p.icon)} data-status={p.status} data-n={p.mentions || undefined}
        class={{ sel: !!p.sel, unread: !!p.unread, muted: !!p.muted }} onClick={p.go}>{p.label}</a>;
}

export function dmName(c?: Rec) {
    const users = c?.rawRecipients ?? [];
    return c?.name || users.map((u: Rec) => u.global_name ?? u.username).join(", ");
}

// a DM shows its user's avatar and status; a group DM its icon
function dmUser(c?: Rec) {
    return c?.type === 1 ? $.User.getUser(c.recipients[0]) : undefined;
}
export function dmIcon(c?: Rec) {
    return dmUser(c)?.getAvatarURL(undefined, 64) ?? (c?.icon && `https://cdn.discordapp.com/channel-icons/${c.id}/${c.icon}.webp?size=64`);
}
export function dmStatus(c?: Rec) {
    const user = dmUser(c);
    return user && $.Presence.getStatus(user.id);
}

export function Dm(p: { id: Id; bar?: boolean; }) {
    const c = () => $.Channel.getChannel(p.id);
    const name = () => dmName(c());
    return <Item mc={`dm:${p.id}`} title={name()} label={p.bar ? "" : name()} icon={dmIcon(c())} status={dmStatus(c())}
        sel={selected() === p.id} unread={$.ReadState.hasUnread(p.id)} mentions={$.ReadState.getMentionCount(p.id)}
        go={() => A.nav.transitionTo(`/channels/@me/${p.id}`)} />;
}

// text and announcement channels, then voice channels, under their categories (the uncategorized ones first, as
// GuildChannelStore lists the "null" category). A collapsed category keeps the selected channel. Collapsing is a user
// guild setting: it syncs
function channelRows(guildId: Id) {
    const all = $.GuildChannel.getChannels(guildId);
    const text: Rec[] = (all.SELECTABLE ?? []).map((x: Rec) => x.channel).filter((c: Rec) => c.type === 0 || c.type === 5);
    const voice: Rec[] = (all.VOCAL ?? []).map((x: Rec) => x.channel).filter((c: Rec) => c.type === 2);
    return (all[4] ?? []).flatMap(({ channel: cat }: Rec) => {
        const rows = [...text, ...voice].filter(c => (c.parent_id ?? "null") === cat.id);
        const shut = $.CategoryCollapse.isCollapsed(cat.id);
        return [...cat.id === "null" || !rows.length ? [] : [cat], ...rows.filter(c => !shut || c.id === selected())];
    });
}

export function Channels() {
    useChannelInfo(selectedGuild);
    return <nav>
        <Show when={selectedGuild()} keyed fallback={
            <For each={$.PrivateChannelSort.getSortedChannels().flat().slice(0, 100)}>{c => <Dm id={c.channelId} />}</For>
        }>{guildId => <For each={channelRows(guildId)}>{c => c.type === 2 ? <VoiceRow channel={c} /> : c.type === 4
            ? <a data-mc={`category:${c.id}`} class={["cat", { collapsed: $.CategoryCollapse.isCollapsed(c.id) }]}
                onClick={() => A.dispatcher.dispatch({ type: S.CategoryCollapse.isCollapsed(c.id) ? "CATEGORY_EXPAND" : "CATEGORY_COLLAPSE", id: c.id })}>
                {c.name}
            </a>
            : <Item mc={`channel:${c.id}`} label={c.name} sel={selected() === c.id} unread={$.ReadState.hasUnread(c.id)}
                muted={$.UserGuildSettings.isChannelMuted(guildId, c.id)} mentions={$.ReadState.getMentionCount(c.id)}
                go={() => A.nav.transitionTo(`/channels/${guildId}/${c.id}`)} />
        }</For>}</Show>
    </nav>;
}

// as stock's voice rows: a server's voice channel statuses, once until a resume clears them (op 43)
function useChannelInfo(guildId: () => Id | null) {
    createEffect(() => {
        const id = guildId();
        return id && $.GuildChannel.getChannels(id).VOCAL?.length && !$.ChannelStatus.hasRequestedStatuses(id) ? id : null;
    }, id => {
        if (id) A.channelInfo(id);
    });
}

function VoiceRow(p: { channel: Rec; }) {
    const users = () => Object.values($.VoiceState.getVoiceStatesForChannel(p.channel.id)) as Rec[];
    return <>
        <a data-mc={`voice:${p.channel.id}`} class={{ voice: true, sel: $.RTCConnection.getChannelId() === p.channel.id }}
            onClick={() => A.voice.selectVoiceChannel(p.channel.id)}>
            {p.channel.name}<small>{$.ChannelStatus.getChannelStatus(p.channel)}</small>
        </a>
        <For each={users()}>{v => {
            const user = () => $.User.getUser(v.userId);
            return <a data-mc={`voice-user:${v.userId}`} style={{ "--icon": `url(${user()?.getAvatarURL(p.channel.guild_id, 32)})` }}
                class={{ speaking: $.Speaking.isSpeaking(v.userId), muted: v.selfMute || v.mute, deaf: v.selfDeaf || v.deaf }}>
                {nameOf(user(), $.GuildMember.getMember(p.channel.guild_id, v.userId)?.nick)}
            </a>;
        }}</For>
    </>;
}
