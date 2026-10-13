// The server bar: DMs with unreads, servers and folders, and the server menu.

import { createSignal, For, Show } from 'solid-js'

import { A, S } from '../adapter/needs'
import type { Id, Rec } from '../adapter/discord'
import { Dm, Item, url } from './channels'
import { contextMenu, Items } from '../primitives/menu'
import { $, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import { IconButton } from '../primitives/button'
import { Popout } from '../primitives/popout'
import { TextField } from '../primitives/fields'

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
      name="guild"
      id={p.id}
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
export const guildIcon = (id: Id) => {
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
        data-id={id}
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
        name="dms"
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
  let form!: HTMLElement
  const resolve = (text: string) => {
    const c = code(text)
    if (!c) return setInvite(undefined)
    A.invites.resolveInvite(c, 'Join Guild').then((r) => setInvite(r.invite ?? null))
  }
  return (
    <>
      <IconButton class="add-server" icon="plus" title="Add a Server" popovertarget="mc-join" />
      <Popout
        ref={form}
        name="join"
        as="form"
        class="join"
        onSubmit={(e: SubmitEvent) => {
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
        <TextField
          label="Invite Link"
          placeholder="https://discord.gg/hTKzmak"
          onInput={(e) => resolve(e.currentTarget.value)}
        />
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
      </Popout>
    </>
  )
}

function ServerMenu(p: { bar: HTMLElement }) {
  const muted = (id: Id) => $.UserGuildSettings.isMuted(id)
  const menu = contextMenu({
    class: 'server-menu',
    find: (e) => (e.target as Element).closest<HTMLElement>('.guild')?.dataset.id,
    children: (id) => (
      <Items
        items={[
          {
            name: 'menu-read',
            label: text('MARK_AS_READ'),
            disabled: !$.GuildReadState.getGuildHasUnreadIgnoreMuted(id()),
            run: () => A.markGuildsRead([id()], 'Guild List'),
          },
          {
            name: 'menu-mute',
            label: muted(id()) ? 'Unmute Server' : 'Mute Server',
            run: () =>
              A.notifications.updateGuildNotificationSettings(
                id(),
                { muted: !muted(id()) },
                muted(id()) ? 'unmuted' : 'muted',
              ),
          },
          { name: 'menu-copy-id', label: 'Copy Server ID', run: () => navigator.clipboard.writeText(id()) },
        ]}
      />
    ),
  })
  p.bar.addEventListener('contextmenu', menu.open)
  return menu.view
}
