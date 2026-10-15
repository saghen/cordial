// Channels and DMs: a server's channel list and the DMs, their read and mute states, DMs' names and icons, who's in a
// voice channel, and opening them. Channels come as records.

import { createEffect } from 'solid-js'

import { A, S } from '../adapter/needs'
import type { Id } from '../adapter/discord'
import * as cdn from './cdn'
import * as notifications from './notifications'
import { ChannelType, Permission, type Channel, type PrivateChannel } from './types'
import { $, selected } from './store'
import { text } from './strings'
import * as users from './users'
import * as voice from './voice'

export const get = (id: Id) => $.Channel.getChannel(id) as Channel | undefined

// the DM last open, as stock's DMs button
export const lastDm = () => S.SelectedChannel.getChannelId('@me')
// the DMs, at a DM or the friends page
export const openDms = (id?: Id | null) => A.nav.transitionTo(`/channels/@me${id ? `/${id}` : ''}`)
// a user's DM, created first when there's none: stock's PrivateChannelActions.openPrivateChannel
export const openDm = (userId: Id) => A.privateChannels.openPrivateChannel({ recipientIds: userId })
export const open = (channel: Channel) => A.nav.transitionTo(`/channels/${channel.guild_id ?? '@me'}/${channel.id}`)
// a channel link's click (a mention, a link to a channel or to a message: then the message jumped to)
export const openLink = (guildId: Id | null | undefined, channelId: Id, messageId?: Id) =>
  A.nav.transitionTo(`/channels/${guildId ?? '@me'}/${channelId}${messageId ? `/${messageId}` : ''}`)

// what sets a channel's icon apart: announcements, age-restricted and private ones. Private as stock: hidden from
// @everyone, or for voice also closed to it
export function kindOf(channel: Channel): 'news' | 'nsfw' | 'lock' | undefined {
  if (channel.type === ChannelType.Announcement) return 'news'
  if (channel.nsfw) return 'nsfw'
  const deny = BigInt(channel.permissionOverwrites?.[channel.guild_id!]?.deny ?? 0)
  const closed =
    channel.type === ChannelType.Voice ? Permission.VIEW_CHANNEL | Permission.CONNECT : Permission.VIEW_CHANNEL
  return deny & closed ? 'lock' : undefined
}

export const unread = (channel: Channel) => $.ReadState.hasUnread(channel.id)
export const mentions = (channel: Channel) => $.ReadState.getMentionCount(channel.id)
export const canMarkRead = (channel: Channel) => channel.type === ChannelType.Category || unread(channel)
export const markRead = (channel: Channel) => A.acks.markRead(channel)

// a server channel's link, as Copy Link copies it
export const link = (channel: Channel) => `https://discord.com/channels/${channel.guild_id}/${channel.id}`

// a server channel's mute
export const muted = (channel: Channel) => $.UserGuildSettings.isChannelMuted(channel.guild_id!, channel.id)
export const setMuted = (channel: Channel, on: boolean) =>
  notifications.update(channel, { muted: on }, on ? 'muted' : 'unmuted')

// a category's collapse is a user guild setting: it syncs
export const collapsed = (category: Channel) => $.CategoryCollapse.isCollapsed(category.id)
export const toggleCollapsed = (category: Channel) =>
  A.dispatcher.dispatch({
    type: S.CategoryCollapse.isCollapsed(category.id) ? 'CATEGORY_EXPAND' : 'CATEGORY_COLLAPSE',
    id: category.id,
  })

// a server's list: text and announcement channels, then voice channels, under their categories (the uncategorized ones
// first, as GuildChannelStore lists the "null" category). A collapsed category keeps the selected channel
export function rows(guildId: Id): Channel[] {
  const all = $.GuildChannel.getChannels(guildId)
  const ofTypes = (group: { channel: Channel }[] | undefined, ...types: ChannelType[]) =>
    (group ?? []).map((entry) => entry.channel).filter((channel) => types.includes(channel.type))
  const listed = [
    ...ofTypes(all.SELECTABLE, ChannelType.Text, ChannelType.Announcement),
    ...ofTypes(all.VOCAL, ChannelType.Voice),
  ]
  return (all[ChannelType.Category] ?? []).flatMap(({ channel: category }: { channel: Channel }) => {
    const children = listed.filter((channel) => (channel.parent_id ?? 'null') === category.id)
    const shut = collapsed(category)
    return [
      ...(category.id === 'null' || !children.length ? [] : [category]),
      ...children.filter((channel) => !shut || channel.id === selected()),
    ]
  })
}

// the DMs, most recent first (as stock, the first 100)
export const dms = () =>
  $.PrivateChannelSort.getSortedChannels()
    .flat()
    .map((entry) => get(entry.channelId))
    .filter((channel): channel is PrivateChannel => Boolean(channel?.isPrivate()))
    .slice(0, 100)
// the DMs with unreads, for the server bar
export const unreadDms = () => $.PrivateChannelReadState.getUnreadPrivateChannelIds().map(get) as PrivateChannel[]

// as stock: friend nicknames, then display names
const userName = (id: Id) => $.Relationship.getNickname(id) ?? users.nameOf(users.get(id))
export const dmName = (channel: PrivateChannel) => channel.name || channel.recipients.map(userName).join(', ')

// a DM's other user; a group DM has none
export const dmUser = (channel: PrivateChannel) =>
  channel.type === ChannelType.DM ? users.get(channel.recipients[0]) : undefined
// a group DM's icon, else stock's default for it
export const groupIcon = (channel: PrivateChannel, px: number) =>
  A.icons.getChannelIconURL({
    id: channel.id,
    icon: channel.icon,
    applicationId: channel.getApplicationId(),
    size: cdn.size(px),
  })

// under a group DM's name: its size
export const groupSize = (channel: PrivateChannel) =>
  text('GROUP_DM_MEMBER_COUNT', { members: channel.recipients.length + 1 })

// a channel's name as the composer and incoming calls name it: #general, @user, a group's names
export function title(channel: Channel) {
  if (channel.guild_id) return `#${channel.name}`
  const name = dmName(channel as PrivateChannel)
  return channel.type === ChannelType.DM ? `@${name}` : name
}

// Voice channels: since when the call in them has gone on, and their status (who's in them: api/voice.ts)

// when the call in it began, while anyone's in it
export const callStart = (channel: Channel) =>
  voice.states(channel.id).length ? $.VoiceChannelStartTime.getStartTime(channel) : undefined
export const voiceStatus = (channel: Channel) => $.ChannelStatus.getChannelStatus(channel)

// how long a call has gone on, as stock: 2:57:00, 05:12
export function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(seconds / 3600)
  const rest = `${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
  return hours ? `${hours}:${rest}` : rest
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
