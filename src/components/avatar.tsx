// A user's avatar (or an image in its place: a group DM's icon), round, at a size in px; with a status, stock's shape
// at its bottom right in a ring cut out of it; speaking, ringed in green inside its edge; decorated, their avatar
// decoration (Nitro) around it, playing while hovered (or always: the profile) and the window is focused

import { createSignal } from 'solid-js'

import { windowFocused } from '../api/hooks'
import type { Id, User } from '../api/types'
import * as users from '../api/users'
import { Status } from '../primitives/status'

// stock's: a decoration a fifth larger than the avatar, centred on it (avatar.css's --decoration-scale)
const DECORATION_SCALE = 1.2

export function Avatar(p: {
  user?: User
  src?: string
  guildId?: Id | null
  size: number
  status?: string
  speaking?: boolean
  decorated?: boolean | 'playing'
  onClick?(e: MouseEvent): void
  onDblClick?(e: MouseEvent): void
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
      onDblClick={p.onDblClick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <img src={p.src ?? users.avatar(p.user!, p.guildId, p.size)} alt="" />
      {decoration() && <img class="decoration" src={decoration()} alt="" />}
      {p.status && <Status kind={p.status} />}
    </span>
  )
}
