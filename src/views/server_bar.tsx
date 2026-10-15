// The server bar: the DMs button, DMs with unreads, servers and folders, Add a Server, and the server menu.

import { createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as channels from '../api/channels'
import type { Id, Invite, PrivateChannel } from '../api/types'
import * as guilds from '../api/guilds'
import { onHover } from '../api/preload'
import { selected, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import * as voice from '../api/voice'
import { DmIcon } from '../components/dm_icon'
import { GuildIcon } from '../components/guild_icon'
import { Badge } from '../primitives/badge'
import { Button, IconButton } from '../primitives/button'
import { TextField } from '../primitives/fields'
import { Icon } from '../primitives/icon'
import { contextMenu, Items } from '../primitives/menu'
import { Popout } from '../primitives/popout'

// a row of the bar: the pill (unread, hovered, selected), its icon, the mention count over the icon's lower corner and
// what goes on in its voice over the upper one
function Tile(p: {
  name: string
  id?: Id | number
  title?: string
  selected?: boolean
  unread?: boolean
  mentions?: number
  activity?: voice.Activity
  open(): void
  // the channel a click opens, preloaded on hover
  preload?(): Id | null | undefined
  children: JSX.Element
}) {
  return (
    <a
      class={[p.name, { selected: Boolean(p.selected), unread: Boolean(p.unread) }]}
      data-id={p.id}
      title={p.title}
      onClick={p.open}
      {...(p.preload ? onHover(p.preload) : {})}
    >
      {p.children}
      <Show when={p.activity}>
        {(activity) => (
          <span class={['activity', { connected: activity().connected }]}>
            <Icon name={activity().icon} />
          </span>
        )}
      </Show>
      <Show when={p.mentions}>{(mentions) => <Badge kind="count">{mentions()}</Badge>}</Show>
    </a>
  )
}

function Guild(p: { id: Id }) {
  const guild = () => guilds.get(p.id)
  return (
    <Show when={guild()}>
      {(record) => (
        <Tile
          name="guild"
          id={p.id}
          title={record().name}
          selected={selectedGuild() === p.id}
          unread={guilds.unread(p.id) && !guilds.muted(p.id)}
          mentions={guilds.mentions(p.id)}
          activity={voice.guildActivity(p.id)}
          open={() => guilds.open(p.id)}
          preload={() => guilds.lastChannel(p.id)}
        >
          <GuildIcon guild={record()} size={40} animate={selectedGuild() === p.id} />
        </Tile>
      )}
    </Show>
  )
}

function Dm(p: { channel: PrivateChannel }) {
  const channel = () => p.channel
  return (
    <Tile
      name="dm"
      id={channel().id}
      title={channels.dmName(channel())}
      selected={selected() === channel().id}
      unread={channels.unread(channel())}
      mentions={channels.mentions(channel())}
      activity={voice.callActivity(channel())}
      open={() => channels.open(channel())}
      preload={() => channel().id}
    >
      <DmIcon channel={channel()} size={40} />
    </Tile>
  )
}

// a folder: closed, a tile of its first four servers; open, the folder icon in its colour above its servers, on one
// background
const FOLDER_TILES = 4
// stock's, for a folder without one
const DEFAULT_FOLDER_COLOR = 0x5865f2
function Folder(p: { folder: guilds.Folder }) {
  const id = p.folder.folderId!
  const ids = () => p.folder.guildIds
  const open = () => guilds.folderOpen(id)
  const folder = (children: JSX.Element) => (
    <Tile
      name="folder"
      id={id}
      title={
        p.folder.folderName ??
        ids()
          .map((guildId) => guilds.get(guildId)?.name)
          .join(', ')
      }
      unread={!open() && ids().some((guildId) => guilds.unread(guildId) && !guilds.muted(guildId))}
      mentions={open() ? 0 : ids().reduce((total, guildId) => total + guilds.mentions(guildId), 0)}
      // as stock: closed, the voice badge of the server you're connected in, if any
      activity={
        open()
          ? undefined
          : ids()
              .map(voice.guildActivity)
              .find((activity) => activity?.connected)
      }
      open={() => guilds.toggleFolder(id)}
    >
      {children}
    </Tile>
  )
  return (
    <Show
      when={open()}
      fallback={folder(
        <span class="folder-tiles">
          <For each={ids().slice(0, FOLDER_TILES)}>
            {(guildId) => <Show when={guilds.get(guildId)}>{(guild) => <GuildIcon guild={guild()} size={19} />}</Show>}
          </For>
        </span>,
      )}
    >
      <div
        class="folder-open"
        style={{
          '--folder': `#${(p.folder.folderColor ?? DEFAULT_FOLDER_COLOR).toString(16).padStart(6, '0')}`,
          '--count': ids().length + 1,
        }}
      >
        {folder(
          <span class="folder-icon">
            <Icon name="folder" />
          </span>,
        )}
        <For each={ids()}>{(guildId) => <Guild id={guildId} />}</For>
      </div>
    </Show>
  )
}

export function ServerBar() {
  let bar!: HTMLElement
  return (
    <aside ref={bar}>
      <Tile
        name="dms"
        title={text('DIRECT_MESSAGES')}
        selected={!selectedGuild()}
        preload={channels.lastDm}
        open={() => channels.openDms(channels.lastDm())}
      >
        <Icon name="chat" />
      </Tile>
      <For each={channels.unreadDms()}>{(channel) => <Dm channel={channel} />}</For>
      <hr />
      <For each={guilds.folders()}>
        {(folder) => (folder.folderId == null ? <Guild id={folder.guildIds[0]} /> : <Folder folder={folder} />)}
      </For>
      <AddServer />
      <ServerMenu bar={bar} />
    </aside>
  )
}

// Add a Server, by link only: an invite link or code, stock's resolve shows the server, Join accepts it and opens its
// channel
function AddServer() {
  const [invite, setInvite] = createSignal<Invite | null | undefined>()
  let form!: HTMLElement
  function resolve(link: string) {
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
          const resolved = invite()
          if (!resolved) return
          form.hidePopover()
          guilds.acceptInvite(resolved)
        }}
      >
        <TextField
          label={text('FORM_LABEL_INVITE_LINK')}
          placeholder="https://discord.gg/hTKzmak"
          onInput={(e) => resolve(e.currentTarget.value)}
        />
        <Show when={invite() !== undefined}>
          <Show when={invite()} keyed fallback={<p>{text('INSTANT_INVITE_EXPIRED')}</p>}>
            {(resolved) => (
              <p>
                <Show when={resolved.guild} keyed>
                  {(guild) => <GuildIcon guild={guild} size={48} />}
                </Show>
                {resolved.guild?.name ?? resolved.channel?.name}
                <small>
                  {text('INSTANT_INVITE_GUILD_MEMBERS_ONLINE', {
                    membersOnline: resolved.approximate_presence_count ?? 0,
                  })}
                  {' · '}
                  {text('INSTANT_INVITE_GUILD_MEMBERS_TOTAL', { count: resolved.approximate_member_count ?? 0 })}
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
