// A server channel's notification settings, as stock's bell: muting it (for a while, or until it's unmuted) and its
// level, which can defer to its category's or server's. Settings are user guild settings: they sync.

import { A, S } from '../adapter/needs'
import type { Rec } from '../adapter/discord'
import { ChannelType, type Channel } from './types'
import { $ } from './store'
import { text } from './strings'

// a channel's override settings, with stock's label for the change
export const update = (c: Channel, settings: Rec, label: string) =>
  A.notifications.updateChannelOverrideSettings({ guildId: c.guild_id!, channelId: c.id, settings, label })

// stock's mute durations, in seconds; -1 until unmuted
export const DURATIONS = [
  [900, 'MUTE_DURATION_15_MINUTES'],
  [3600, 'MUTE_DURATION_1_HOUR'],
  [10800, 'MUTE_DURATION_3_HOURS'],
  [28800, 'MUTE_DURATION_8_HOURS'],
  [86400, 'MUTE_DURATION_24_HOURS'],
  [-1, 'MUTE_DURATION_ALWAYS'],
] as const

export function muteFor(c: Channel, secs: number) {
  const end = secs > 0 ? new Date(Date.now() + secs * 1000).toISOString() : null
  update(c, { muted: true, mute_config: { selected_time_window: secs, end_time: end } }, 'muted')
}

// "Muted until 10/13, 5:31 PM", for a mute with an end
export function mutedUntil(c: Channel) {
  const end = $.UserGuildSettings.getChannelMuteConfig(c.guild_id!, c.id)?.end_time
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
const UNREADS_ALL = 1024,
  UNREADS_MENTIONS = 512

export interface Choice {
  level: Level
  unreads?: boolean
  label: string
}

const fresh = (c: Channel) =>
  $.UserGuildSettings.useNewNotifications &&
  [
    ChannelType.Text,
    ChannelType.Category,
    ChannelType.Announcement,
    ChannelType.Forum,
    21 /* GUILD_THREADS_ONLY */,
  ].includes(c.type)

const LABELS = ['FORM_LABEL_ALL_MESSAGES', 'FORM_LABEL_ONLY_MENTIONS_PLAIN', 'FORM_LABEL_NOTHING'] as const
const label = (level: Exclude<Level, Level.Default>, unreads = false) =>
  text(unreads ? 'NOTIFICATION_PRESET_HYBRID' : LABELS[level])

// stock's levels for the channel: none for voice channels, no All Messages in stage channels, "@Mentions + Unreads"
// with new notifications
export function choices(c: Channel): Choice[] {
  if (c.type === ChannelType.Voice) return []
  const stage = c.type === ChannelType.Stage
  return [
    { level: Level.Default, label: text(c.parent_id ? 'FORM_LABEL_DEFAULT_CATEGORY' : 'FORM_LABEL_DEFAULT') },
    ...(stage ? [] : [{ level: Level.All, label: label(Level.All) }]),
    ...(fresh(c) ? [{ level: Level.Mentions, unreads: true, label: label(Level.Mentions, true) }] : []),
    { level: Level.Mentions, label: stage ? text('ALL_LIVE_STAGES') : label(Level.Mentions) },
    { level: Level.Nothing, label: label(Level.Nothing) },
  ]
}

const level = (c: Channel): Level =>
  $.UserGuildSettings.getChannelOverrides(c.guild_id!)[c.id]?.message_notifications ?? Level.Default

export function chosen(c: Channel, choice: Choice) {
  const unreadAll = $.UserGuildSettings.resolveUnreadSetting(c) === 1
  if (choice.unreads) return level(c) === Level.Mentions && unreadAll
  if (fresh(c) && choice.level === Level.Mentions) return level(c) === Level.Mentions && !unreadAll
  return choice.level === level(c)
}

export function choose(c: Channel, choice: Choice) {
  const what = `notifications set to ${['all messages', 'mentions', 'nothing', 'the default'][choice.level]}`
  if (!fresh(c)) return update(c, { message_notifications: choice.level }, what)
  const flags = S.UserGuildSettings.getChannelIdFlags(c.guild_id!, c.id) & ~(UNREADS_ALL | UNREADS_MENTIONS)
  const unread =
    choice.level === Level.Default ? 0 : choice.unreads || choice.level === Level.All ? UNREADS_ALL : UNREADS_MENTIONS
  update(c, { message_notifications: choice.level, flags: flags | unread }, what)
}

// what the default is: the category's level, else the server's
export function fallback(c: Channel) {
  const U = $.UserGuildSettings,
    g = c.guild_id!
  const parent = c.parent_id ? U.getChannelMessageNotifications(g, c.parent_id) : Level.Default
  const unread = c.parent_id ? U.getChannelUnreadSetting(g, c.parent_id) : 0
  // a server's level is never the default
  const level = (parent !== Level.Default ? parent : U.getMessageNotifications(g)) as Exclude<Level, Level.Default>
  return label(level, fresh(c) && level === Level.Mentions && (unread || U.getGuildUnreadSetting(g)) === 1)
}
