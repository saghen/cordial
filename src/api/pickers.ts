// Emoji, stickers and GIFs: their images, and the emoji a reaction picks from (the most used, a search).

import { A, S } from '../adapter/needs'
import type { Channel, Emoji } from './records'
import { $ } from './store'

// Discord's emoji images: custom ones from its CDN, unicode ones from its own SVGs (as stock, not the system font)
export const emojiSrc = (e: { id?: Emoji['id']; name?: string; animated?: boolean; surrogates?: string }) =>
  e.id
    ? `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'webp'}?size=48`
    : A.emojis.getURL((e.surrogates ?? e.name)!)

// the reactions used most, as stock's message menu lists them
export const frequentReactions = () => $.Emoji.emojiReactionFrecencyWithoutFetchingLatest.frequently as Emoji[]
// the emoji a reaction search finds in a channel (those usable there)
export const searchReactions = (c: Channel, query: string, count: number) =>
  S.Emoji.searchWithoutFetchingLatest({ channel: c, query, count, intention: 0 }).unlocked as Emoji[]
