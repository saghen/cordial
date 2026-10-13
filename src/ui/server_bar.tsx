// The server bar: DMs with unreads, servers and folders, and the server menu.

import { createSignal, For, Show } from 'solid-js'

import { A, S } from '../adapter/core'
import type { Id, Rec } from '../adapter/discord'
import { Dm, Item, url } from './channels'
import { popAt } from './lib/popover'
import { $, selectedGuild } from './lib/store'

// as stock's click: the channel Discord remembers for the server (persisted across restarts), else its default
const channel = (id: Id) => S.SelectedChannel.getChannelId(id) ?? undefined
// the DM last open, as stock's DMs button
const lastDm = () => S.SelectedChannel.getChannelId('@me')
const acronym = (id: Id) =>
  $.Guild.getGuild(id)
    ?.name.split(/\s+/)
    .map((w: string) => w[0])
    .join('')
    .slice(0, 3)

function Guild(p: { id: Id }) {
  const g = () => $.Guild.getGuild(p.id)
  return (
    <Item
      mc={`guild:${p.id}`}
      title={g()?.name}
      sel={selectedGuild() === p.id}
      label={g()?.icon ? '' : acronym(p.id)}
      icon={guildIcon(p.id)}
      unread={$.GuildReadState.hasUnread(p.id)}
      muted={$.UserGuildSettings.isMuted(p.id)}
      mentions={$.GuildReadState.getMentionCount(p.id)}
      go={() => A.nav.transitionToGuild(p.id, channel(p.id))}
      pre={() => channel(p.id)}
    />
  )
}
const guildIcon = (id: Id) => {
  const icon = $.Guild.getGuild(id)?.icon
  return icon && `https://cdn.discordapp.com/icons/${id}/${icon}.webp?size=96`
}

// a folder: closed, a tile of its first four servers; open, the folder icon in its colour above its servers, on one
// background. Expanding is stock's ExpandedGuildFolderStore (local)
function Folder(p: { folder: ReturnType<typeof S.SortedGuild.getGuildFolders>[number] }) {
  const id = p.folder.folderId!,
    ids = () => p.folder.guildIds
  const open = () => $.ExpandedGuildFolder.isFolderExpanded(id)
  return (
    <div
      class={{ open: open() }}
      style={{ '--folder': `#${(p.folder.folderColor ?? 0x5865f2).toString(16).padStart(6, '0')}` }}
    >
      <a
        data-mc={`folder:${id}`}
        title={
          p.folder.folderName ??
          ids()
            .map((g) => $.Guild.getGuild(g)?.name)
            .join(', ')
        }
        class={{
          folder: true,
          unread: !open() && ids().some((g) => $.GuildReadState.hasUnread(g) && !$.UserGuildSettings.isMuted(g)),
        }}
        data-n={(!open() && ids().reduce((n, g) => n + $.GuildReadState.getMentionCount(g), 0)) || undefined}
        onClick={() => A.guilds.toggleGuildFolderExpand(id)}
      >
        <Show when={!open()}>
          <For each={ids().slice(0, 4)}>{(g) => <i style={url(guildIcon(g))}>{guildIcon(g) ? '' : acronym(g)}</i>}</For>
        </Show>
      </a>
      <Show when={open()}>
        <For each={ids()}>{(g) => <Guild id={g} />}</For>
      </Show>
    </div>
  )
}

export function ServerBar() {
  let bar!: HTMLElement
  return (
    <aside ref={bar}>
      <Item
        mc="dms"
        title="Direct Messages"
        sel={!selectedGuild()}
        pre={lastDm}
        go={() => A.nav.transitionTo(`/channels/@me${lastDm() ? `/${lastDm()}` : ''}`)}
      />
      <For each={$.PrivateChannelReadState.getUnreadPrivateChannelIds()}>{(id) => <Dm id={id} bar />}</For>
      <hr />
      <For each={$.SortedGuild.getGuildFolders()}>
        {(f) => (f.folderId == null ? <Guild id={f.guildIds[0]} /> : <Folder folder={f} />)}
      </For>
      <AddServer />
      <ServerMenu bar={bar} />
    </aside>
  )
}

// Add a Server, by link only (the plan's): an invite link or code, stock's resolve shows the server, Join accepts it and
// opens its channel. Accepting is a write: Liam checks joins by hand
const code = (text: string) =>
  text.trim().match(/(?:discord(?:app)?\.com\/invite|discord\.gg)\/([\w-]+)/)?.[1] ?? text.trim().match(/^[\w-]+$/)?.[0]
function AddServer() {
  const [invite, setInvite] = createSignal<Rec | null | undefined>()
  let form!: HTMLFormElement
  const resolve = (text: string) => {
    const c = code(text)
    if (!c) return setInvite(undefined)
    A.invites.resolveInvite(c, 'Join Guild').then((r) => setInvite(r.invite ?? null))
  }
  return (
    <>
      <button data-mc="add-server" title="Add a Server" popovertarget="mc-join" />
      <form
        ref={form}
        id="mc-join"
        data-mc="join"
        popover
        onSubmit={(e) => {
          e.preventDefault()
          const i = invite()
          if (!i) return
          form.hidePopover()
          A.invites.acceptInviteAndTransitionToInviteChannel({
            inviteKey: i.code,
            context: { location: 'Create or Join Guild Modal' },
          })
        }}
      >
        <label>
          Invite Link
          <input placeholder="https://discord.gg/hTKzmak" onInput={(e) => resolve(e.currentTarget.value)} />
        </label>
        <Show when={invite() !== undefined}>
          <Show when={invite()} fallback={<p>The invite is invalid or has expired.</p>}>
            {(i) => (
              <p
                style={url(
                  i().guild?.icon && `https://cdn.discordapp.com/icons/${i().guild.id}/${i().guild.icon}.webp?size=64`,
                )}
              >
                {i().guild?.name ?? i().channel?.name}
                <small>
                  {i().approximate_presence_count ?? 0} Online · {i().approximate_member_count ?? 0} Members
                </small>
              </p>
            )}
          </Show>
        </Show>
        <button disabled={!invite()}>Join Server</button>
      </form>
    </>
  )
}

function ServerMenu(p: { bar: HTMLElement }) {
  const [guild, setGuild] = createSignal<Id | null>(null)
  let menu!: HTMLMenuElement
  p.bar.addEventListener('contextmenu', (e) => {
    const id = (e.target as Element).closest<HTMLElement>("[data-mc^='guild:']")?.dataset.mc!.slice(6)
    if (!id) return
    setGuild(id)
    popAt(menu, e)
  })
  const act = (fn: (id: Id) => void) => () => {
    menu.hidePopover()
    fn(guild()!)
  }
  const muted = () => $.UserGuildSettings.isMuted(guild()!)

  return (
    <menu ref={menu} data-mc="server-menu" popover>
      <Show when={guild()}>
        <button
          data-mc="menu:read"
          disabled={!$.GuildReadState.getGuildHasUnreadIgnoreMuted(guild()!)}
          onClick={act((id) => A.markGuildsRead([id], 'Guild List'))}
        >
          Mark As Read
        </button>
        <button
          data-mc="menu:mute"
          onClick={act((id) =>
            A.notifications.updateGuildNotificationSettings(id, { muted: !muted() }, muted() ? 'unmuted' : 'muted'),
          )}
        >
          {muted() ? 'Unmute Server' : 'Mute Server'}
        </button>
        <button data-mc="menu:copy-id" onClick={act((id) => navigator.clipboard.writeText(id))}>
          Copy Server ID
        </button>
      </Show>
    </menu>
  )
}
