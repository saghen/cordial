// The channel header's buttons: notification settings (stock's bell popout: mute, then the channel's level), pinned
// messages and search

import { createEffect, createSignal, For, Show } from 'solid-js'

import { A, S } from '../adapter/needs'
import type { Id, Rec } from '../adapter/discord'
import { renderAST } from '../components/markdown'
import { authorOf, contentAST, type Message } from '../api/model'
import { when } from '../api/strings'
import { $ } from '../api/store'

// message_notifications: ALL_MESSAGES 0, ONLY_MENTIONS 1, NO_MESSAGES 2, NULL 3 (the category's or server's)
const LEVELS = ['All Messages', 'Only @mentions', 'Nothing']
// unread settings (new notifications): ONLY_MENTIONS 2 with ALL_MESSAGES 1 unreads is "hybrid"
const UNREADS_ALL = 1024,
  UNREADS_MENTIONS = 512
const MUTE = [
  [900, 'For 15 Minutes'],
  [3600, 'For 1 Hour'],
  [10800, 'For 3 Hours'],
  [28800, 'For 8 Hours'],
  [86400, 'For 24 Hours'],
  [-1, 'Until I turn it back on'],
] as const

export function NotificationBell(p: { channel: Rec }) {
  const c = () => p.channel
  const muted = () => $.UserGuildSettings.isChannelMuted(c().guild_id, c().id)
  const update = (settings: Rec, label: string) =>
    A.notifications.updateChannelOverrideSettings({ guildId: c().guild_id, channelId: c().id, settings, label })
  const mute = (on: boolean) => update({ muted: on }, on ? 'muted' : 'unmuted')
  const until = () => {
    const end = $.UserGuildSettings.getChannelMuteConfig(c().guild_id, c().id)?.end_time
    return (
      end &&
      `Muted until ${new Date(end).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    )
  }
  // stock's levels: none for voice channels, no All Messages in stage channels; with new notifications (and a text-like
  // channel) a level also sets the unread flags, and "@Mentions + Unreads" joins them
  const fresh = () => $.UserGuildSettings.useNewNotifications && [0, 4, 5, 15, 21].includes(c().type)
  const items = (): { level: number; label: string; unreads?: boolean }[] => {
    if (c().type === 2) return []
    const all = c().type === 13 ? [] : [{ level: 0, label: LEVELS[0] }]
    const hybrid = fresh() ? [{ level: 1, label: '@Mentions + Unreads', unreads: true }] : []
    return [
      { level: 3, label: c().parent_id ? 'Use Category Default' : 'Use Server Default' },
      ...all,
      ...hybrid,
      { level: 1, label: c().type === 13 ? 'All Live Stages' : LEVELS[1] },
      { level: 2, label: LEVELS[2] },
    ]
  }
  const level = () => $.UserGuildSettings.getChannelOverrides(c().guild_id)[c().id]?.message_notifications ?? 3
  const unreadAll = () => $.UserGuildSettings.resolveUnreadSetting(c()) === 1
  // what the default is: the category's, or the server's
  const fallback = () => {
    const U = $.UserGuildSettings,
      g = c().guild_id,
      parent = c().parent_id ? U.getChannelMessageNotifications(g, c().parent_id) : 3,
      unread = c().parent_id ? U.getChannelUnreadSetting(g, c().parent_id) : 0
    const level = parent !== 3 ? parent : U.getMessageNotifications(g)
    return fresh() && level === 1 && (unread || U.getGuildUnreadSetting(g)) === 1
      ? '@Mentions + Unreads'
      : LEVELS[level]
  }
  const set = (level: number, unreads = false) => {
    const label = `notifications set to ${['all messages', 'mentions', 'nothing', 'the default'][level]}`
    if (!fresh()) return update({ message_notifications: level }, label)
    const flags = S.UserGuildSettings.getChannelIdFlags(c().guild_id, c().id) & ~(UNREADS_ALL | UNREADS_MENTIONS)
    const unread = level === 3 ? 0 : unreads || level === 0 ? UNREADS_ALL : UNREADS_MENTIONS
    update({ message_notifications: level, flags: flags | unread }, label)
  }
  let menu!: HTMLMenuElement
  return (
    <>
      <button
        class={['notifications', { muted: muted() }]}
        title="Notification Settings"
        popovertarget="mc-notifications"
        // as stock: shift+click mutes or unmutes
        onClick={(e) => {
          if (!e.shiftKey) return
          e.preventDefault()
          mute(!muted())
        }}
      />
      <menu ref={menu} id="mc-notifications" class="notifications-menu" popover>
        <Show
          when={muted()}
          fallback={
            <>
              <button class="notifications-mute" onClick={() => (mute(true), menu.hidePopover())}>
                Mute Channel
              </button>
              <menu>
                <For each={MUTE}>
                  {([secs, label]) => (
                    <button
                      class="notifications-mute-for"
                      data-id={secs}
                      onClick={() => {
                        const end = secs > 0 ? new Date(Date.now() + secs * 1000).toISOString() : null
                        update({ muted: true, mute_config: { selected_time_window: secs, end_time: end } }, 'muted')
                        menu.hidePopover()
                      }}
                    >
                      {label}
                    </button>
                  )}
                </For>
              </menu>
            </>
          }
        >
          <button class="notifications-unmute" onClick={() => (mute(false), menu.hidePopover())}>
            Unmute Channel
            <small>{until()}</small>
          </button>
        </Show>
        <Show when={items().length}>
          <hr />
        </Show>
        <For each={items()}>
          {(i) => (
            <button
              class={[
                'notifications-level',
                {
                  on: i.unreads
                    ? level() === 1 && unreadAll()
                    : fresh() && i.level === 1
                      ? level() === 1 && !unreadAll()
                      : i.level === level(),
                },
              ]}
              data-id={`${i.level}${i.unreads ? ':unreads' : ''}`}
              // as stock, the menu stays open
              onClick={() => set(i.level, i.unreads)}
            >
              {i.label}
              <Show when={i.level === 3}>
                <small>{fallback()}</small>
              </Show>
            </button>
          )}
        </For>
      </menu>
    </>
  )
}

// a message as a card (pins, search results): its author, time and text, Jump to it (stock: to its link)
function Card(p: { m: Message; guildId?: Id; jump: string; onJump?: () => void; where?: string }) {
  const a = authorOf(p.m, p.guildId ?? null)
  return (
    <article data-id={p.m.id} class="head" style={{ '--av': `url(${a.avatar})` }}>
      <b style={{ color: a.color ?? undefined }}>{a.name}</b>
      <time class="ts">{when(p.m.timestamp)}</time>
      <Show when={p.where}>
        <small>#{p.where}</small>
      </Show>
      {'\n'}
      <span ref={(s) => renderAST(contentAST(p.m, p.m.channel_id), s)} />
      {p.m.attachments?.map((f: Rec) => (
        <a class="file" href={f.url} target="_blank" rel="noreferrer noopener">
          {f.filename}
        </a>
      ))}
      <button
        class={`${p.jump}-jump`}
        data-id={p.m.id}
        onClick={() => {
          A.nav.transitionTo(`/channels/${p.guildId ?? '@me'}/${p.m.channel_id}/${p.m.id}`)
          p.onJump?.()
        }}
      >
        Jump
      </button>
    </article>
  )
}

// stock's fetchPins (its pins chunk, not loaded without it): a page of 25, unless the store has them or is loading
function fetchPins(channelId: Id, before?: Date) {
  const pins = S.ChannelPins.getPins(channelId)
  const need =
    !pins ||
    pins.state === 'FAILED' ||
    (pins.state === 'LOADED_HAS_MORE' && (before ? pins.items.at(-1)?.pinnedAt === before : !pins.items.length))
  if (!need) return
  A.dispatcher.dispatch({ type: 'LOAD_PINNED_MESSAGES', channelId, reset: false })
  A.rest
    .get({
      url: A.endpoints.PINS(channelId),
      query: { limit: 25, before: before?.toISOString() },
      retries: 2,
      oldFormErrors: true,
      rejectWithError: true,
    })
    .then(
      (r) =>
        A.dispatcher.dispatch({
          type: 'LOAD_PINNED_MESSAGES_SUCCESS',
          pins: r.body.items,
          channelId,
          hasMore: r.body.has_more,
        }),
      () => A.dispatcher.dispatch({ type: 'LOAD_PINNED_MESSAGES_FAILURE', channelId }),
    )
}

// the header's pins: the channel's pinned messages in a popover, newest pin first, each with Jump (stock's: to the
// message's link); opening it acks the pins (stock's CHANNEL_PINS_ACK, the button's dot)
export function Pins(p: { channel: Rec }) {
  const id = () => p.channel.id
  const pins = () => $.ChannelPins.getPins(id())
  const items = () => (pins()?.items ?? []) as { message: Message; pinnedAt: Date }[]
  let pop!: HTMLDivElement
  return (
    <>
      <button
        class={['pins', { unread: $.ReadState.hasUnreadPins(id()) }]}
        title="Pinned Messages"
        popovertarget="mc-pins"
      />
      <div
        ref={pop}
        id="mc-pins"
        class="pins-list"
        popover
        onToggle={(e) => {
          if (e.newState !== 'open') return
          fetchPins(id())
          if (S.ReadState.hasUnreadPins(id())) A.dispatcher.dispatch({ type: 'CHANNEL_PINS_ACK', channelId: id() })
        }}
      >
        <h2>Pinned Messages</h2>
        <Show when={pins() && pins()!.state !== 'LOADING' && !items().length}>
          <p>
            {p.channel.guild_id
              ? "This channel doesn't have any pinned messages... yet."
              : "This direct message doesn't have any pinned messages... yet."}
          </p>
        </Show>
        <For each={items()}>
          {({ message: m }) => <Card m={m} guildId={p.channel.guild_id} jump="pins" onJump={() => pop.hidePopover()} />}
        </For>
        <Show when={pins()?.state === 'LOADED_HAS_MORE'}>
          <button class="pins-more" onClick={() => fetchPins(id(), items().at(-1)?.pinnedAt)}>
            Load More
          </button>
        </Show>
      </div>
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
      <input
        class="search"
        type="search"
        placeholder={guildId() ? `Search ${$.Guild.getGuild(guildId()!)?.name}` : 'Search'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return pop.hidePopover()
          if (e.key !== 'Enter' || !e.currentTarget.value.trim()) return
          query = e.currentTarget.value.trim()
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
          <button class="search-close" title="Close" onClick={() => pop.hidePopover()} />
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
            <button class="search-prev" disabled={offset() === 0} onClick={() => run(offset() - PAGE)}>
              Back
            </button>
            {offset() / PAGE + 1} / {Math.ceil(total() / PAGE)}
            <button class="search-next" disabled={offset() + PAGE >= total()} onClick={() => run(offset() + PAGE)}>
              Next
            </button>
          </nav>
        </Show>
      </div>
    </>
  )
}
