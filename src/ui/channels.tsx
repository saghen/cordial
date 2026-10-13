// The channel list: a server's channels and voice channels, or the DMs. Server icons, channels, categories and DMs
// are all the same <a> (Item): its state is classes, its icon and badge the CSS's ::before and ::after.

import { createEffect, createSignal, For, Show } from 'solid-js'

import { A, S } from '../adapter/core'
import type { Id, Rec } from '../adapter/discord'
import { nameOf } from './lib/model'
import { contextMenu, Items } from './lib/menu'
import { preload } from './lib/preload'
import { $, selected, selectedGuild } from './lib/store'

export const url = (src?: string | null) => (src ? { '--icon': `url(${src})` } : undefined)

// a channel's icon (style.ts): announcements, age-restricted and private ones have their own. Private as stock: hidden
// from @everyone, or for voice also closed to it (View Channel 1 << 10, Connect 1 << 20)
export const kindOf = (c: Rec) =>
  c.type === 5
    ? 'news'
    : c.nsfw
      ? 'nsfw'
      : BigInt(c.permissionOverwrites?.[c.guild_id]?.deny ?? 0) & (c.type === 2 ? 1049600n : 1024n)
        ? 'lock'
        : undefined

export function Item(p: {
  mc?: string
  label?: string
  sub?: string
  title?: string
  icon?: string | null
  status?: string
  kind?: string
  sel?: boolean
  unread?: boolean
  muted?: boolean
  mentions?: number
  go(): void
  // the channel a click opens, preloaded when the pointer stays (lib/preload.ts)
  pre?(): Id | null | undefined
}) {
  let t = 0
  return (
    <a
      data-mc={p.mc}
      title={p.title}
      style={url(p.icon)}
      data-status={p.status}
      data-n={p.mentions || undefined}
      class={[p.kind, { sel: !!p.sel, unread: !!p.unread && !p.muted, muted: !!p.muted }]}
      onClick={p.go}
      onPointerEnter={() => p.pre && (t = setTimeout(() => preload(p.pre!()), 100))}
      onPointerLeave={() => clearTimeout(t)}
    >
      {p.label}
      <Show when={p.sub}>
        <small>{p.sub}</small>
      </Show>
    </a>
  )
}

// as stock: friend nicknames, then display names
const userName = (id: Id) => $.Relationship.getNickname(id) ?? nameOf($.User.getUser(id))

export function dmName(c?: Rec) {
  return c?.name || (c?.recipients ?? []).map(userName).join(', ')
}

// a DM shows its user's avatar and status; a group DM its icon
function dmUser(c?: Rec) {
  return c?.type === 1 ? $.User.getUser(c.recipients[0]) : undefined
}
export function dmIcon(c?: Rec) {
  return (
    dmUser(c)?.getAvatarURL(undefined, 64) ??
    (c && A.icons.getChannelIconURL({ id: c.id, icon: c.icon, applicationId: c.getApplicationId?.(), size: 64 }))
  )
}
export function dmStatus(c?: Rec) {
  const user = dmUser(c)
  return user && $.Presence.getStatus(user.id)
}

// under a DM's name: a group's size, a user's custom status
function dmSub(c?: Rec) {
  const user = dmUser(c)
  return c?.type === 3
    ? `${c.recipients.length + 1} Members`
    : user && $.Presence.getActivities(user.id).find((a) => a.type === 4)?.state
}

export function Dm(p: { id: Id; bar?: boolean }) {
  const c = () => $.Channel.getChannel(p.id)
  const name = () => dmName(c())
  return (
    <Item
      mc={`dm:${p.id}`}
      title={name()}
      label={p.bar ? '' : name()}
      sub={p.bar ? undefined : dmSub(c())}
      icon={dmIcon(c())}
      status={p.bar ? undefined : dmStatus(c())}
      sel={selected() === p.id}
      unread={$.ReadState.hasUnread(p.id)}
      mentions={$.ReadState.getMentionCount(p.id)}
      go={() => A.nav.transitionTo(`/channels/@me/${p.id}`)}
      pre={() => p.id}
    />
  )
}

// text and announcement channels, then voice channels, under their categories (the uncategorized ones first, as
// GuildChannelStore lists the "null" category). A collapsed category keeps the selected channel. Collapsing is a user
// guild setting: it syncs
function channelRows(guildId: Id) {
  const all = $.GuildChannel.getChannels(guildId)
  const text: Rec[] = (all.SELECTABLE ?? []).map((x: Rec) => x.channel).filter((c: Rec) => c.type === 0 || c.type === 5)
  const voice: Rec[] = (all.VOCAL ?? []).map((x: Rec) => x.channel).filter((c: Rec) => c.type === 2)
  return (all[4] ?? []).flatMap(({ channel: cat }: Rec) => {
    const rows = [...text, ...voice].filter((c) => (c.parent_id ?? 'null') === cat.id)
    const shut = $.CategoryCollapse.isCollapsed(cat.id)
    return [...(cat.id === 'null' || !rows.length ? [] : [cat]), ...rows.filter((c) => !shut || c.id === selected())]
  })
}

export function Channels() {
  useChannelInfo(selectedGuild)
  const menu = channelMenu()
  return (
    <nav onContextMenu={menu.open}>
      <Show
        when={selectedGuild()}
        keyed
        fallback={
          <For
            each={$.PrivateChannelSort.getSortedChannels()
              .flat()
              .filter((c) => $.Channel.getChannel(c.channelId)?.isPrivate())
              .slice(0, 100)}
          >
            {(c) => <Dm id={c.channelId} />}
          </For>
        }
      >
        {(guildId) => (
          <For each={channelRows(guildId)}>
            {(c) =>
              c.type === 2 ? (
                <VoiceRow channel={c} />
              ) : c.type === 4 ? (
                <a
                  data-mc={`category:${c.id}`}
                  class={['cat', { collapsed: $.CategoryCollapse.isCollapsed(c.id) }]}
                  onClick={() =>
                    A.dispatcher.dispatch({
                      type: S.CategoryCollapse.isCollapsed(c.id) ? 'CATEGORY_EXPAND' : 'CATEGORY_COLLAPSE',
                      id: c.id,
                    })
                  }
                >
                  {c.name}
                </a>
              ) : (
                <Item
                  mc={`channel:${c.id}`}
                  label={c.name}
                  kind={kindOf(c)}
                  sel={selected() === c.id}
                  unread={$.ReadState.hasUnread(c.id)}
                  muted={$.UserGuildSettings.isChannelMuted(guildId, c.id)}
                  mentions={$.ReadState.getMentionCount(c.id)}
                  go={() => A.nav.transitionTo(`/channels/${guildId}/${c.id}`)}
                  pre={() => c.id}
                />
              )
            }
          </For>
        )}
      </Show>
      {menu.view}
    </nav>
  )
}

// a right click on a channel or a category: stock's Mark As Read, Mute, Copy Link and Copy Channel ID
function channelMenu() {
  const menu = contextMenu((e) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-mc^='channel:'], [data-mc^='category:']")
    return row && (S.Channel.getChannel(row.dataset.mc!.split(':')[1]) as Rec | undefined)
  })
  const muted = (c: Rec) => $.UserGuildSettings.isChannelMuted(c.guild_id, c.id)
  const what = (c: Rec) => (c.type === 4 ? 'Category' : 'Channel')
  const view = (
    <menu ref={menu.ref} data-mc="channel-menu" popover>
      <Show when={menu.target()}>
        {(c) => (
          <Items
            items={[
              {
                mc: 'menu:read',
                label: 'Mark As Read',
                disabled: c().type !== 4 && !$.ReadState.hasUnread(c().id),
                run: () => A.acks.markRead(c()),
              },
              {
                mc: 'menu:mute',
                label: `${muted(c()) ? 'Unmute' : 'Mute'} ${what(c())}`,
                run: () =>
                  A.notifications.updateChannelOverrideSettings({
                    guildId: c().guild_id,
                    channelId: c().id,
                    settings: { muted: !muted(c()) },
                    label: muted(c()) ? 'unmuted' : 'muted',
                  }),
              },
              {
                mc: 'menu:copy-link',
                label: 'Copy Link',
                run: () => navigator.clipboard.writeText(`https://discord.com/channels/${c().guild_id}/${c().id}`),
              },
              { mc: 'menu:copy-id', label: 'Copy Channel ID', run: () => navigator.clipboard.writeText(c().id) },
            ]}
          />
        )}
      </Show>
    </menu>
  )
  return { open: menu.open, view }
}

// as stock's voice rows: a server's voice channel statuses, once until a resume clears them (op 43)
function useChannelInfo(guildId: () => Id | null) {
  createEffect(
    () => {
      const id = guildId()
      return id && $.GuildChannel.getChannels(id).VOCAL?.length && !$.ChannelStatus.hasRequestedStatuses(id) ? id : null
    },
    (id) => {
      if (id) A.channelInfo(id)
    },
  )
}

// how long the call has gone on, as stock: 2:57:00, 05:12
function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)),
    pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600),
    rest = `${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
  return h ? `${h}:${rest}` : rest
}

function VoiceRow(p: { channel: Rec }) {
  const users = () => Object.values($.VoiceState.getVoiceStatesForChannel(p.channel.id)) as Rec[]
  const start = () => (users().length ? $.VoiceChannelStartTime.getStartTime(p.channel) : undefined)
  const [now, setNow] = createSignal(Date.now())
  createEffect(start, (s) => {
    if (!s) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  })
  return (
    <>
      <a
        data-mc={`voice:${p.channel.id}`}
        class={{
          voice: true,
          lock: kindOf(p.channel) === 'lock',
          live: users().length > 0,
          sel: $.RTCConnection.getChannelId() === p.channel.id,
        }}
        data-time={start() ? elapsed(now() - start()!) : undefined}
        onClick={() => A.voice.selectVoiceChannel(p.channel.id)}
      >
        {p.channel.name}
        <Show when={$.ChannelStatus.getChannelStatus(p.channel)}>{(s) => <small>{s()}</small>}</Show>
      </a>
      <For each={users()}>
        {(v) => {
          const user = () => $.User.getUser(v.userId)
          // as stock: you, connected from another client, dimmed
          const elsewhere = () =>
            v.userId === $.User.getCurrentUser()?.id && $.RTCConnection.getChannelId() !== p.channel.id
          return (
            <a
              data-mc={`voice-user:${v.userId}`}
              style={url(user()?.getAvatarURL(p.channel.guild_id, 32))}
              class={{
                speaking: $.Speaking.isSpeaking(v.userId),
                mute: v.selfMute || v.mute,
                deaf: v.selfDeaf || v.deaf,
                forced: v.mute || v.deaf,
                elsewhere: elsewhere(),
              }}
            >
              {nameOf(user(), $.GuildMember.getMember(p.channel.guild_id, v.userId)?.nick)}
              <Show when={v.selfStream}>
                <b>LIVE</b>
              </Show>
            </a>
          )
        }}
      </For>
    </>
  )
}
