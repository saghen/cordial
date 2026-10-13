// The server bar: DMs with unreads, servers and folders, and the server menu.

import { createSignal, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";
import { Dm, Item, url } from "./channels";
import { popAt } from "./lib/popover";
import { $, selectedGuild } from "./lib/store";

const acronym = (id: Id) => $.Guild.getGuild(id)?.name.split(/\s+/).map((w: string) => w[0]).join("").slice(0, 3);

function Guild(p: { id: Id; }) {
    const g = () => $.Guild.getGuild(p.id);
    return <Item mc={`guild:${p.id}`} title={g()?.name} sel={selectedGuild() === p.id}
        label={g()?.icon ? "" : acronym(p.id)} icon={guildIcon(p.id)} unread={$.GuildReadState.hasUnread(p.id)} muted={$.UserGuildSettings.isMuted(p.id)}
        mentions={$.GuildReadState.getMentionCount(p.id)} go={() => A.nav.transitionToGuild(p.id)} />;
}
const guildIcon = (id: Id) => {
    const icon = $.Guild.getGuild(id)?.icon;
    return icon && `https://cdn.discordapp.com/icons/${id}/${icon}.webp?size=96`;
};

// a folder: closed, a tile of its first four servers; open, the folder icon in its colour above its servers, on one
// background. Expanding is stock's ExpandedGuildFolderStore (local)
function Folder(p: { folder: ReturnType<typeof S.SortedGuild.getGuildFolders>[number]; }) {
    const id = p.folder.folderId!, ids = () => p.folder.guildIds;
    const open = () => $.ExpandedGuildFolder.isFolderExpanded(id);
    return <div class={{ open: open() }} style={{ "--folder": `#${(p.folder.folderColor ?? 0x5865f2).toString(16).padStart(6, "0")}` }}>
        <a data-mc={`folder:${id}`} title={p.folder.folderName ?? ids().map(g => $.Guild.getGuild(g)?.name).join(", ")}
            class={{ folder: true, unread: !open() && ids().some(g => $.GuildReadState.hasUnread(g) && !$.UserGuildSettings.isMuted(g)) }}
            data-n={!open() && ids().reduce((n, g) => n + $.GuildReadState.getMentionCount(g), 0) || undefined}
            onClick={() => A.guilds.toggleGuildFolderExpand(id)}>
            <Show when={!open()}><For each={ids().slice(0, 4)}>{g => <i style={url(guildIcon(g))}>{guildIcon(g) ? "" : acronym(g)}</i>}</For></Show>
        </a>
        <Show when={open()}><For each={ids()}>{g => <Guild id={g} />}</For></Show>
    </div>;
}

export function ServerBar() {
    let bar!: HTMLElement;
    return <aside ref={bar}>
        <Item mc="dms" title="Direct Messages" sel={!selectedGuild()} go={() => {
            // the DM last open, as stock
            const last = S.SelectedChannel.getChannelId("@me");
            A.nav.transitionTo(`/channels/@me${last ? `/${last}` : ""}`);
        }} />
        <For each={$.PrivateChannelReadState.getUnreadPrivateChannelIds()}>{id => <Dm id={id} bar />}</For>
        <hr />
        <For each={$.SortedGuild.getGuildFolders()}>{f => f.folderId == null ? <Guild id={f.guildIds[0]} /> : <Folder folder={f} />}</For>
        <ServerMenu bar={bar} />
    </aside>;
}

function ServerMenu(p: { bar: HTMLElement; }) {
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
