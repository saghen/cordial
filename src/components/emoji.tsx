// An emoji's image: a custom one from Discord's CDN, a unicode one from its own SVGs

import * as pickers from '../api/pickers'
import type { Emoji as Record } from '../api/records'

export const Emoji = (p: { emoji: Pick<Record, 'id' | 'name' | 'animated' | 'surrogates'> }) => (
  <img class="emoji" alt={p.emoji.name} src={pickers.emojiSrc(p.emoji)} />
)
