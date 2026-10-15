// A user's profile as a card shows it: fetched on open by stock's popout fetch (its rules for when), read from
// UserProfileStore (a server's own bio, pronouns and banner over the user's), with what they're doing (PresenceStore)
// and their roles in the server (GuildRoleStore).

import { createSignal } from 'solid-js'

import { A, S } from '../adapter/needs'
import { $ } from './store'
import { ActivityType, type Emoji, type Id, type MarkdownNode, type User } from './types'
import { text } from './strings'
import * as users from './users'

const BANNER_PX = 600
const MINUTE_MS = 60_000
const ACTIVITY_IMAGE_PX = 120

// stock's popout's fetch, ported from its chunk: not while one runs; a profile not loaded yet, or one fetched over a
// minute ago (not after a 404 or a 429 until then), or without the servers you share; then as the popout asks
export function fetch(user: User, guildId: Id | null | undefined) {
  if (S.UserProfile.isFetchingProfile(user.id, guildId)) return
  const shown =
    guildId == null ? S.UserProfile.getUserProfile(user.id) : S.UserProfile.getGuildMemberProfile(user.id, guildId)
  const stale = Date.now() - (shown?.fetchEndedAt ?? 0) >= MINUTE_MS
  if ((shown?.fetchError?.status === 404 || shown?.fetchError?.status === 429) && !stale) return
  if (shown && !stale && S.UserProfile.getMutualGuilds(user.id)) return
  A.profiles
    .fetch(user.id, {
      type: 'popout',
      withMutualGuilds: true,
      withMutualFriends: false,
      withMutualFriendsCount: false,
      guildId,
    })
    // a webhook's or a deleted user's profile 404s: the card shows what the user record has
    .catch(() => undefined)
}

const hex = (color: number | null | undefined) =>
  color == null ? undefined : `#${color.toString(16).padStart(6, '0')}`

export interface Profile {
  bio?: string
  pronouns?: string
  banner?: string
  // the banner's colour without an image, and the card's two theme colours (Nitro)
  accent?: string
  theme?: [string, string]
  // a profile effect (Nitro), by its shop product
  effect?: Id
}

export function get(userId: Id, guildId: Id | null | undefined): Profile {
  const own = $.UserProfile.getUserProfile(userId)
  const member = $.UserProfile.getGuildMemberProfile(userId, guildId)
  const memberBanner =
    member?.banner &&
    A.icons.getGuildMemberBannerURL({ id: userId, guildId: guildId!, banner: member.banner, size: BANNER_PX })
  const theme = (member?.themeColors ?? own?.themeColors) as [number, number] | undefined
  return {
    bio: member?.bio || own?.bio || undefined,
    pronouns: member?.pronouns || own?.pronouns || undefined,
    banner: memberBanner || A.icons.getUserBannerURL({ id: userId, banner: own?.banner, size: BANNER_PX }),
    accent: hex(own?.accentColor),
    theme: theme && [hex(theme[0])!, hex(theme[1])!],
    effect: (member?.profileEffect ?? own?.profileEffect)?.skuId,
  }
}

// profile effects' layers by product: those that play from the start and loop (the rest come in later, now and
// then: left out). Stock's fetch and store for them load with its UI: its request, replayed once per product
const [effects, setEffects] = createSignal<Record<Id, string[]>>({})
const asked = new Set<Id>()
export function fetchEffect(skuId: Id) {
  if (asked.has(skuId)) return
  asked.add(skuId)
  A.rest
    .get({
      url: A.endpoints.COLLECTIBLES_PRODUCTS(skuId),
      query: { locale: A.intl.intl.currentLocale },
      rejectWithError: true,
    })
    .then((response) => {
      const layers = (response.body.items?.[0]?.effects ?? []) as { src: string; start: number; loop: boolean }[]
      const playing = layers.filter((layer) => layer.start === 0 && layer.loop).map((layer) => layer.src)
      setEffects((shown) => ({ ...shown, [skuId]: playing }))
    })
    .catch(() => undefined)
}
export const effectLayers = (skuId: Id) => effects()[skuId] ?? []

// a bio's markdown, as stock's: links and emoji
export const bioAST = (bio: string) =>
  A.markdown.parseToAST(bio, true, { allowLinks: true, allowEmojiLinks: true }) as MarkdownNode[]

export interface Activity {
  id: string
  heading: string
  details?: string
  state?: string
  image?: string
  imageText?: string
  // ms since the epoch: a started activity's clock, a song's length with its end
  start?: number
  end?: number
}

// what they're doing, headed in stock's words ("Playing x", "Listening to x"); the custom status is apart
export function activities(userId: Id): Activity[] {
  return $.Presence.getActivities(userId)
    .filter((activity) => activity.type in users.VERBS)
    .map((activity) => ({
      id: activity.id ?? activity.name,
      heading: text(users.VERBS[activity.type as keyof typeof users.VERBS], {
        game: activity.name,
        name: activity.name,
      }),
      details: activity.details,
      // Spotify's artists come apart by semicolons: a list, as stock shows them
      state: activity.name === 'Spotify' ? activity.state?.replaceAll(';', ',') : activity.state,
      image: A.assets.image(activity.application_id, activity.assets?.large_image, ACTIVITY_IMAGE_PX),
      imageText: activity.assets?.large_text,
      start: activity.timestamps?.start,
      end: activity.timestamps?.end,
    }))
}

// the custom status: its emoji and text
export function customStatus(userId: Id) {
  const status = $.Presence.getActivities(userId).find((activity) => activity.type === ActivityType.Custom)
  return (
    status && {
      emoji: status.emoji as Pick<Emoji, 'id' | 'name' | 'animated' | 'surrogates'> | undefined,
      text: status.state,
    }
  )
}

// the member's roles, highest first: { id, name, color }
export function roles(user: User, guildId: Id | null | undefined) {
  const member = guildId && users.member(user, guildId)
  if (!member) return []
  return (member.roles ?? [])
    .map((id) => $.GuildRole.getRole(guildId, id))
    .filter((role) => role !== undefined)
    .sort((left, right) => right.position - left.position)
    .map((role) => ({ id: role.id as Id, name: role.name as string, color: role.colorString as string | null }))
}
