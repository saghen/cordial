// A user's profile card, opened from their avatar or name (the author line, the member list): the banner, the avatar
// with their status, their names and pronouns, the custom status (its emoji beside the name), the bio, what they're
// doing and their roles, and their profile effect over it all. One card, mounted once (app.tsx), placed beside whatever
// opened it; a click outside or Escape closes it.

import { createEffect, createMemo, createSignal, flush, For, onCleanup, Show } from 'solid-js'

import * as channels from '../api/channels'
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
  // a click on their avatar or name again closes it: its press closes the card already (light dismiss), so the click
  // mustn't open it again
  let pressedOn: Id | undefined
  const press = (e: PointerEvent) => {
    pressedOn = card.contains(e.target as Node) ? undefined : shown()?.user.id
  }
  document.addEventListener('pointerdown', press, true)
  onCleanup(() => document.removeEventListener('pointerdown', press, true))
  show = (source, next) => {
    const again = pressedOn === next.user.id
    pressedOn = undefined
    if (card.matches(':popover-open') && shown()?.user.id === next.user.id) return card.hidePopover()
    if (again) return
    setShown(next)
    flush()
    profiles.load(next.user, next.guildId)
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
  // memos: the profile is read throughout, and presence updates (anyone's) would rebuild the activities each time
  const profile = createMemo(() => profiles.get(p.user.id, p.guildId))
  const custom = () => profiles.customStatus(p.user.id)
  const activities = createMemo(() => profiles.activities(p.user.id))
  const ticking = createMemo(() => activities().some((activity) => Boolean(activity.start)))
  const roles = () => profiles.roles(p.user, p.guildId)
  const effectId = createMemo(() => profile().effect)
  function effect() {
    const id = effectId()
    return id ? profiles.effect(id) : undefined
  }
  createEffect(effectId, (effect) => {
    if (effect) profiles.fetchEffect(effect)
  })
  // the activities' clocks tick while one has a start
  const now = useNow(() => (ticking() ? Infinity : 0))
  return (
    <section
      class={['profile', { themed: Boolean(profile().theme) }]}
      style={{ '--theme-from': profile().theme?.[0], '--theme-to': profile().theme?.[1] }}
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
      <For each={activities()} keyed={(activity) => activity.id}>
        {(activity) => <Activity activity={activity()} now={now()} />}
      </For>
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
      <Show when={effect()} keyed>
        {(effect) => <Effect effect={effect} />}
      </Show>
    </section>
  )
}

// stock's wait before an effect's first frame
const EFFECT_DELAY_MS = 500

// a profile effect over the card: each layer in its stretch of the timeline (an image mounting at its start plays from
// its first frame), then its still frame, as are shown alone while it can't play
function Effect(p: { effect: profiles.Effect }) {
  const [time, setTime] = createSignal(-EFFECT_DELAY_MS)
  const bounds = new Set([...p.effect.layers.flatMap((layer) => [layer.from, layer.to]), p.effect.end])
  const timers = [...bounds].map((at) => setTimeout(() => setTime(at), at + EFFECT_DELAY_MS))
  onCleanup(() => timers.forEach(clearTimeout))
  function shown() {
    if (!profiles.effectPlays() || time() >= p.effect.end) return [p.effect.still]
    return p.effect.layers.filter((layer) => layer.from <= time() && time() < layer.to).map((layer) => layer.src)
  }
  return <For each={shown()}>{(src) => <img class="effect" src={src} alt="" />}</For>
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
