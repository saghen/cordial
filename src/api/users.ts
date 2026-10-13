// Users: their names, colours and avatars as stock shows them, and presence. Users come as records (a message's author,
// a webhook's included, isn't always in UserStore) or ids.

import type { Id, Rec } from '../adapter/discord'
import * as cdn from './cdn'
import type { Member, User } from './records'
import { $ } from './store'

export const get = (id: Id) => $.User.getUser(id) as User | undefined
export const me = () => $.User.getCurrentUser() as User | undefined

// the user's member in a guild: its nickname and role colour
export const member = (user: User, guildId?: Id | null): Member | undefined =>
  (guildId && ($.GuildMember.getMember(guildId, user.id) as Member | null)) || undefined

// stock's order: the server nickname, the display name, the username
export const nameOf = (user?: Rec | null, nick?: string | null): string => nick ?? user?.globalName ?? user?.username

export const avatar = (user: User, guildId: Id | null | undefined, px: number) =>
  user.getAvatarURL(guildId, cdn.size(px))

// online, idle, dnd, offline (invisible shows as offline to others)
export const status = (id: Id): string => $.Presence.getStatus(id)
