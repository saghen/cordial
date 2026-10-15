// A user's profile card, opened from their avatar or name (the author line, the member list): the banner, the avatar
// with their status, their names and pronouns, the custom status, the bio, what they're doing and their roles. One
// card, mounted once (app.tsx), placed beside whatever opened it; a click outside or Escape closes it.

import { createSignal, flush, For, Show } from 'solid-js'

import { elapsed } from '../api/channels'
import { useNow } from '../api/hooks'
import * as profiles from '../api/profiles'
import type { Id, User } from '../api/types'
import * as users from '../api/users'
import { Avatar } from './avatar'
import { Emoji } from './emoji'
import { Markdown } from './markdown'
import { Name } from './name'

type Shown = { user: User; guildId?: Id | null }
let show: ((source: Element, shown: Shown) => void) | undefined

export const open = (source: Element, user: User, guildId?: Id | null) => show?.(source, { user, guildId })

export function ProfileCard() {
  const [shown, setShown] = createSignal<Shown | null>(null)
  let card!: HTMLDivElement
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
      <Avatar user={p.user} guildId={p.guildId} size={80} status={users.status(p.user.id)} />
      <h2>
        <Name user={p.user} guildId={p.guildId} profile />
      </h2>
      <p class="handle">
        {p.user.username}
        <Show when={profile().pronouns} keyed>
          {(pronouns) => <> • {pronouns}</>}
        </Show>
      </p>
      <Show when={custom()} keyed>
        {(status) => (
          <p class="custom-status">
            {status.emoji && <Emoji emoji={status.emoji} />}
            {status.text}
          </p>
        )}
      </Show>
      <Show when={profile().bio} keyed>
        {(bio) => <Markdown ast={profiles.bioAST(bio)} />}
      </Show>
      <For each={activities()}>{(activity) => <Activity activity={activity} now={now()} />}</For>
      <Show when={roles().length}>
        <ul class="roles">
          <For each={roles()}>{(role) => <li style={{ '--role': role.color ?? undefined }}>{role.name}</li>}</For>
        </ul>
      </Show>
    </section>
  )
}

// what they're doing: its heading, its image, its lines, and its clock (a song's progress through its length)
function Activity(p: { activity: profiles.Activity; now: number }) {
  const activity = () => p.activity
  return (
    <section class="activity">
      <h3>{activity().heading}</h3>
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
  if (!p.end) return <time>{elapsed(p.now - p.start)}</time>
  return (
    <span class="progress">
      <time>{elapsed(p.now - p.start)}</time>
      <progress value={Math.min(p.now, p.end) - p.start} max={p.end - p.start} />
      <time>{elapsed(p.end - p.start)}</time>
    </span>
  )
}
