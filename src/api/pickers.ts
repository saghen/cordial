// Emoji, stickers and GIFs: their images, the emoji a reaction picks from (the most used, a search), and the composer's
// pickers, as stock's: emoji and stickers in sections (favorites, the most used, each server's, then unicode's
// categories or Discord's packs) or what a search finds; GIFs as stock's trending categories, favorites and searches.
// The sections read the stores' frecency without depending on it: a picker reads them again on each open.

import { A, S } from '../adapter/needs'
import * as guilds from './guilds'
import {
  EmojiIntention,
  StickerFormat,
  type Channel,
  type Emoji,
  type Gif,
  type Guild,
  type Id,
  type Sticker,
} from './types'
import { $ } from './store'
import { text } from './strings'

// Discord's emoji images: custom ones from its CDN, unicode ones from its own SVGs (as stock, not the system font)
export const emojiSrc = (emoji: { id?: Emoji['id']; name?: string; animated?: boolean; surrogates?: string }) =>
  emoji.id
    ? `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'webp'}?size=48`
    : A.emojis.getURL((emoji.surrogates ?? emoji.name)!)

// the reactions used most, as stock's message menu lists them
export const frequentReactions = () => $.Emoji.emojiReactionFrecencyWithoutFetchingLatest.frequently as Emoji[]
// the emoji a reaction search finds in a channel (those usable there)
export const searchReactions = (channel: Channel, query: string, count: number) =>
  S.Emoji.searchWithoutFetchingLatest({ channel, query, count, intention: EmojiIntention.Reaction }).unlocked as Emoji[]

// a picker's section: its rail shows the server's icon, an icon (favorites, the most used) or its first item
export interface Section<T> {
  id: string
  name: string
  items: T[]
  guild?: Guild
  icon?: 'star' | 'clock'
}

const COUNT = 48
const FREQUENT_STICKERS = 16
// stock's StickerSendability.SENDABLE
const SENDABLE = 0
const premium = () => Boolean(S.User.getCurrentUser()?.premiumType)
function guildSection<T>(id: Id, items: T[]): Section<T> {
  const guild = guilds.get(id)
  return { id, name: guild?.name ?? '', guild, items }
}
// the server an emoji or sticker is from, as the picker's footer names it
const from = (id: Id | null | undefined, name = id ? guilds.get(id)?.name : undefined) =>
  name ? text('EMOJI_FROM_GUILD', { guildName: name }) : undefined

const CATEGORIES = {
  people: 'EMOJI_CATEGORY_PEOPLE',
  nature: 'EMOJI_CATEGORY_NATURE',
  food: 'EMOJI_CATEGORY_FOOD',
  activity: 'EMOJI_CATEGORY_ACTIVITY',
  travel: 'EMOJI_CATEGORY_TRAVEL',
  objects: 'EMOJI_CATEGORY_OBJECTS',
  symbols: 'EMOJI_CATEGORY_SYMBOLS',
  flags: 'EMOJI_CATEGORY_FLAGS',
} as const

// as stock without Nitro: custom emoji only the channel's server's, and not animated
const usable = (emoji: Emoji, guildId: Id | null) =>
  !emoji.id || premium() || (emoji.guildId === guildId && !emoji.animated)
export function emojiSections(channel: Channel): Section<Emoji>[] {
  const context = S.Emoji.getDisambiguatedEmojiContext(channel.guild_id ?? undefined)
  const ok = (emoji: Emoji) => usable(emoji, channel.guild_id)
  const servers = [...(context.getGroupedCustomEmoji() as Map<Id, Emoji[]>)]
    .sort(([guildId]) => (guildId === channel.guild_id ? -1 : 0))
    .map(([id, list]) => guildSection(id, list.filter(ok)))
  const categories = (A.unicodeEmoji.getCategories() as (keyof typeof CATEGORIES)[]).map((id) => ({
    id,
    name: CATEGORIES[id] ? text(CATEGORIES[id]) : id,
    items: A.unicodeEmoji.getByCategory(id) as Emoji[],
  }))
  return [
    {
      id: 'favorites',
      name: text('FAVORITES'),
      icon: 'star' as const,
      items: (context.favoriteEmojisWithoutFetchingLatest as Emoji[]).filter(ok),
    },
    {
      id: 'frequent',
      name: text('FREQUENTLY_USED'),
      icon: 'clock' as const,
      items: (context.getFrequentlyUsedEmojisWithoutFetchingLatest() as Emoji[]).filter(ok).slice(0, COUNT),
    },
    ...servers,
    ...categories,
  ].filter((section) => section.items.length)
}
export const searchEmoji = (channel: Channel, query: string) =>
  S.Emoji.searchWithoutFetchingLatest({ channel, query, count: COUNT, intention: EmojiIntention.Chat })
    .unlocked as Emoji[]
export const emojiFrom = (emoji: Emoji) => from(emoji.guildId)

// stock's rule: this server's stickers, other servers' with Nitro and the permission, Discord's packs once fetched
const sendable = (sticker: Sticker | undefined, channel: Channel): sticker is Sticker =>
  sticker != null && A.stickers.sendability(sticker, S.User.getCurrentUser(), channel) === SENDABLE
export function stickerSections(channel: Channel): Section<Sticker>[] {
  const ok = (sticker: Sticker | undefined) => sendable(sticker, channel)
  const favorites = (S.UserSettingsProto.frecencyWithoutFetchingLatest.favoriteStickers?.stickerIds ?? []) as Id[]
  const servers = [...($.Stickers.getAllGuildStickers() as Map<Id, Sticker[]>)].map(([id, list]) =>
    guildSection(id, list.filter(ok)),
  )
  const packs = ($.Stickers.getPremiumPacks() as { id: Id; name: string; stickers: Sticker[] }[]).map((pack) => ({
    id: pack.id,
    name: pack.name,
    items: pack.stickers,
  }))
  return [
    {
      id: 'favorites',
      name: text('FAVORITES'),
      icon: 'star' as const,
      items: favorites.map((id) => S.Stickers.getStickerById(id) as Sticker | undefined).filter(ok),
    },
    {
      id: 'frequent',
      name: text('FREQUENTLY_USED'),
      icon: 'clock' as const,
      items: (S.StickersPersisted.stickerFrecencyWithoutFetchingLatest.frequently as Sticker[])
        .filter(ok)
        .slice(0, FREQUENT_STICKERS),
    },
    ...servers,
    ...packs,
  ].filter((section) => section.items.length)
}
// the sendable stickers whose name or tags match, once each
export function searchStickers(channel: Channel, query: string) {
  const lowered = query.toLowerCase()
  const found = new Set<Sticker>()
  for (const section of stickerSections(channel))
    for (const sticker of section.items)
      if (sticker.name.toLowerCase().includes(lowered) || sticker.tags?.toLowerCase().includes(lowered))
        found.add(sticker)
  return [...found]
}
// a sticker's image at stock's 160 px (an APNG's animated); none for a Lottie sticker, shown by its name
export function stickerSrc(sticker: Pick<Sticker, 'id' | 'format_type'>) {
  if (sticker.format_type === StickerFormat.Lottie) return undefined
  const extension = sticker.format_type === StickerFormat.GIF ? 'gif' : 'png'
  const animated = sticker.format_type === StickerFormat.APNG ? '&passthrough=true' : ''
  return `https://media.discordapp.net/stickers/${sticker.id}.${extension}?size=160${animated}`
}
export const stickerFrom = (sticker: Sticker) =>
  from(
    sticker.guild_id,
    sticker.guild_id || !sticker.pack_id ? undefined : S.Stickers.getStickerPack(sticker.pack_id)?.name,
  )
export const fetchStickerPacks = () => A.stickers.fetchPacks()

// GIFs: stock's picker loads its trending categories on open; a search, a category (its name searched) or Trending
// fills GIFPickerViewStore's results
export interface GifCategory {
  name: string
  src?: string
  type: string
}
export const isVideo = (src: string) => /\.(mp4|webm)(\?|$)/.test(src)
export function openGifs() {
  A.gifs.initialize()
  A.gifs.trendingCategories()
}
export const gifCategories = () => $.GIFPickerView.getTrendingCategories() as GifCategory[]
export const gifResults = () => $.GIFPickerView.getResultItems() as Gif[]
// kind: stock's kind of result (Search, Category, Trending); `now` skips the search's wait for more typing
export const searchGifs = (query: string, kind: string, now = false) => A.gifs.search(query, kind, now)
export const trendingGifs = () => A.gifs.trending(50)
export const clearGifs = () => A.gifs.clear()
// your favorites, newest first
export const favoriteGifs = (): Gif[] =>
  Object.entries(
    ($.UserSettingsProto.frecencyWithoutFetchingLatest.favoriteGifs?.gifs ?? {}) as Record<
      string,
      Gif & { order: number }
    >,
  )
    .sort(([, left], [, right]) => right.order - left.order)
    .map(([url, gif]) => ({ ...gif, url }))
// stock's select request for a picked result (a favorite has no id, and none)
export function selectGif(gif: Gif, index: number, shown: Gif[], kind: string, query: string | undefined) {
  if (!gif.id) return
  A.gifs.select({
    type: kind,
    index,
    offset: 0,
    limit: null,
    results: shown.length,
    totalResults: shown.length,
    query,
    gifId: gif.id,
  })
}
