// A user's avatar (or an image in its place: a group DM's icon), round, at a size in px; with a status, stock's shape
// at its bottom right in a ring cut out of it; speaking, ringed in green inside its edge; decorated, their avatar
// decoration (Nitro) around it, playing while hovered (or always: the profile) and the window is focused. A double right
// click on someone's avatar opens their DM (ours; the views find it).

import { createSignal } from 'solid-js'

import * as channels from '../api/channels'
import { windowFocused } from '../api/hooks'
import { selectedChannel } from '../api/store'
import { ChannelType, type Id, type User } from '../api/types'
import * as users from '../api/users'
import { Status } from '../primitives/status'

// stock's: a decoration a fifth larger than the avatar, centred on it (avatar.css's --decoration-scale)
const DECORATION_SCALE = 1.2

// a double right click on their avatar: their DM opened unless a DM is open already, it's you, or they can't have one
// (a webhook)
export function avatarDoubleRight(user: User, canDm = true) {
  if (!canDm || selectedChannel()?.type === ChannelType.DM || user.id === users.me()?.id) return
  void channels.openDm(user.id)
}

export function Avatar(p: {
  user?: User
  src?: string
  guildId?: Id | null
  size: number
  status?: string
  speaking?: boolean
  decorated?: boolean | 'playing'
  onClick?(e: MouseEvent): void
}) {
  const [hovered, setHovered] = createSignal(false)
  const decoration = () =>
    p.decorated && p.user
      ? users.decoration(
          p.user,
          Math.round(p.size * DECORATION_SCALE),
          (p.decorated === 'playing' || hovered()) && windowFocused(),
        )
      : undefined
  return (
    <span
      class={['avatar', { speaking: Boolean(p.speaking), clickable: Boolean(p.onClick) }]}
      style={{ '--size': `${p.size}px` }}
      onClick={p.onClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <img src={p.src ?? users.avatar(p.user!, p.guildId, p.size)} alt="" />
      {decoration() && <img class="decoration" src={decoration()} alt="" />}
      {p.status && <Status kind={p.status} />}
    </span>
  )
}
