// What a message row shows, derived from the records and stores.

import { A, S } from '../../adapter/core'
import type { Id, Rec } from '../../adapter/discord'
import { $ } from './store'

export type Message = Record<string, any> & { id: Id; content: string; timestamp: Date; author: Record<string, any> }
export interface Attachment {
  url: string
  proxy_url: string
  filename: string
  size: number
  content_type?: string
  width?: number
  height?: number
}
export interface Reaction {
  emoji: { id: Id | null; name: string; animated?: boolean }
  count: number
  me: boolean
}

export const PERMS = {
  ADD_REACTIONS: 64n,
  SEND_MESSAGES: 2048n,
  MANAGE_MESSAGES: 8192n,
  READ_MESSAGE_HISTORY: 65536n,
  MENTION_EVERYONE: 131072n,
  PIN_MESSAGES: 1n << 51n,
}

// stock's rule: anything in a DM
export const can = (permission: bigint, channel: Rec) => channel.isPrivate() || $.Permission.can(permission, channel)

export const nameOf = (user?: Rec | null, nick?: string | null): string => nick ?? user?.globalName ?? user?.username

export interface Author {
  id: Id
  name: string
  color: string | null
  avatar: string
  bot: boolean
}

// Stock's grouping rule, ported from Discord's module with "IS_SCHEDULED)!==" (2026-10): it lives in a chunk only
// Discord's message list loads. A message starts a new group unless it continues the previous one: same author
// (and, for webhooks, the same name) within 7 minutes on the same day, both user messages, matching flags.
const GROUP_MS = 7 * 60 * 1000
const USER_MESSAGE = new Set([0, 19, 20, 23, 26, 41, 45, 47, 68])
const REPLY = 19
const HAS_THREAD = 1 << 5,
  EPHEMERAL = 1 << 6,
  SUPPRESS_NOTIFICATIONS = 1 << 12,
  IS_SCHEDULED = 1 << 20

const flag = (m: Message, f: number) => (m.flags & f) !== 0
const orNull = (s: unknown) => (s == null || s === '' ? null : s)

export function startsGroup(channel: Rec | undefined, prev: Message | undefined, m: Message) {
  if (!prev) return true
  if (flag(m, HAS_THREAD) || m.isCommandType?.() || prev.blocked !== m.blocked || prev.ignored !== m.ignored)
    return true
  if (m.applicationId !== prev.applicationId || orNull(m.additionalName) !== orNull(prev.additionalName)) return true
  if (m.type > 0) return USER_MESSAGE.has(prev.type) || m.type === REPLY
  const a = prev.timestamp,
    b = m.timestamp,
    apart = Math.abs(a.getTime() - b.getTime())
  return (
    !USER_MESSAGE.has(prev.type) ||
    prev.author.id !== m.author.id ||
    flag(prev, EPHEMERAL) !== flag(m, EPHEMERAL) ||
    flag(prev, IS_SCHEDULED) !== flag(m, IS_SCHEDULED) ||
    (m.webhookId != null && prev.author.username !== m.author.username) ||
    (channel?.isForumPost?.() && prev.id === channel.id) ||
    !(apart <= 864e5 && a.getDate() === b.getDate()) ||
    !(apart < GROUP_MS) ||
    (flag(m, SUPPRESS_NOTIFICATIONS) && !flag(prev, SUPPRESS_NOTIFICATIONS)) ||
    (flag(prev, SUPPRESS_NOTIFICATIONS) &&
      !flag(m, SUPPRESS_NOTIFICATIONS) &&
      (m.mentions.length > 0 || m.mentionRoles.length > 0 || m.mentionEveryone))
  )
}

export function authorOf(m: Message, guildId: Id | null): Author {
  const u = m.author
  const member = guildId && !m.webhookId ? S.GuildMember.getMember(guildId, u.id) : null
  return {
    id: u.id,
    name: nameOf(u, member?.nick),
    color: member?.colorString ?? null,
    avatar: u.getAvatarURL(guildId, 80),
    bot: !!u.bot,
  }
}

// in Discord's language (the page's lang, set once its locale loads), as stock: "10:59 PM", "5/31/24, 11:15 AM"
const formats = new Map<string, Intl.DateTimeFormat>()
const format = (d: Date, o: Intl.DateTimeFormatOptions) => {
  const key = document.documentElement.lang + JSON.stringify(o)
  let f = formats.get(key)
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat(document.documentElement.lang || undefined, o)))
  return f.format(d)
}

export const clock = (d: Date) => format(d, { timeStyle: 'short' })

// as stock: "10:59 PM", "Yesterday at 10:59 PM", "5/31/24, 11:15 AM"
export function when(d: Date) {
  const day = new Date()
  if (d.toDateString() === day.toDateString()) return clock(d)
  day.setDate(day.getDate() - 1)
  return d.toDateString() === day.toDateString()
    ? `Yesterday at ${clock(d)}`
    : format(d, { dateStyle: 'short', timeStyle: 'short' })
}

// the date divider above a message, when it's the first loaded of its day
export function dayOf(prev: Message | undefined, m: Message) {
  return prev && prev.timestamp.toDateString() !== m.timestamp.toDateString()
    ? format(m.timestamp, { dateStyle: 'long' })
    : undefined
}

// Discord's emoji images: custom ones from its CDN, unicode ones from its own SVGs (as stock, not the system font)
export const emojiSrc = (e: Rec) =>
  e.id
    ? `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'webp'}?size=48`
    : A.emojis.getURL(e.surrogates ?? e.name)

// message content as Discord's markdown AST (what its React output is built from), with message-content options
export function contentAST(m: Message, channelId: Id): any[] {
  return A.markdown.parseToAST(m.content, true, {
    channelId,
    messageId: m.id,
    allowLinks: true,
    allowHeading: true,
    allowList: true,
    allowEmojiLinks: true,
  })
}
