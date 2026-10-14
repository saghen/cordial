// The member list, as stock's: shown while stock's section state says MEMBERS, a server's (ChannelMemberStore: groups
// by hoisted role, online, offline) or a group DM's (its recipients and you by name, one group). Discord fills a
// server's list only for the ranges a client subscribes to: as stock's list, the view asks for the rows in view
// (stock's range helper) when it opens and as it scrolls.

import { A } from '../adapter/needs'
import { ChannelType, type Id, type PrivateChannel, type User } from './types'
import { $, selected, selectedChannel, selectedGuild } from './store'
import { text } from './strings'
import * as users from './users'

// a row's height, as the range helper counts rows
const ROW = 44

// a server's channels and group DMs have a list; whether it's open is stock's (toggled from the header)
export const listed = () => Boolean(selectedGuild()) || selectedChannel()?.type === ChannelType.GroupDM
export const open = () => listed() && $.ChannelSection.getSection(selected()!, false) === 'MEMBERS'
export const toggle = () => A.channelSections.toggleMembersSection()

export interface Group {
  type: 'GROUP'
  id: string
  // as stock's: "Online — 3", a group DM's "Members—3"
  label: string
}
export interface Member {
  type: 'MEMBER'
  user: User
  status: string
}
// ChannelMemberStore's props: its rows (a server's not loaded yet are undefined) and its groups' counts
interface Props {
  rows: ({ type: 'GROUP'; id: Id; title: string } | { type: 'MEMBER'; user: User; status: string } | undefined)[]
  groups: { id: Id; count: number }[]
}
// the rows in order; a server's not loaded yet are undefined, kept for their place
export function rows(): (Group | Member | undefined)[] {
  const guildId = selectedGuild()
  if (!guildId) return groupRows()
  const props = $.ChannelMember.getProps(guildId, selected()!) as Props
  // a group row carries no count: it's in groups
  return props.rows.map((r): Group | Member | undefined =>
    r?.type === 'GROUP'
      ? { type: 'GROUP', id: r.id, label: `${r.title} — ${props.groups.find((g) => g.id === r.id)?.count ?? 0}` }
      : r && { type: 'MEMBER', user: r.user, status: r.status },
  )
}
function groupRows(): (Group | Member)[] {
  const c = selectedChannel()
  if (!c || c.type !== ChannelType.GroupDM) return []
  const all = [...(c as PrivateChannel).recipients, users.me()?.id]
    .map((id) => id && users.get(id))
    .filter((u): u is User => Boolean(u))
    .sort((a, b) => users.nameOf(a).localeCompare(users.nameOf(b)))
  return [
    { type: 'GROUP', id: 'members', label: `${text('MEMBERS')}—${all.length}` },
    ...all.map((user) => ({ type: 'MEMBER' as const, user, status: users.status(user.id) })),
  ]
}

// the server's rows from y to y + height in the list
export function subscribe(y: number, height: number) {
  const guildId = selectedGuild()
  if (guildId) A.memberSubscriptions.range({ guildId, channelId: selected()!, y, height, rowHeight: ROW })
}
