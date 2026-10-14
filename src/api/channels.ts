// Channels and DMs: a server's channel list and the DMs, their read and mute states, DMs' names and icons, who's in a
// voice channel, and opening them. Channels come as records.

import { createEffect } from 'solid-js'

import { A, S } from '../adapter/needs'
import type { Id } from '../adapter/discord'
import * as cdn from './cdn'
import { ChannelType, type Channel, type PrivateChannel } from './records'
import { $, selected } from './store'
import { text } from './strings'
import * as users from './users'
import * as voice from './voice'

export const get = (id: Id) => $.Channel.getChannel(id) as Channel | undefined

// the DM last open, as stock's DMs button
export const lastDm = () => S.SelectedChannel.getChannelId('@me')
// the DMs, at a DM or the friends page
export const openDms = (id?: Id | null) => A.nav.transitionTo(`/channels/@me${id ? `/${id}` : ''}`)
export const open = (c: Channel) => A.nav.transitionTo(`/channels/${c.guild_id ?? '@me'}/${c.id}`)

// what sets a channel's icon apart: announcements, age-restricted and private ones. Private as stock: hidden from
// @everyone, or for voice also closed to it
export function kindOf(c: Channel): 'news' | 'nsfw' | 'lock' | undefined {
  if (c.type === ChannelType.Announcement) return 'news'
  if (c.nsfw) return 'nsfw'
  const deny = BigInt(c.permissionOverwrites?.[c.guild_id!]?.deny ?? 0)
  const closed = c.type === ChannelType.Voice ? (1n << 10n) | (1n << 20n) : 1n << 10n
  return deny & closed ? 'lock' : undefined
}

export const unread = (c: Channel) => $.ReadState.hasUnread(c.id)
export const mentions = (c: Channel) => $.ReadState.getMentionCount(c.id)
export const canMarkRead = (c: Channel) => c.type === ChannelType.Category || unread(c)
export const markRead = (c: Channel) => A.acks.markRead(c)

// a server channel's mute
export const muted = (c: Channel) => $.UserGuildSettings.isChannelMuted(c.guild_id!, c.id)
export const setMuted = (c: Channel, on: boolean) =>
  A.notifications.updateChannelOverrideSettings({
    guildId: c.guild_id!,
    channelId: c.id,
    settings: { muted: on },
    label: on ? 'muted' : 'unmuted',
  })

// a category's collapse is a user guild setting: it syncs
export const collapsed = (cat: Channel) => $.CategoryCollapse.isCollapsed(cat.id)
export const toggleCollapsed = (cat: Channel) =>
  A.dispatcher.dispatch({
    type: S.CategoryCollapse.isCollapsed(cat.id) ? 'CATEGORY_EXPAND' : 'CATEGORY_COLLAPSE',
    id: cat.id,
  })

// a server's list: text and announcement channels, then voice channels, under their categories (the uncategorized ones
// first, as GuildChannelStore lists the "null" category). A collapsed category keeps the selected channel
export function rows(guildId: Id): Channel[] {
  const all = $.GuildChannel.getChannels(guildId)
  const of = (group: { channel: Channel }[] | undefined, ...types: ChannelType[]) =>
    (group ?? []).map((x) => x.channel).filter((c) => types.includes(c.type))
  const listed = [
    ...of(all.SELECTABLE, ChannelType.Text, ChannelType.Announcement),
    ...of(all.VOCAL, ChannelType.Voice),
  ]
  return (all[ChannelType.Category] ?? []).flatMap(({ channel: cat }: { channel: Channel }) => {
    const rows = listed.filter((c) => (c.parent_id ?? 'null') === cat.id)
    const shut = collapsed(cat)
    return [...(cat.id === 'null' || !rows.length ? [] : [cat]), ...rows.filter((c) => !shut || c.id === selected())]
  })
}

// the DMs, most recent first (as stock, the first 100)
export const dms = () =>
  $.PrivateChannelSort.getSortedChannels()
    .flat()
    .map((c) => get(c.channelId))
    .filter((c): c is PrivateChannel => !!c?.isPrivate())
    .slice(0, 100)
// the DMs with unreads, for the server bar
export const unreadDms = () => $.PrivateChannelReadState.getUnreadPrivateChannelIds().map(get) as PrivateChannel[]

// as stock: friend nicknames, then display names
const userName = (id: Id) => $.Relationship.getNickname(id) ?? users.nameOf(users.get(id))
export const dmName = (c: PrivateChannel) => c.name || c.recipients.map(userName).join(', ')

// a DM's other user; a group DM has none
export const dmUser = (c: PrivateChannel) => (c.type === ChannelType.DM ? users.get(c.recipients[0]) : undefined)
// a group DM's icon, else stock's default for it
export const groupIcon = (c: PrivateChannel, px: number) =>
  A.icons.getChannelIconURL({ id: c.id, icon: c.icon, applicationId: c.getApplicationId(), size: cdn.size(px) })

// under a DM's name: a group's size, a user's custom status
export function dmSub(c: PrivateChannel) {
  const user = dmUser(c)
  if (!user) return text('GROUP_DM_MEMBER_COUNT', { members: c.recipients.length + 1 })
  return $.Presence.getActivities(user.id).find((a) => a.type === 4)?.state
}

// a channel's name as the header and the composer name it: #general, @user, a group's names
export const title = (c: Channel) =>
  c.guild_id
    ? `#${c.name}`
    : c.type === ChannelType.DM
      ? `@${dmName(c as PrivateChannel)}`
      : dmName(c as PrivateChannel)

// Voice channels: since when the call in them has gone on, and their status (who's in them: api/voice.ts)

// when the call in it began, while anyone's in it
export const callStart = (c: Channel) =>
  voice.states(c.id).length ? $.VoiceChannelStartTime.getStartTime(c) : undefined
export const voiceStatus = (c: Channel) => $.ChannelStatus.getChannelStatus(c)

// how long a call has gone on, as stock: 2:57:00, 05:12
export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)),
    pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600),
    rest = `${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
  return h ? `${h}:${rest}` : rest
}

// as stock's voice rows: a server's voice channel statuses, asked for once (op 43) until a resume clears them
export function useVoiceStatuses(guildId: () => Id | null) {
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
