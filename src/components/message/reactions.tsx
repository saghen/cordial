// A message's reactions as stock's: a chip per emoji (the emoji, the count, mine highlighted; a click adds or removes
// mine; hovered, its title names up to three who reacted), then a chip that opens the emoji picker (the chat's, mc-react).

import { createSignal, For } from 'solid-js'

import * as messages from '../../api/messages'
import { text } from '../../api/strings'
import type { Message, Reaction } from '../../api/types'
import { IconButton } from '../../primitives/button'
import { Emoji } from '../emoji'

function Chip(p: { message: Message; reaction: Reaction }) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <button
      class={['reaction', { me: p.reaction.me }]}
      data-id={p.reaction.emoji.id ?? p.reaction.emoji.name}
      title={hovered() ? messages.reactors(p.message, p.reaction) : undefined}
      onPointerEnter={() => setHovered(true)}
      onClick={() => messages.toggleReaction(p.message, p.reaction)}
    >
      <Emoji emoji={p.reaction.emoji} />
      {p.reaction.count}
    </button>
  )
}

export function Reactions(p: { message: Message; onAdd(): void }) {
  return (
    <p class="reactions">
      <For each={p.message.reactions}>{(reaction) => <Chip message={p.message} reaction={reaction} />}</For>
      <IconButton
        class="reaction-add"
        icon="reaction"
        title={text('ADD_REACTION')}
        popovertarget="mc-react"
        onClick={p.onAdd}
      />
    </p>
  )
}
