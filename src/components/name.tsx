// A user's name as stock shows it: the server nickname in its role colour, @ before it when a reply pings them, APP
// after a bot's. A Nitro display name style: its font everywhere, its effect outside servers and on the profile

import type { Id, User } from '../api/types'
import * as users from '../api/users'
import { Badge } from '../primitives/badge'

export function Name(p: {
  user: User
  guildId?: Id | null
  at?: boolean
  // the profile's: the style's effect even in a server, without the role's colour
  profile?: boolean
  // the text shown instead of their name (a DM's: a friend nickname)
  label?: string
  onClick?(e: MouseEvent): void
}) {
  const member = () => users.member(p.user, p.guildId)
  const style = () => users.nameStyle(p.user, Boolean(p.profile) || !p.guildId)
  return (
    <b
      class={['name', style()?.effect]}
      style={{
        color: p.profile ? undefined : (member()?.colorString ?? undefined),
        '--name-font': style()?.font && `${style()!.font}, var(--font)`,
        '--name-color': style()?.color,
        '--name-stops': style()?.stops,
      }}
      onClick={p.onClick}
    >
      {p.at && '@'}
      {p.label ?? users.nameOf(p.user, member()?.nick)}
      {p.user.bot && <Badge kind="app">APP</Badge>}
    </b>
  )
}
