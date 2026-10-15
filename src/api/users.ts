// Users: their names, colours and avatars as stock shows them, and presence. Users come as records (a message's author,
// a webhook's included, isn't always in UserStore) or ids.

import type { Id, AnyRecord } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import * as cdn from './cdn'
import { ActivityType, type Channel, type Member, type User } from './types'
import { $ } from './store'
import { text } from './strings'

export const get = (id: Id) => $.User.getUser(id) as User | undefined
export const me = () => $.User.getCurrentUser() as User | undefined

// the user's member in a guild: its nickname and role colour
export const member = (user: User, guildId?: Id | null): Member | undefined =>
  (guildId && ($.GuildMember.getMember(guildId, user.id) as Member | null)) || undefined

// stock's order: the server nickname, the display name, the username
export const nameOf = (user?: AnyRecord | null, nick?: string | null): string =>
  nick ?? user?.globalName ?? user?.username
// a user's name in a server (their nickname there, else their own), as the author line names them
export const displayName = (user: User | undefined, guildId?: Id | null) =>
  nameOf(user, user && member(user, guildId)?.nick)

// Nitro's display name styles: stock's fonts by id, as its stylesheet's @font-face rules name them (the rest have none),
// and its effects
const NAME_FONTS: Record<number, string> = {
  3: 'Sakura',
  4: 'Jellybean',
  6: 'Modern',
  7: 'Medieval',
  8: '"8Bit"',
  10: 'Vampyre',
  12: 'Tempo',
  13: '"Monkey Bars"',
  14: 'Mainframe',
  15: 'Headbang',
  16: 'Journal',
}
const NAME_EFFECTS: Record<number, string> = {
  1: 'solid',
  2: 'gradient',
  3: 'neon',
  4: 'toon',
  5: 'pop',
  6: 'glow',
  7: 'prism',
  8: 'gummy',
}
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`

// a name's style as stock draws it: the font everywhere; the effect in its colours outside servers and on the profile
// (in a server the role's colour shows instead)
export function nameStyle(user: User, effect: boolean) {
  const style = user.displayNameStyles
  if (!style) return undefined
  const colors = style.colors.map(hex)
  return {
    font: NAME_FONTS[style.fontId],
    effect: effect && colors.length ? NAME_EFFECTS[style.effectId] : undefined,
    color: colors[0],
    // a gradient's stops: the one colour twice when there's one
    stops: colors.length > 1 ? colors.join(', ') : `${colors[0]}, ${colors[0]}`,
  }
}

export const avatar = (user: User, guildId: Id | null | undefined, px: number) =>
  user.getAvatarURL(guildId, cdn.size(px))

// online, idle, dnd, offline (invisible shows as offline to others)
export const status = (id: Id): string => $.Presence.getStatus(id)

// stock's rule: anything in a DM
export const can = (permission: bigint, channel: Channel) =>
  channel.isPrivate() || $.Permission.can(permission, channel)

// Your status and activity, as the user panel shows them: the status picked (online, idle, dnd, invisible), set as
// stock's picker sets it (a synced setting), and what you're doing in stock's words ("Playing **x**")
export const STATUSES = {
  online: 'STATUS_ONLINE',
  idle: 'STATUS_IDLE',
  dnd: 'STATUS_DND',
  invisible: 'STATUS_INVISIBLE',
} as const
export const selfStatus = () => $.SelfPresence.getStatus() as keyof typeof STATUSES
export function setStatus(next: string) {
  const prevStatus = S.SelfPresence.getStatus()
  if (next !== prevStatus) A.setStatus({ nextStatus: next, prevStatus })
}
// ActivityTypes: playing, streaming, listening, watching, custom (shown as the status, not here), competing
export const VERBS = {
  [ActivityType.Playing]: 'PLAYING_GAME',
  [ActivityType.Streaming]: 'STREAMING',
  [ActivityType.Listening]: 'LISTENING_TO',
  [ActivityType.Watching]: 'WATCHING',
  [ActivityType.Competing]: 'COMPETING',
} as const
export function activity() {
  const primary = $.LocalActivity.getPrimaryActivity()
  const verb = primary && VERBS[primary.type as keyof typeof VERBS]
  return verb && text(verb, { game: primary.name, name: primary.name })
}
