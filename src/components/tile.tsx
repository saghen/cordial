// Someone in a call, as stock's tile: their avatar on its own colour, their camera over it while it's on, their name in
// a pill with the mic or headphones struck through while muted or deafened, a ring while they speak. Compact: a round
// avatar alone (stock's DM call without cameras or streams)

import { type Accessor, createSignal, Show } from 'solid-js'

import type { Id, User } from '../api/records'
import * as users from '../api/users'
import { Icon } from '../primitives/icon'
import { Avatar } from './avatar'
import { Video } from './video'

export function Tile(p: {
  user: User
  guildId: Id | null
  speaking: boolean
  muted: boolean
  deafened: boolean
  video?: string
  compact?: boolean
  focus?: boolean
}) {
  return (
    <figure
      class={['tile', { speaking: p.speaking, mute: p.muted, deaf: p.deafened, compact: !!p.compact, focus: !!p.focus }]}
      data-id={p.user.id}
      title={users.displayName(p.user, p.guildId)}
      style={{ '--tile-color': averageColor(users.avatar(p.user, p.guildId, 16)) }}
    >
      <Show when={p.video}>{(id) => <Video id={id()} />}</Show>
      <Avatar user={p.user} guildId={p.guildId} size={80} />
      <b class="name">
        <Show when={p.deafened || p.muted}>
          <Icon name={p.deafened ? 'deaf' : 'mic-off'} />
        </Show>
        {users.displayName(p.user, p.guildId)}
      </b>
    </figure>
  )
}

// an avatar's average colour (stock gives a tile one from the avatar): the image drawn into one pixel, once per image
const colors = new Map<string, Accessor<string | undefined>>()
function averageColor(url: string) {
  let color = colors.get(url)
  if (!color) {
    const [get, set] = createSignal<string>()
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const x = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
      x.imageSmoothingQuality = 'high'
      x.drawImage(img, 0, 0, 1, 1)
      const [r, g, b] = x.getImageData(0, 0, 1, 1).data
      set(`rgb(${r} ${g} ${b})`)
    }
    img.src = url
    colors.set(url, (color = get))
  }
  return color()
}
