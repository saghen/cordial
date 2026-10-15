// A user's profile card, opened from their avatar or name (the author line, the member list): the banner, the avatar
// with their status, their names and pronouns, the custom status (its emoji beside the name), the bio, what they're
// doing and their roles, and their profile effect over it all. One card, mounted once (app.tsx), placed beside whatever
// opened it; a click outside or Escape closes it. A double click on an avatar closes it and opens their DM (ours).

import { createEffect, createSignal, flush, For, Show } from 'solid-js'

import * as channels from '../api/channels'
import { useNow } from '../api/hooks'
import * as profiles from '../api/profiles'
import { selectedChannel } from '../api/store'
import { ChannelType, type Id, type User } from '../api/types'
import * as users from '../api/users'
import { Avatar } from './avatar'
import { Emoji } from './emoji'
import { Markdown } from './markdown'
import { Name } from './name'

type Shown = { user: User; guildId?: Id | null }
let show: ((source: Element, shown: Shown) => void) | undefined
let hide: (() => void) | undefined

export const open = (source: Element, user: User, guildId?: Id | null) => show?.(source, { user, guildId })

// a double click on their avatar: the card its clicks toggled closed, and their DM opened unless a DM is open already,
// it's you, or they can't have one (a webhook)
export function openDm(user: User, canDm = true) {
  hide?.()
  if (!canDm || selectedChannel()?.type === ChannelType.DM || user.id === users.me()?.id) return
  void channels.openDm(user.id)
}

export function ProfileCard() {
  const [shown, setShown] = createSignal<Shown | null>(null)
  let card!: HTMLDivElement
  hide = () => card.hidePopover()
  show = (source, next) => {
    // a second click on what opened it closes it
    if (card.matches(':popover-open') && shown()?.user.id === next.user.id) return card.hidePopover()
    setShown(next)
    flush()
    profiles.fetch(next.user, next.guildId)
    // the source anchors it (position-area) and counts as its invoker
    card.showPopover({ source } as ShowPopoverOptions)
  }
  return (
    <div
      ref={card}
      popover
      role="dialog"
      class="profile-card"
      onToggle={(e) => e.newState === 'closed' && setShown(null)}
    >
      <Show when={shown()} keyed>
        {(current) => <Card {...current} />}
      </Show>
    </div>
  )
}

function Card(p: Shown) {
  const profile = () => profiles.get(p.user.id, p.guildId)
  const custom = () => profiles.customStatus(p.user.id)
  const activities = () => profiles.activities(p.user.id)
  const roles = () => profiles.roles(p.user, p.guildId)
  createEffect(
    () => profile().effect,
    (effect) => {
      if (effect) profiles.fetchEffect(effect)
    },
  )
  // the activities' clocks tick while one has a start
  const now = useNow(() => (activities().some((activity) => activity.start) ? Infinity : 0))
  return (
    <section
      class={['profile', { themed: Boolean(profile().theme) }]}
      style={{ '--primary': profile().theme?.[0], '--accent': profile().theme?.[1] }}
    >
      <div
        class="banner"
        style={{
          'background-image': profile().banner ? `url(${profile().banner})` : undefined,
          'background-color': profile().accent,
        }}
      />
      <Avatar user={p.user} guildId={p.guildId} size={80} status={users.status(p.user.id)} decorated="playing" />
      <h2>
        <Name user={p.user} guildId={p.guildId} profile />
        <Show when={custom()?.emoji} keyed>
          {(emoji) => <Emoji emoji={emoji} />}
        </Show>
      </h2>
      <p class="handle">
        {p.user.username}
        <Show when={profile().pronouns} keyed>
          {(pronouns) => <> • {pronouns}</>}
        </Show>
      </p>
      <Show when={custom()?.text} keyed>
        {(text) => <p class="custom-status">{text}</p>}
      </Show>
      <Show when={profile().bio} keyed>
        {(bio) => <Markdown ast={profiles.bioAST(bio)} />}
      </Show>
      <For each={activities()}>{(activity) => <Activity activity={activity} now={now()} />}</For>
      <Show when={roles().length}>
        <ul class="roles">
          <For each={roles()}>
            {(role) => (
              <li style={{ '--role': role.color ?? undefined }}>
                <span>{role.name}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={profile().effect} keyed>
        {(effect) => <For each={profiles.effectLayers(effect)}>{(src) => <img class="effect" src={src} alt="" />}</For>}
      </Show>
    </section>
  )
}

// what they're doing: its heading, its image, its lines, and its clock (a song's progress through its length)
function Activity(p: { activity: profiles.Activity; now: number }) {
  const activity = () => p.activity
  return (
    <section class="activity">
      {activity().heading && <h3>{activity().heading}</h3>}
      {activity().image && <img src={activity().image} alt="" title={activity().imageText} />}
      <p>
        {activity().details && <b>{activity().details}</b>}
        {activity().state && <span>{activity().state}</span>}
        <Clock start={activity().start} end={activity().end} now={p.now} />
      </p>
    </section>
  )
}

// an activity's clock: how long it's gone on, or a song's progress through its length
function Clock(p: { start?: number; end?: number; now: number }) {
  if (!p.start) return null
  if (!p.end) return <time>{channels.elapsed(p.now - p.start)}</time>
  return (
    <span class="progress">
      <time>{channels.elapsed(p.now - p.start)}</time>
      <progress value={Math.min(p.now, p.end) - p.start} max={p.end - p.start} />
      <time>{channels.elapsed(p.end - p.start)}</time>
    </span>
  )
}
