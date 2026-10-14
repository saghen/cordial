// A DM's icon: its user's avatar (with their status, if asked), or a group DM's icon

import { Show } from 'solid-js'

import * as channels from '../api/channels'
import type { PrivateChannel } from '../api/types'
import * as users from '../api/users'
import { Avatar } from './avatar'

export const DmIcon = (p: { channel: PrivateChannel; size: number; status?: boolean }) => (
  <Show
    when={channels.dmUser(p.channel)}
    fallback={<Avatar src={channels.groupIcon(p.channel, p.size)} size={p.size} />}
  >
    {(user) => <Avatar user={user()} size={p.size} status={p.status ? users.status(user().id) : undefined} />}
  </Show>
)
