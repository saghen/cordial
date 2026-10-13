// A user's name as stock shows it: the server nickname in its role colour, @ before it when a reply pings them, APP
// after a bot's

import type { Id, User } from '../api/records'
import * as users from '../api/users'
import { Badge } from '../primitives/badge'

export function Name(p: { user: User; guildId?: Id | null; at?: boolean }) {
  const member = () => users.member(p.user, p.guildId)
  return (
    <b class="name" style={{ color: member()?.colorString ?? undefined }}>
      {p.at && '@'}
      {users.nameOf(p.user, member()?.nick)}
      {p.user.bot && <Badge kind="app">APP</Badge>}
    </b>
  )
}
