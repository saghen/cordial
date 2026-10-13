// A channel's icon by its type and kind: text, announcements, age-restricted, private; voice, private voice

import * as channels from '../api/channels'
import { ChannelType, type Channel } from '../api/records'
import { Icon } from '../primitives/icon'

export function ChannelIcon(p: { channel: Channel }) {
  const name = () => {
    const kind = channels.kindOf(p.channel)
    if (p.channel.type === ChannelType.Voice) return kind === 'lock' ? 'voice-lock' : 'voice'
    return kind === 'news' ? 'announce' : kind === 'nsfw' ? 'hash-nsfw' : kind === 'lock' ? 'hash-lock' : 'hash'
  }
  return <Icon name={name()} />
}
