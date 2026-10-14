// The soundboard, as stock's: the sounds of the call's server first, the other servers', then Discord's; which you
// can use (stock's rule: Nitro for other servers' sounds) and whether you can play in the channel (not while muted).
// The sounds load when it opens (stock's fetch: Discord's over REST, the servers' over the gateway).

import type { AnyRecord } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import * as guilds from './guilds'
import type { Section } from './pickers'
import type { Channel, Id } from './types'
import { $ } from './store'
import { text } from './strings'

// a sound: { soundId, guildId ("0": Discord's), name, emojiId, emojiName, volume, available }
export type Sound = AnyRecord

// the sections in stock's order, as the pickers' (the rail shows each server's icon): each server's sounds, Discord's
// under "Default"
export function sections(channel: Channel): Section<Sound>[] {
  const all = $.Soundboard.getSounds() as Map<Id, Sound[]>
  const here = channel.guild_id
  const ids = [here, ...[...all.keys()].filter((id) => id !== here && id !== '0'), '0']
  return ids
    .filter((id): id is Id => id != null && (all.get(id)?.length ?? 0) > 0)
    .map((id) => {
      const guild = id === '0' ? undefined : guilds.get(id)
      return { id, name: guild?.name ?? text('DEFAULT'), guild, items: all.get(id)! }
    })
}
// the sounds whose name matches
export function search(channel: Channel, query: string) {
  const lowered = query.toLowerCase()
  return sections(channel).flatMap((section) =>
    section.items.filter((sound) => sound.name.toLowerCase().includes(lowered)),
  )
}
export const usable = (sound: Sound, channel: Channel) =>
  A.soundboard.canUse(S.User.getCurrentUser(), sound, channel, true)
export const playing = (sound: Sound) => $.Soundboard.isPlayingSound(sound.soundId)
export const play = (sound: Sound, channel: Channel) =>
  A.soundboard.canPlay(channel) && A.soundboard.play(sound, channel.id, [])
export const fetch = () => A.soundboardSounds.fetch()
