// A user's avatar (or an image in its place: a group DM's icon), round, at a size in px; with a status, stock's shape
// at its bottom right in a ring cut out of it; speaking, ringed in green

import type { Id, User } from '../api/records'
import * as users from '../api/users'
import { Status } from '../primitives/status'

export const Avatar = (p: {
  user?: User
  src?: string
  guildId?: Id | null
  size: number
  status?: string
  speaking?: boolean
}) => (
  <span class={['avatar', { speaking: !!p.speaking }]} style={{ '--size': `${p.size}px` }}>
    <img src={p.src ?? users.avatar(p.user!, p.guildId, p.size)} alt="" />
    {p.status && <Status kind={p.status} />}
  </span>
)
