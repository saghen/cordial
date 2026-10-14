// The top bar, as stock's: the server's name over the channel list, then the channel's icon, name and topic and its
// buttons: a DM's call buttons, notification settings (stock's bell popout: mute, then the channel's level), pinned
// messages, the member list's toggle and search

import { createEffect, createSignal, For, Show } from 'solid-js'

import * as channels from '../api/channels'
import * as guilds from '../api/guilds'
import * as messages from '../api/messages'
import * as notifications from '../api/notifications'
import type { Channel, Id, Message, PrivateChannel } from '../api/types'
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
  function title() {
    const guildId = selectedGuild()
    return guildId ? guilds.get(guildId)?.name : text('DIRECT_MESSAGES')
  }
  return (
    <header>
      <h1>{title()}</h1>
      <Show when={selectedChannel()}>
        {(channel) => (
          <div class="channel">
            {channel().guild_id ? (
              <ChannelIcon channel={channel()} />
            ) : (
              <DmIcon channel={channel() as PrivateChannel} size={24} status />
            )}
            {channel().guild_id ? channel().name : channels.dmName(channel() as PrivateChannel)}
            <small>{channel().topic}</small>
            <div class="toolbar">
              {channel().guild_id ? (
                <NotificationBell channel={channel()} />
              ) : (
                <CallButtons channel={channel() as PrivateChannel} />
              )}
              <Pins channel={channel()} />
              <MembersToggle />
              <Search channel={channel()} />
            </div>
          </div>
        )}
      </Show>
    </header>
  )
}

function NotificationBell(p: { channel: Channel }) {
  const channel = () => p.channel
  const muted = () => channels.muted(channel())
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
          channels.setMuted(channel(), !muted())
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
                      <small>{notifications.mutedUntil(channel())}</small>
                    </>
                  ),
                  run: () => channels.setMuted(channel(), false),
                }
              : {
                  name: 'notifications-mute',
                  label: text('MUTE_CHANNEL_GENERIC'),
                  run: () => channels.setMuted(channel(), true),
                  submenu: notifications.DURATIONS.map(([seconds, name]) => ({
                    name: 'notifications-mute-for',
                    id: String(seconds),
                    label: text(name),
                    run: () => notifications.muteFor(channel(), seconds),
                  })),
                },
            notifications.choices(channel()).length > 0 && '-',
            // as stock, the menu stays open
            ...notifications.choices(channel()).map((choice) => ({
              name: 'notifications-level',
              id: `${choice.level}${choice.unreads ? ':unreads' : ''}`,
              label: (
                <>
                  {choice.label}
                  <Show when={choice.level === notifications.Level.Default}>
                    <small>{notifications.fallback(channel())}</small>
                  </Show>
                </>
              ),
              checked: notifications.chosen(channel(), choice),
              keep: true,
              run: () => notifications.choose(channel(), choice),
            })),
          ]}
        />
      </Popout>
    </>
  )
}

// a message as a card (pins, search results): its author line, its text and files, Jump to it (stock: to its link)
function Card(p: { message: Message; guildId?: Id | null; jump: string; onJump?: () => void; where?: string }) {
  return (
    <article data-id={p.message.id} class="head">
      <Head message={p.message} guildId={p.guildId}>
        <Show when={p.where}>
          <small>#{p.where}</small>
        </Show>
      </Head>
      <Content message={p.message} channelId={p.message.channel_id} />
      <For each={p.message.attachments}>{(file) => <Attachment file={file} />}</For>
      <Button
        class={`${p.jump}-jump`}
        data-id={p.message.id}
        onClick={() => {
          messages.jumpTo(p.message)
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
function Pins(p: { channel: Channel }) {
  const id = () => p.channel.id
  const pins = () => messages.pins(id())
  const items = () => pins()?.items ?? []
  function none() {
    const pinned = pins()
    return pinned && pinned.state !== 'LOADING' && !pinned.items.length
  }
  let popout!: HTMLDivElement
  return (
    <>
      <IconButton
        class={['pins', { unread: messages.unreadPins(id()) }]}
        icon="pin"
        title={text('PINNED_MESSAGES')}
        popovertarget="mc-pins"
      />
      <Popout
        ref={popout}
        name="pins"
        as="div"
        class="pins-list"
        onOpen={() => {
          messages.fetchPins(id())
          messages.ackPins(id())
        }}
      >
        <h2>{text('PINNED_MESSAGES')}</h2>
        <Show when={none()}>
          <p>{text(p.channel.guild_id ? 'NO_PINS_IN_CHANNEL' : 'NO_PINS_IN_DM')}</p>
        </Show>
        <For each={items()}>
          {({ message }) => (
            <Card message={message} guildId={p.channel.guild_id} jump="pins" onJump={() => popout.hidePopover()} />
          )}
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
function Search(p: { channel: Channel }) {
  const channel = () => p.channel
  const [offset, setOffset] = createSignal(0)
  let popover!: HTMLDivElement
  let query = ''
  function run(at: number) {
    setOffset(at)
    search.run(channel(), query, at)
    popover.showPopover()
  }
  // another server or DM has its own search: the results close
  createEffect(
    () => search.searchId(channel()),
    () => popover.hidePopover(),
  )
  const total = () => search.total(channel())
  return (
    <>
      <SearchInput
        class="search"
        placeholder={search.placeholder(channel())}
        onEscape={() => popover.hidePopover()}
        onEnter={(value) => {
          if (!value.trim()) return
          query = value.trim()
          run(0)
        }}
      />
      <div
        ref={popover}
        id="mc-search"
        class="search-results"
        popover="manual"
        onToggle={(e) => e.newState === 'closed' && search.clear(channel())}
      >
        <h2>
          {search.fetching(channel()) ? text('SEARCHING') : text('TOTAL_RESULTS', { count: total() })}
          <IconButton class="search-close" icon="close" title={text('CLOSE')} onClick={() => popover.hidePopover()} />
        </h2>
        <Show when={search.failed(channel())}>
          <p>{text('SEARCH_ERROR')}</p>
        </Show>
        <For each={search.results(channel())}>
          {(message) => (
            <Card
              message={message}
              guildId={channel().guild_id}
              jump="search"
              where={channel().guild_id ? channels.get(message.channel_id)?.name : undefined}
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
