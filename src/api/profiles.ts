// A user's profile as a card shows it: fetched on open by stock's popout fetch (its rules for when), read from
// UserProfileStore (a server's own bio, pronouns and banner over the user's), with what they're doing (PresenceStore)
// and their roles in the server (GuildRoleStore).

import { createSignal } from 'solid-js'

import { A, S } from '../adapter/needs'
import { hex } from './color'
import { windowFocused } from './hooks'
import { $ } from './store'
import { ActivityType, type Emoji, type Id, type MarkdownNode, type User } from './types'
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
    guildId &&
    A.icons.getGuildMemberBannerURL({ id: userId, guildId, banner: member.banner, size: BANNER_PX })
  const theme = (member?.themeColors ?? own?.themeColors) as [number, number] | undefined
  return {
    bio: member?.bio || own?.bio || undefined,
    pronouns: member?.pronouns || own?.pronouns || undefined,
    banner: memberBanner || A.icons.getUserBannerURL({ id: userId, banner: own?.banner, size: BANNER_PX }),
    accent: own?.accentColor == null ? undefined : hex(own.accentColor),
    theme: theme && [hex(theme[0]), hex(theme[1])],
    effect: (member?.profileEffect ?? own?.profileEffect)?.skuId,
  }
}

// a profile effect, as stock plays it: its layers on their timeline (ms: each from its start, a looping one to the end
// of the longest), once, then its still frame; only the still frame while the window isn't focused or motion is
// reduced. Stock's fetch and store for them load with its UI: its request, replayed once per product
export interface Effect {
  layers: { src: string; from: number; to: number }[]
  end: number
  still: string
}
interface Layer {
  src: string
  start: number
  duration: number
  loop: boolean
  zIndex?: number
}
const [effects, setEffects] = createSignal<Record<Id, Effect>>({})
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
      const item = response.body.items?.[0]
      const layers = (item?.effects ?? []) as Layer[]
      const end = Math.max(0, ...layers.map((layer) => layer.start + layer.duration))
      const effect = {
        layers: layers
          .toSorted((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
          .map((layer) => ({ src: layer.src, from: layer.start, to: layer.loop ? end : layer.start + layer.duration })),
        end,
        still: (item?.staticFrameSrc ?? item?.reducedMotionSrc) as string,
      }
      setEffects((shown) => ({ ...shown, [skuId]: effect }))
    })
    .catch(() => undefined)
}
export const effect = (skuId: Id) => effects()[skuId] as Effect | undefined
export const effectPlays = () => windowFocused() && !$.Accessibility.useReducedMotion

// a bio's markdown, as stock's: links and emoji
export const bioAST = (bio: string) =>
  A.markdown.parseToAST(bio, true, { allowLinks: true, allowEmojiLinks: true }) as MarkdownNode[]

export interface Activity {
  id: string
  // none for a song: its lines and art say it (ours)
  heading?: string
  details?: string
  state?: string
  image?: string
  imageText?: string
  // ms since the epoch: a started activity's clock, a song's length with its end
  start?: number
  end?: number
}

// what they're doing, headed in stock's words ("Playing x"); the custom status is apart
export function activities(userId: Id): Activity[] {
  return $.Presence.getActivities(userId).flatMap((activity) => {
    const heading = users.verb(activity)
    if (!heading) return []
    return {
      id: activity.id ?? activity.name,
      heading: activity.type === ActivityType.Listening ? undefined : heading,
      details: activity.details,
      // Spotify's artists come apart by semicolons: a list, as stock shows them
      state: activity.name === 'Spotify' ? activity.state?.replaceAll(';', ',') : activity.state,
      image: A.assets.image(activity.application_id, activity.assets?.large_image, ACTIVITY_IMAGE_PX),
      imageText: activity.assets?.large_text,
      start: activity.timestamps?.start,
      end: activity.timestamps?.end,
    }
  })
}

// the custom status: its emoji and text
type StatusEmoji = Pick<Emoji, 'id' | 'name' | 'animated' | 'surrogates'>
export function customStatus(userId: Id) {
  const status = $.Presence.getActivities(userId).find((activity) => activity.type === ActivityType.Custom)
  return (
    status && {
      emoji: status.emoji as StatusEmoji | undefined,
      text: status.state,
    }
  )
}

// the line under a name in the lists (members, DMs), as stock's: the custom status (its emoji and text), else what
// they're doing ("Playing x")
export type StatusLine = { emoji?: StatusEmoji; text?: string }
export function statusLine(userId: Id): StatusLine | undefined {
  const status = customStatus(userId)
  if (status && (status.emoji || status.text)) return status
  for (const activity of $.Presence.getActivities(userId)) {
    const heading = users.verb(activity)
    if (heading) return { text: heading }
  }
  return undefined
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
