// The top bar, as stock's: the server's name over the channel list, then the channel's icon, name and topic and its
// buttons: a DM's call buttons, notification settings (stock's bell popout: mute, then the channel's level), pinned
// messages, the member list's toggle and search

import { createEffect, createSignal, For, Show } from 'solid-js'

import * as channels from '../api/channels'
import * as guilds from '../api/guilds'
import * as messages from '../api/messages'
import * as notifications from '../api/notifications'
import type { Channel, Id, Message, PrivateChannel } from '../api/records'
import * as search from '../api/search'
import { selectedChannel, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import { ChannelIcon } from '../components/channel_icon'
import { DmIcon } from '../components/dm_icon'
import { Attachment } from '../components/message/attachment'
import { Content } from '../components/message/content'
import { Head } from '../components/message/head'
import { Button, IconButton } from '../primitives/button'
import { Items } from '../primitives/menu'
import { Popout } from '../primitives/popout'
import { SearchInput } from '../primitives/search'
import { CallButtons } from './call'
import { MembersToggle } from './members'

export function Header() {
  return (
    <header>
      <h1>{selectedGuild() ? guilds.get(selectedGuild()!)?.name : text('DIRECT_MESSAGES')}</h1>
      <Show when={selectedChannel()}>
        {(c) => (
          <div class="channel">
            {c().guild_id ? <ChannelIcon channel={c()} /> : <DmIcon channel={c() as PrivateChannel} size={24} status />}
            {c().guild_id ? c().name : channels.dmName(c() as PrivateChannel)}
            <small>{c().topic}</small>
            <div class="toolbar">
              {c().guild_id ? <NotificationBell channel={c()} /> : <CallButtons channel={c() as PrivateChannel} />}
              <Pins channel={c()} />
              <MembersToggle />
              <Search channel={c()} />
            </div>
          </div>
        )}
      </Show>
    </header>
  )
}

export function NotificationBell(p: { channel: Channel }) {
  const c = () => p.channel
  const muted = () => channels.muted(c())
  return (
    <>
      <IconButton
        class={['notifications', { muted: muted() }]}
        icon={muted() ? 'bell-slash' : 'bell'}
        title={text('NOTIFICATION_SETTINGS')}
        popovertarget="mc-notifications"
        // as stock: shift+click mutes or unmutes
        onClick={(e) => {
          if (!e.shiftKey) return
          e.preventDefault()
          channels.setMuted(c(), !muted())
        }}
      />
      <Popout name="notifications" class="notifications-menu">
        <Items
          items={[
            muted()
              ? {
                  name: 'notifications-unmute',
                  label: (
                    <>
                      {text('UNMUTE_CHANNEL_GENERIC')}
                      <small>{notifications.mutedUntil(c())}</small>
                    </>
                  ),
                  run: () => channels.setMuted(c(), false),
                }
              : {
                  name: 'notifications-mute',
                  label: text('MUTE_CHANNEL_GENERIC'),
                  run: () => channels.setMuted(c(), true),
                  submenu: notifications.DURATIONS.map(([secs, name]) => ({
                    name: 'notifications-mute-for',
                    id: String(secs),
                    label: text(name),
                    run: () => notifications.muteFor(c(), secs),
                  })),
                },
            notifications.choices(c()).length > 0 && '-',
            // as stock, the menu stays open
            ...notifications.choices(c()).map((choice) => ({
              name: 'notifications-level',
              id: `${choice.level}${choice.unreads ? ':unreads' : ''}`,
              label: (
                <>
                  {choice.label}
                  <Show when={choice.level === notifications.Level.Default}>
                    <small>{notifications.fallback(c())}</small>
                  </Show>
                </>
              ),
              checked: notifications.chosen(c(), choice),
              keep: true,
              run: () => notifications.choose(c(), choice),
            })),
          ]}
        />
      </Popout>
    </>
  )
}

// a message as a card (pins, search results): its author line, its text and files, Jump to it (stock: to its link)
function Card(p: { m: Message; guildId?: Id | null; jump: string; onJump?: () => void; where?: string }) {
  return (
    <article data-id={p.m.id} class="head">
      <Head m={p.m} guildId={p.guildId}>
        <Show when={p.where}>
          <small>#{p.where}</small>
        </Show>
      </Head>
      <Content m={p.m} channelId={p.m.channel_id} />
      <For each={p.m.attachments}>{(f) => <Attachment file={f} />}</For>
      <Button
        class={`${p.jump}-jump`}
        data-id={p.m.id}
        onClick={() => {
          messages.jumpTo(p.m)
          p.onJump?.()
        }}
      >
        {text('JUMP')}
      </Button>
    </article>
  )
}

// the header's pins: the channel's pinned messages in a popover, newest pin first, each with Jump (stock's: to the
// message's link); opening it acks the pins (stock's CHANNEL_PINS_ACK, the button's dot)
export function Pins(p: { channel: Channel }) {
  const id = () => p.channel.id
  const pins = () => messages.pins(id())
  const items = () => pins()?.items ?? []
  let pop!: HTMLDivElement
  return (
    <>
      <IconButton
        class={['pins', { unread: messages.unreadPins(id()) }]}
        icon="pin"
        title={text('PINNED_MESSAGES')}
        popovertarget="mc-pins"
      />
      <Popout
        ref={pop}
        name="pins"
        as="div"
        class="pins-list"
        onOpen={() => {
          messages.fetchPins(id())
          messages.ackPins(id())
        }}
      >
        <h2>{text('PINNED_MESSAGES')}</h2>
        <Show when={pins() && pins()!.state !== 'LOADING' && !items().length}>
          <p>{text(p.channel.guild_id ? 'NO_PINS_IN_CHANNEL' : 'NO_PINS_IN_DM')}</p>
        </Show>
        <For each={items()}>
          {({ message: m }) => <Card m={m} guildId={p.channel.guild_id} jump="pins" onJump={() => pop.hidePopover()} />}
        </For>
        <Show when={pins()?.state === 'LOADED_HAS_MORE'}>
          <Button class="pins-more" onClick={() => messages.fetchPins(id(), items().at(-1)?.pinnedAt)}>
            {text('LOAD_MORE')}
          </Button>
        </Show>
      </Popout>
    </>
  )
}

// search, as stock's header search bar: Enter searches the server (or the DM); the results open on the right, a page
// at a time
export function Search(p: { channel: Channel }) {
  const c = () => p.channel
  const [offset, setOffset] = createSignal(0)
  let pop!: HTMLDivElement,
    query = ''
  const run = (at: number) => {
    setOffset(at)
    search.run(c(), query, at)
    pop.showPopover()
  }
  // another server or DM: its own search
  createEffect(
    () => search.searchId(c()),
    () => pop.hidePopover(),
  )
  const total = () => search.total(c())
  return (
    <>
      <SearchInput
        class="search"
        placeholder={search.placeholder(c())}
        onEscape={() => pop.hidePopover()}
        onEnter={(q) => {
          if (!q.trim()) return
          query = q.trim()
          run(0)
        }}
      />
      <div
        ref={pop}
        id="mc-search"
        class="search-results"
        popover="manual"
        onToggle={(e) => e.newState === 'closed' && search.clear(c())}
      >
        <h2>
          {search.fetching(c()) ? text('SEARCHING') : text('TOTAL_RESULTS', { count: total() })}
          <IconButton class="search-close" icon="close" title={text('CLOSE')} onClick={() => pop.hidePopover()} />
        </h2>
        <Show when={search.failed(c())}>
          <p>{text('SEARCH_ERROR')}</p>
        </Show>
        <For each={search.results(c())}>
          {(m) => (
            <Card
              m={m}
              guildId={c().guild_id}
              jump="search"
              where={c().guild_id ? channels.get(m.channel_id)?.name : undefined}
            />
          )}
        </For>
        <Show when={total() > search.PAGE}>
          <nav>
            <Button class="search-prev" disabled={offset() === 0} onClick={() => run(offset() - search.PAGE)}>
              {text('BACK')}
            </Button>
            {offset() / search.PAGE + 1} / {Math.ceil(total() / search.PAGE)}
            <Button
              class="search-next"
              disabled={offset() + search.PAGE >= total()}
              onClick={() => run(offset() + search.PAGE)}
            >
              {text('NEXT')}
            </Button>
          </nav>
        </Show>
      </div>
    </>
  )
}
