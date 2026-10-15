// A field's suggestions (the composer's autocomplete, search's filters and history): rows under headings, the selected
// one moved by the arrows and picked by Tab, Enter or a click, open while there's something to pick. reset(-1) leaves
// none selected: Enter stays the field's until an arrow picks one, Tab takes the first. The field keeps the focus: a
// press on a row doesn't take it.

import { createEffect, createSignal, For } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { Row } from '../primitives/row'

export interface Suggestion {
  // what picking it writes, and its id among the rows
  text: string
  label: JSX.Element
  icon?: JSX.Element
  hint?: string
  color?: string
  // a heading above it, or a line between it and the rows before
  head?: JSX.Element
  divider?: boolean
  // what picking it does, where that isn't writing its text
  pick?(): void
}

export function createSuggestions(p: { class: string; list: () => Suggestion[]; pick(item: Suggestion): void }) {
  const [active, setActive] = createSignal(0)
  let menu!: HTMLMenuElement
  const choose = (item: Suggestion) => (item.pick ? item.pick() : p.pick(item))
  // writes apply in a microtask: read them in an effect
  createEffect(
    () => p.list().length > 0,
    (open) => {
      if (open) menu.showPopover()
      else if (menu.matches(':popover-open')) menu.hidePopover()
    },
  )

  // true when the key was the list's
  function key(e: KeyboardEvent) {
    const list = p.list()
    if (!list.length || !menu.matches(':popover-open')) return false
    if (e.key === 'ArrowDown') setActive((active() + 1) % list.length)
    else if (e.key === 'ArrowUp') setActive(active() <= 0 ? list.length - 1 : active() - 1)
    else if (e.key === 'Tab' || (e.key === 'Enter' && active() >= 0))
      choose(list[Math.min(Math.max(active(), 0), list.length - 1)])
    else if (e.key === 'Escape') menu.hidePopover()
    else return false
    e.preventDefault()
    return true
  }

  const view = (
    <menu ref={menu} class={['suggestions', p.class]} popover="manual">
      <For each={p.list()}>
        {(item, i) => (
          <>
            {item.head ? <h3>{item.head}</h3> : item.divider && <hr />}
            <Row
              name="suggestion"
              class={{ selected: i() === active() }}
              data-id={item.text}
              icon={item.icon}
              end={item.hint}
              style={item.color ? { color: item.color } : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
            >
              {item.label}
            </Row>
          </>
        )}
      </For>
    </menu>
  )

  return { view, key, reset: (to = 0) => setActive(to) }
}
