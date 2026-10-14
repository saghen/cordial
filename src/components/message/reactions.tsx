// A message's reactions as stock's: a chip per emoji (the emoji, the count, mine highlighted; a click adds or removes
// mine; hovered, its title names up to three who reacted), then a chip that opens the reaction search.

import { createSignal, For } from 'solid-js'

import * as messages from '../../api/messages'
import type { Message, Reaction } from '../../api/records'
import { IconButton } from '../../primitives/button'
import { Emoji } from '../emoji'

function Chip(p: { m: Message; r: Reaction }) {
  const [hovered, setHovered] = createSignal(false)
  return (
    <button
      class={['reaction', { me: p.r.me }]}
      data-id={p.r.emoji.id ?? p.r.emoji.name}
      title={hovered() ? messages.reactors(p.m, p.r) : undefined}
      onPointerEnter={() => setHovered(true)}
      onClick={() => messages.toggleReaction(p.m, p.r)}
    >
      <Emoji emoji={p.r.emoji} />
      {p.r.count}
    </button>
  )
}

export const Reactions = (p: { m: Message; onAdd(e: MouseEvent): void }) => (
  <p class="reactions">
    <For each={p.m.reactions}>{(r) => <Chip m={p.m} r={r} />}</For>
    <IconButton class="reaction-add" icon="reaction" title="Add Reaction" onClick={p.onAdd} />
  </p>
)
