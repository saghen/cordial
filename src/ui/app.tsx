// The shell: one grid (style.ts), one element per region and per list row. Server icons, channels, categories and
// DMs are all the same <a> (Item): its state is classes, its icon and badge the CSS's ::before and ::after.

import { createSignal, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id, Rec } from "../adapter/discord";
import { Composer } from "./composer";
import { Members, MembersToggle } from "./members";
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

// a DM shows its user's avatar and status; a group DM its icon
function dmUser(c?: Rec) {
    return c?.type === 1 ? $.User.getUser(c.recipients[0]) : undefined;
}
function dmIcon(c?: Rec) {
    return dmUser(c)?.getAvatarURL(undefined, 64) ?? (c?.icon && `https://cdn.discordapp.com/channel-icons/${c.id}/${c.icon}.webp?size=64`);
}
function dmStatus(c?: Rec) {
    const user = dmUser(c);
    return user && $.Presence.getStatus(user.id);
}

function Dm(p: { id: Id; bar?: boolean; }) {
    const c = () => $.Channel.getChannel(p.id);
    const name = () => dmName(c());
    return <Item mc={`dm:${p.id}`} title={name()} label={p.bar ? "" : name()} icon={dmIcon(c())} status={dmStatus(c())}
        sel={selected() === p.id} unread={$.ReadState.hasUnread(p.id)} mentions={$.ReadState.getMentionCount(p.id)}
        go={() => A.nav.transitionTo(`/channels/@me/${p.id}`)} />;
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

const STATUSES = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible" } as Record<string, string>;

// the user panel, and its account popout with the status picker: a popover the panel opens, placed by CSS anchor
// positioning. A pick calls stock's status setter as its menu does (a synced setting)
function Me() {
    const me = () => $.User.getCurrentUser();
    const status = () => $.SelfPresence.getStatus();
    let menu!: HTMLMenuElement;
    const pick = (next: string) => {
        menu.hidePopover();
        const prevStatus = S.SelfPresence.getStatus();
        if (next !== prevStatus) A.setStatus({ nextStatus: next, prevStatus });
    };
    return <>
        <button data-mc="me" popovertarget="mc-account" style={url(me()?.getAvatarURL(undefined, 64))} data-status={status()}>
            {me()?.globalName ?? me()?.username}<small>{STATUSES[status()] ?? status()}</small>
        </button>
        <menu ref={menu} id="mc-account" data-mc="account" popover>
            <b style={url(me()?.getAvatarURL(undefined, 128))}>{me()?.globalName ?? me()?.username}<small>{me()?.username}</small></b>
            {Object.entries(STATUSES).map(([value, label]) =>
                <button value={value} data-mc={`status:${value}`} class={{ sel: status() === value }} onClick={() => pick(value)}>{label}</button>)}
        </menu>
    </>;
}

// GatewayConnectionStore reads the socket and doesn't emit when it drops or comes back, so follow the actions (the
// socket's own state changes only after CONNECTION_INTERRUPTED)
function Connection() {
    const [connected, setConnected] = createSignal(S.Gateway.isConnected());
    let once = connected();
    const on = (type: string, now: boolean) => A.dispatcher.subscribe(type, () => {
        once ||= now;
        setConnected(now);
    });
    on("CONNECTION_OPEN", true);
    on("CONNECTION_RESUMED", true);
    on("CONNECTION_INTERRUPTED", false);
    on("CONNECTION_CLOSED", false);
    return <Show when={!connected()}>
        <p data-mc="notice">{!S.Gateway.isTryingToConnect() ? "Disconnected" : once ? "Reconnecting…" : "Connecting…"}</p>
    </Show>;
}

export function App(p: { root: HTMLElement; }) {
    const channel = () => $.Channel.getChannel(selected()!);
    return <>
        <style>{CSS}</style>
        <Connection />
        <Servers />
        <h1>{selectedGuild() ? $.Guild.getGuild(selectedGuild()!)?.name : "Direct Messages"}</h1>
        <Nav />
        <Me />
        <header style={channel()?.guild_id ? undefined : url(dmIcon(channel()))} data-status={channel()?.guild_id ? undefined : dmStatus(channel())}>
            <Show when={channel()}>{c => <>{c().guild_id ? `# ${c().name}` : dmName(c())}<small>{c().topic}</small></>}</Show>
            <MembersToggle />
        </header>
        <Messages root={p.root} />
        <Composer />
        <Members />
    </>;
}
