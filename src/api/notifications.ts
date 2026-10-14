// A server channel's notification settings, as stock's bell: muting it (for a while, or until it's unmuted) and its
// level, which can defer to its category's or server's. Settings are user guild settings: they sync.

import { A, S } from '../adapter/needs'
import type { AnyRecord } from '../adapter/discord'
import { ChannelType, type Channel } from './types'
import { $ } from './store'
import { text } from './strings'

// a channel's override settings, with stock's label for the change
export const update = (channel: Channel, settings: AnyRecord, label: string) =>
  A.notifications.updateChannelOverrideSettings({ guildId: channel.guild_id!, channelId: channel.id, settings, label })

// stock's mute durations, in seconds; -1 until unmuted
export const DURATIONS = [
  [900, 'MUTE_DURATION_15_MINUTES'],
  [3600, 'MUTE_DURATION_1_HOUR'],
  [10800, 'MUTE_DURATION_3_HOURS'],
  [28800, 'MUTE_DURATION_8_HOURS'],
  [86400, 'MUTE_DURATION_24_HOURS'],
  [-1, 'MUTE_DURATION_ALWAYS'],
] as const

export function muteFor(channel: Channel, seconds: number) {
  const end = seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null
  update(channel, { muted: true, mute_config: { selected_time_window: seconds, end_time: end } }, 'muted')
}

// "Muted until 10/13, 5:31 PM", for a mute with an end
export function mutedUntil(channel: Channel) {
  const end = $.UserGuildSettings.getChannelMuteConfig(channel.guild_id!, channel.id)?.end_time
  if (!end) return undefined
  const endTime = new Date(end).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return text('MUTED_UNTIL_TIME', { endTime })
}

// message_notifications, with NULL deferring to the category's or the server's
export const enum Level {
  All = 0,
  Mentions = 1,
  Nothing = 2,
  Default = 3,
}
// with new notifications, a level also sets the channel's unread flags: Mentions with all unreads is
// "@Mentions + Unreads"
const UNREADS_ALL = 1024
const UNREADS_MENTIONS = 512
// stock's UnreadSetting: which unreads a channel or server shows
const enum UnreadSetting {
  Unset = 0,
  AllMessages = 1,
}

export interface Choice {
  level: Level
  unreads?: boolean
  label: string
}

const fresh = (channel: Channel) =>
  $.UserGuildSettings.useNewNotifications &&
  [
    ChannelType.Text,
    ChannelType.Category,
    ChannelType.Announcement,
    ChannelType.Forum,
    ChannelType.ThreadsOnly,
  ].includes(channel.type)

const LABELS = ['FORM_LABEL_ALL_MESSAGES', 'FORM_LABEL_ONLY_MENTIONS_PLAIN', 'FORM_LABEL_NOTHING'] as const
const label = (level: Exclude<Level, Level.Default>, unreads = false) =>
  text(unreads ? 'NOTIFICATION_PRESET_HYBRID' : LABELS[level])

// stock's levels for the channel: none for voice channels, no All Messages in stage channels, "@Mentions + Unreads"
// with new notifications
export function choices(channel: Channel): Choice[] {
  if (channel.type === ChannelType.Voice) return []
  const stage = channel.type === ChannelType.Stage
  return [
    { level: Level.Default, label: text(channel.parent_id ? 'FORM_LABEL_DEFAULT_CATEGORY' : 'FORM_LABEL_DEFAULT') },
    ...(stage ? [] : [{ level: Level.All, label: label(Level.All) }]),
    ...(fresh(channel) ? [{ level: Level.Mentions, unreads: true, label: label(Level.Mentions, true) }] : []),
    { level: Level.Mentions, label: stage ? text('ALL_LIVE_STAGES') : label(Level.Mentions) },
    { level: Level.Nothing, label: label(Level.Nothing) },
  ]
}

const level = (channel: Channel): Level =>
  $.UserGuildSettings.getChannelOverrides(channel.guild_id!)[channel.id]?.message_notifications ?? Level.Default

export function chosen(channel: Channel, choice: Choice) {
  const unreadAll = $.UserGuildSettings.resolveUnreadSetting(channel) === UnreadSetting.AllMessages
  if (choice.unreads) return level(channel) === Level.Mentions && unreadAll
  if (fresh(channel) && choice.level === Level.Mentions) return level(channel) === Level.Mentions && !unreadAll
  return choice.level === level(channel)
}

export function choose(channel: Channel, choice: Choice) {
  const what = `notifications set to ${['all messages', 'mentions', 'nothing', 'the default'][choice.level]}`
  if (!fresh(channel)) return update(channel, { message_notifications: choice.level }, what)
  const flags = S.UserGuildSettings.getChannelIdFlags(channel.guild_id!, channel.id) & ~(UNREADS_ALL | UNREADS_MENTIONS)
  update(channel, { message_notifications: choice.level, flags: flags | unreadFlag(choice) }, what)
}

// the unread flag a choice sets: none for the default
function unreadFlag(choice: Choice) {
  if (choice.level === Level.Default) return 0
  return choice.unreads || choice.level === Level.All ? UNREADS_ALL : UNREADS_MENTIONS
}

// what the default is: the category's level, else the server's
export function fallback(channel: Channel) {
  const settings = $.UserGuildSettings
  const guildId = channel.guild_id!
  const parent = channel.parent_id ? settings.getChannelMessageNotifications(guildId, channel.parent_id) : Level.Default
  const unread = channel.parent_id ? settings.getChannelUnreadSetting(guildId, channel.parent_id) : UnreadSetting.Unset
  // a server's level is never the default
  const inherited = (parent !== Level.Default ? parent : settings.getMessageNotifications(guildId)) as Exclude<
    Level,
    Level.Default
  >
  return label(
    inherited,
    fresh(channel) &&
      inherited === Level.Mentions &&
      (unread || settings.getGuildUnreadSetting(guildId)) === UnreadSetting.AllMessages,
  )
}
