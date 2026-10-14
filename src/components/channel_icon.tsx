// A channel's icon by its type and kind: text, announcements, age-restricted, private; voice, private voice

import * as channels from '../api/channels'
import { ChannelType, type Channel } from '../api/types'
import { Icon } from '../primitives/icon'

// a text channel's icon by its kind
const TEXT_ICONS = { news: 'announce', nsfw: 'hash-nsfw', lock: 'hash-lock' } as const

export function ChannelIcon(p: { channel: Channel }) {
  function name() {
    const kind = channels.kindOf(p.channel)
    if (p.channel.type === ChannelType.Voice) return kind === 'lock' ? 'voice-lock' : 'voice'
    return kind ? TEXT_ICONS[kind] : 'hash'
  }
  return <Icon name={name()} />
}
