// The shell: one grid (style.ts), one element per region and per list row. Server icons, channels, categories and
// DMs are all the same <a> (Item): its state is classes, its icon and badge the CSS's ::before and ::after.

import { For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id, Rec } from "../adapter/discord";
import { Messages } from "./messages";
import { $ } from "./store";
import { CSS } from "./style";

const url = (src?: string | null) => src ? { "--icon": `url(${src})` } : undefined;

function Item(p: {
    mc?: string; label?: string; title?: string; icon?: string | null; status?: string;
    sel?: boolean; unread?: boolean; muted?: boolean; mentions?: number; go(): void;
}) {
    return <a data-mc={p.mc} title={p.title} style={url(p.icon)} data-status={p.status} data-n={p.mentions || undefined}
        class={{ sel: !!p.sel, unread: !!p.unread, muted: !!p.muted }} onClick={p.go}>{p.label}</a>;
}

const selected = () => $.SelectedChannel.getChannelId();
const selectedGuild = () => $.SelectedGuild.getGuildId();

function dmName(c?: Rec) {
    const users = c?.rawRecipients ?? [];
    return c?.name || users.map((u: Rec) => u.global_name ?? u.username).join(", ");
}

function Dm(p: { id: Id; bar?: boolean; }) {
    const c = () => $.Channel.getChannel(p.id);
    // a DM's user; a group DM shows its icon
    const user = () => c()?.type === 1 ? $.User.getUser(c()!.recipients[0]) : undefined;
    const name = () => dmName(c());
    return <Item mc={`dm:${p.id}`} title={name()} label={p.bar ? "" : name()}
        icon={user()?.getAvatarURL(undefined, 64) ?? (c()?.icon && `https://cdn.discordapp.com/channel-icons/${p.id}/${c()!.icon}.webp?size=64`)}
        status={user() && $.Presence.getStatus(user()!.id)} sel={selected() === p.id} unread={$.ReadState.hasUnread(p.id)}
        mentions={$.ReadState.getMentionCount(p.id)} go={() => A.nav.transitionTo(`/channels/@me/${p.id}`)} />;
}

function Servers() {
    return <aside>
        <Item mc="dms" label="DM" title="Direct Messages" sel={!selectedGuild()}
            mentions={$.GuildReadState.getPrivateChannelMentionCount()} go={() => A.nav.transitionTo("/channels/@me")} />
        <For each={$.PrivateChannelReadState.getUnreadPrivateChannelIds()}>{id => <Dm id={id} bar />}</For>
        <hr />
        <For each={$.SortedGuild.getFlattenedGuildIds()}>{id => {
            const g = () => $.Guild.getGuild(id);
            return <Item mc={`guild:${id}`} title={g()?.name} sel={selectedGuild() === id}
                label={g()?.icon ? "" : g()?.name.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 3)}
                icon={g()?.icon && `https://cdn.discordapp.com/icons/${id}/${g()!.icon}.webp?size=96`}
                unread={$.GuildReadState.hasUnread(id)} muted={$.UserGuildSettings.isMuted(id)}
                mentions={$.GuildReadState.getMentionCount(id)} go={() => A.nav.transitionToGuild(id)} />;
        }}</For>
    </aside>;
}

// text and announcement channels under their categories (the uncategorized ones first, as GuildChannelStore lists
// the "null" category). A collapsed category keeps the selected channel. Collapsing is a user guild setting: it syncs
function channelRows(guildId: Id) {
    const all = $.GuildChannel.getChannels(guildId);
    const text: Rec[] = (all.SELECTABLE ?? []).map((x: Rec) => x.channel).filter((c: Rec) => c.type === 0 || c.type === 5);
    return (all[4] ?? []).flatMap(({ channel: cat }: Rec) => {
        const rows = text.filter(c => (c.parent_id ?? "null") === cat.id);
        const shut = $.CategoryCollapse.isCollapsed(cat.id);
        return [...cat.id === "null" || !rows.length ? [] : [cat], ...rows.filter(c => !shut || c.id === selected())];
    });
}

function Nav() {
    return <nav>
        <Show when={selectedGuild()} keyed fallback={
            <For each={$.PrivateChannelSort.getSortedChannels().flat().slice(0, 100)}>{c => <Dm id={c.channelId} />}</For>
        }>{guildId => <For each={channelRows(guildId)}>{c => c.type === 4
            ? <a class={["cat", { collapsed: $.CategoryCollapse.isCollapsed(c.id) }]}
                onClick={() => A.dispatcher.dispatch({ type: S.CategoryCollapse.isCollapsed(c.id) ? "CATEGORY_EXPAND" : "CATEGORY_COLLAPSE", id: c.id })}>
                {c.name}
            </a>
            : <Item mc={`channel:${c.id}`} label={c.name} sel={selected() === c.id} unread={$.ReadState.hasUnread(c.id)}
                muted={$.UserGuildSettings.isChannelMuted(guildId, c.id)} mentions={$.ReadState.getMentionCount(c.id)}
                go={() => A.nav.transitionTo(`/channels/${guildId}/${c.id}`)} />
        }</For>}</Show>
    </nav>;
}

export function App(p: { root: HTMLElement; }) {
    const channel = () => $.Channel.getChannel(selected()!);
    const me = () => $.User.getCurrentUser();
    return <>
        <style>{CSS}</style>
        <Show when={!$.Gateway.isConnected()}>
            <p>{$.Gateway.isTryingToConnect() ? "Connecting…" : "Disconnected"}</p>
        </Show>
        <Servers />
        <h1>{selectedGuild() ? $.Guild.getGuild(selectedGuild()!)?.name : "Direct Messages"}</h1>
        <Nav />
        <footer style={url(me()?.getAvatarURL(undefined, 64))} data-status={$.SelfPresence.getStatus()}>
            {me()?.globalName ?? me()?.username}<small>{$.SelfPresence.getStatus()}</small>
        </footer>
        <header>
            <Show when={channel()}>{c => <>{c().guild_id ? `# ${c().name}` : `@ ${dmName(c())}`}<small>{c().topic}</small></>}</Show>
        </header>
        <Messages root={p.root} />
    </>;
}
