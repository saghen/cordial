// An emoji's image: a custom one from Discord's CDN, a unicode one from its own SVGs

import * as pickers from '../api/pickers'
import type { Emoji as EmojiRecord } from '../api/types'

export function Emoji(p: { emoji: Pick<EmojiRecord, 'id' | 'name' | 'animated' | 'surrogates'> }) {
  return <img class="emoji" alt={p.emoji.name} src={pickers.emojiSrc(p.emoji)} />
}
