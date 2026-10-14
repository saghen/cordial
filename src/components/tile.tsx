// Someone in a call: their avatar, their camera over it while it's on, their name, a ring while they speak, and the
// mic or headphones struck through while muted or deafened. Compact: a round avatar alone (stock's DM call without
// cameras or streams)

import { Show } from 'solid-js'

import type { Id, User } from '../api/records'
import * as users from '../api/users'
import { Icon } from '../primitives/icon'
import { Avatar } from './avatar'
import { Name } from './name'
import { Video } from './video'

export function Tile(p: {
  user: User
  guildId: Id | null
  speaking: boolean
  muted: boolean
  deafened: boolean
  video?: string
  compact?: boolean
}) {
  return (
    <figure
      class={['tile', { speaking: p.speaking, mute: p.muted, deaf: p.deafened, compact: !!p.compact }]}
      data-id={p.user.id}
      title={users.displayName(p.user, p.guildId)}
    >
      <Show when={p.video}>{(id) => <Video id={id()} />}</Show>
      <Avatar user={p.user} guildId={p.guildId} size={p.compact ? 80 : 48} />
      <Name user={p.user} guildId={p.guildId} />
      <Show when={p.deafened || p.muted}>
        <Icon name={p.deafened ? 'deaf' : 'mic-off'} />
      </Show>
    </figure>
  )
}
