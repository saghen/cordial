// A server's icon at a size, else its initials on a tile (an invite's server too, which isn't one of ours)

import * as guilds from '../api/guilds'
import type { Guild } from '../api/types'

export const GuildIcon = (p: { guild: Pick<Guild, 'id' | 'name' | 'icon'>; size: number }) => {
  const src = () => guilds.icon(p.guild, p.size)
  return (
    <span class="guild-icon" style={{ '--size': `${p.size}px` }}>
      {src() ? <img src={src()} alt="" /> : guilds.acronym(p.guild)}
    </span>
  )
}
