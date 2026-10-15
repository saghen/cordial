// A server's icon at a size, else its initials on a tile (an invite's server too, which isn't one of ours). Given
// `animate`, an animated icon plays while hovered or while `animate` holds (the server bar's selected server), and only
// while the window is focused, as stock's GIFs

import { createSignal } from 'solid-js'

import * as guilds from '../api/guilds'
import { windowFocused } from '../api/hooks'
import type { Guild } from '../api/types'

export function GuildIcon(p: { guild: Pick<Guild, 'id' | 'name' | 'icon'>; size: number; animate?: boolean }) {
  const [hovered, setHovered] = createSignal(false)
  const playing = () => p.animate !== undefined && (hovered() || p.animate) && windowFocused()
  const src = () => guilds.icon(p.guild, p.size, playing())
  return (
    <span
      class="guild-icon"
      style={{ '--size': `${p.size}px` }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {src() ? <img src={src()} alt="" /> : guilds.acronym(p.guild)}
    </span>
  )
}
