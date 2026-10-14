// The channel header's buttons: notification settings (stock's bell popout: mute, then the channel's level), pinned
// messages and search

import { createEffect, createSignal, For, Show } from 'solid-js'

import { A, S } from '../adapter/needs'
import type { Id, Rec } from '../adapter/discord'
import * as channels from '../api/channels'
import * as messages from '../api/messages'
import * as notifications from '../api/notifications'
import type { Channel, Message } from '../api/records'
import { $ } from '../api/store'
import { text } from '../api/strings'
import { Attachment } from '../components/message/attachment'
import { Content } from '../components/message/content'
import { Head } from '../components/message/head'
import { Button, IconButton } from '../primitives/button'
import { Items } from '../primitives/menu'
import { Popout } from '../primitives/popout'
import { SearchInput } from '../primitives/search'

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
export function Pins(p: { channel: Rec }) {
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

// search, as stock's header search bar: Enter searches the server (or the DM) through stock's own search, whose parser
// reads from:, in:, has:, before: and the rest; the results open on the right, 25 a page, newest first
const PAGE = 25

export function Search(p: { channel: Rec }) {
  const guildId = () => p.channel.guild_id as Id | undefined
  // stock's search context and its id in SearchMessageStore
  const context = () =>
    guildId() ? { type: 'GUILD', guildId: guildId() } : { type: 'CHANNEL', channelId: p.channel.id }
  const id = () => guildId() ?? (p.channel.id as Id)
  const [offset, setOffset] = createSignal(0)
  let pop!: HTMLDivElement,
    query = ''
  const run = async (at: number) => {
    setOffset(at)
    const search = await A.search.load()
    search.fetchMessages({
      searchContext: context(),
      searchQueryString: query,
      pagination: { offset: at },
      searchMode: 'newest',
      searchEverywhere: false,
      searchAnalyticsIds: null,
      // as stock: a page replaces the last
      onFetchStart: () => search.clearSearchMessages(id()),
    })
    pop.showPopover()
  }
  // another server or DM: its own search
  createEffect(id, () => pop.hidePopover())
  const total = () => $.Search.getTotalCount(id()) ?? 0
  return (
    <>
      <SearchInput
        class="search"
        placeholder={guildId() ? `Search ${$.Guild.getGuild(guildId()!)?.name}` : 'Search'}
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
        onToggle={(e) => {
          if (e.newState === 'closed') A.search.load().then((s) => s.clearSearchMessages(id()))
        }}
      >
        <h2>
          {$.Search.getIsFetching(id()) ? 'Searching…' : `${total().toLocaleString()} Results`}
          <IconButton class="search-close" icon="close" title="Close" onClick={() => pop.hidePopover()} />
        </h2>
        <Show when={$.Search.getError(id())}>
          <p>Something went wrong. Try again.</p>
        </Show>
        <For each={($.Search.getMessages(id()) ?? []) as Message[]}>
          {(m) => (
            <Card
              m={m}
              guildId={guildId()}
              jump="search"
              where={guildId() ? $.Channel.getChannel(m.channel_id)?.name : undefined}
            />
          )}
        </For>
        <Show when={total() > PAGE}>
          <nav>
            <Button class="search-prev" disabled={offset() === 0} onClick={() => run(offset() - PAGE)}>
              Back
            </Button>
            {offset() / PAGE + 1} / {Math.ceil(total() / PAGE)}
            <Button class="search-next" disabled={offset() + PAGE >= total()} onClick={() => run(offset() + PAGE)}>
              Next
            </Button>
          </nav>
        </Show>
      </div>
    </>
  )
}
