// The soundboard, as stock's: the sounds of the call's server first, the other servers', then Discord's; which you
// can use (stock's rule: Nitro for other servers' sounds) and whether you can play in the channel (not while muted).
// The sounds load when it opens (stock's fetch: Discord's over REST, the servers' over the gateway).

import type { Rec } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import * as guilds from './guilds'
import type { Section } from './pickers'
import type { Channel, Id } from './records'
import { $ } from './store'
import { text } from './strings'

// a sound: { soundId, guildId ("0": Discord's), name, emojiId, emojiName, volume, available }
export type Sound = Rec

// the sections in stock's order, as the pickers' (the rail shows each server's icon): each server's sounds, Discord's
// under "Default"
export function sections(c: Channel): Section<Sound>[] {
  const all = $.Soundboard.getSounds() as Map<Id, Sound[]>,
    here = c.guild_id
  const ids = [here, ...[...all.keys()].filter((id) => id !== here && id !== '0'), '0']
  return ids
    .filter((id): id is Id => !!id && !!all.get(id)?.length)
    .map((id) => {
      const guild = id === '0' ? undefined : guilds.get(id)
      return { id, name: guild?.name ?? text('DEFAULT'), guild, items: all.get(id)! }
    })
}
// the sounds whose name matches
export const search = (c: Channel, query: string) => {
  const q = query.toLowerCase()
  return sections(c).flatMap((s) => s.items.filter((sound) => sound.name.toLowerCase().includes(q)))
}
export const usable = (sound: Sound, c: Channel) => A.soundboard.canUse(S.User.getCurrentUser(), sound, c, true)
export const playing = (sound: Sound) => $.Soundboard.isPlayingSound(sound.soundId)
export const play = (sound: Sound, c: Channel) => A.soundboard.canPlay(c) && A.soundboard.play(sound, c.id, [])
export const fetch = () => A.soundboardSounds.fetch()
