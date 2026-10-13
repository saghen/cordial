// The server bar: the DMs button, DMs with unreads, servers and folders, Add a Server, and the server menu.

import { createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import type { Id, Invite } from '../api/records'
import * as guilds from '../api/guilds'
import { onHover } from '../api/preload'
import { $, selected, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import { GuildIcon } from '../components/guild_icon'
import { Badge } from '../primitives/badge'
import { Button, IconButton } from '../primitives/button'
import { TextField } from '../primitives/fields'
import { Icon } from '../primitives/icon'
import { contextMenu, Items } from '../primitives/menu'
import { Popout } from '../primitives/popout'
import { lastDm, openDms } from '../api/channels'
import { dmIcon, dmName } from './channels'

// a row of the bar: the pill (unread, hovered, selected), its icon, and the mention count over the icon's corner
function Tile(p: {
  name: string
  id?: Id | number
  title?: string
  sel?: boolean
  unread?: boolean
  mentions?: number
  go(): void
  // the channel a click opens, preloaded on hover
  pre?(): Id | null | undefined
  children: JSX.Element
}) {
  return (
    <a
      class={[p.name, { sel: !!p.sel, unread: !!p.unread }]}
      data-id={p.id}
      title={p.title}
      onClick={p.go}
      {...(p.pre ? onHover(p.pre) : {})}
    >
      {p.children}
      <Show when={p.mentions}>{(n) => <Badge kind="count">{n()}</Badge>}</Show>
    </a>
  )
}

function Guild(p: { id: Id }) {
  const g = () => guilds.get(p.id)
  return (
    <Show when={g()}>
      {(g) => (
        <Tile
          name="guild"
          id={p.id}
          title={g().name}
          sel={selectedGuild() === p.id}
          unread={guilds.unread(p.id) && !guilds.muted(p.id)}
          mentions={guilds.mentions(p.id)}
          go={() => guilds.open(p.id)}
          pre={() => guilds.lastChannel(p.id)}
        >
          <GuildIcon guild={g()} size={40} />
        </Tile>
      )}
    </Show>
  )
}

function Dm(p: { id: Id }) {
  const c = () => $.Channel.getChannel(p.id)
  return (
    <Tile
      name="dm"
      id={p.id}
      title={dmName(c())}
      sel={selected() === p.id}
      unread={$.ReadState.hasUnread(p.id)}
      mentions={$.ReadState.getMentionCount(p.id)}
      go={() => openDms(p.id)}
      pre={() => p.id}
    >
      <img class="dm-icon" src={dmIcon(c())} alt="" />
    </Tile>
  )
}

// a folder: closed, a tile of its first four servers; open, the folder icon in its colour above its servers, on one
// background
function Folder(p: { folder: guilds.Folder }) {
  const id = p.folder.folderId!,
    ids = () => p.folder.guildIds
  const open = () => guilds.folderOpen(id)
  const folder = (children: JSX.Element) => (
    <Tile
      name="folder"
      id={id}
      title={
        p.folder.folderName ??
        ids()
          .map((g) => guilds.get(g)?.name)
          .join(', ')
      }
      unread={!open() && ids().some((g) => guilds.unread(g) && !guilds.muted(g))}
      mentions={open() ? 0 : ids().reduce((n, g) => n + guilds.mentions(g), 0)}
      go={() => guilds.toggleFolder(id)}
    >
      {children}
    </Tile>
  )
  return (
    <Show
      when={open()}
      fallback={folder(
        <span class="folder-tiles">
          <For each={ids().slice(0, 4)}>
            {(g) => <Show when={guilds.get(g)}>{(g) => <GuildIcon guild={g()} size={19} />}</Show>}
          </For>
        </span>,
      )}
    >
      <div
        class="folder-open"
        style={{
          '--folder': `#${(p.folder.folderColor ?? 0x5865f2).toString(16).padStart(6, '0')}`,
          '--n': ids().length + 1,
        }}
      >
        {folder(
          <span class="folder-icon">
            <Icon name="folder" />
          </span>,
        )}
        <For each={ids()}>{(g) => <Guild id={g} />}</For>
      </div>
    </Show>
  )
}

export function ServerBar() {
  let bar!: HTMLElement
  return (
    <aside ref={bar}>
      <Tile name="dms" title={text('DIRECT_MESSAGES')} sel={!selectedGuild()} pre={lastDm} go={() => openDms(lastDm())}>
        <Icon name="chat" />
      </Tile>
      <For each={$.PrivateChannelReadState.getUnreadPrivateChannelIds()}>{(id) => <Dm id={id} />}</For>
      <hr />
      <For each={guilds.folders()}>
        {(f) => (f.folderId == null ? <Guild id={f.guildIds[0]} /> : <Folder folder={f} />)}
      </For>
      <AddServer />
      <ServerMenu bar={bar} />
    </aside>
  )
}

// Add a Server, by link only (the plan's): an invite link or code, stock's resolve shows the server, Join accepts it and
// opens its channel. Accepting is a write: Liam checks joins by hand
function AddServer() {
  const [invite, setInvite] = createSignal<Invite | null | undefined>()
  let form!: HTMLElement
  const resolve = (link: string) => {
    const code = guilds.inviteCode(link)
    if (!code) return setInvite(undefined)
    guilds.resolveInvite(code).then(setInvite)
  }
  return (
    <>
      <IconButton class="add-server" icon="plus" title={text('ADD_A_SERVER')} popovertarget="mc-join" />
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
          guilds.acceptInvite(i)
        }}
      >
        <TextField
          label={text('FORM_LABEL_INVITE_LINK')}
          placeholder="https://discord.gg/hTKzmak"
          onInput={(e) => resolve(e.currentTarget.value)}
        />
        <Show when={invite() !== undefined}>
          <Show when={invite()} fallback={<p>{text('INSTANT_INVITE_EXPIRED')}</p>}>
            {(i) => (
              <p>
                <Show when={i().guild}>{(g) => <GuildIcon guild={g()} size={48} />}</Show>
                {i().guild?.name ?? i().channel?.name}
                <small>
                  {text('INSTANT_INVITE_GUILD_MEMBERS_ONLINE', { membersOnline: i().approximate_presence_count ?? 0 })}
                  {' · '}
                  {text('INSTANT_INVITE_GUILD_MEMBERS_TOTAL', { count: i().approximate_member_count ?? 0 })}
                </small>
              </p>
            )}
          </Show>
        </Show>
        <Button variant="primary" disabled={!invite()}>
          {text('JOIN_SERVER')}
        </Button>
      </Popout>
    </>
  )
}

function ServerMenu(p: { bar: HTMLElement }) {
  const menu = contextMenu({
    class: 'server-menu',
    find: (e) => (e.target as Element).closest<HTMLElement>('.guild')?.dataset.id,
    children: (id) => (
      <Items
        items={[
          {
            name: 'menu-read',
            label: text('MARK_AS_READ'),
            disabled: !guilds.canMarkRead(id()),
            run: () => guilds.markRead(id()),
          },
          {
            name: 'menu-mute',
            label: text(guilds.muted(id()) ? 'UNMUTE_SERVER' : 'MUTE_SERVER'),
            run: () => guilds.setMuted(id(), !guilds.muted(id())),
          },
          { name: 'menu-copy-id', label: text('COPY_ID_GUILD'), run: () => navigator.clipboard.writeText(id()) },
        ]}
      />
    ),
  })
  p.bar.addEventListener('contextmenu', menu.open)
  return menu.view
}
