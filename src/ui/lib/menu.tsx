// Menus as data. An item is a button (its data-mc, label and state); a click closes the popover around it, unless it
// keeps it open, then runs it. '-' is a divider; false or null leaves an item out. A context menu's target is what the
// right click was on, the menu shown at the pointer.

import { createSignal, For } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { popAt } from './popover'

export type Item = {
  mc: string
  label: JSX.Element
  run(e: MouseEvent): void
  class?: string | Record<string, boolean>
  disabled?: boolean
  title?: string
  status?: string
  keep?: boolean
}

export const Items = (p: { items: (Item | '-' | false | null | undefined)[] }) => (
  <For each={p.items.filter((i) => !!i)}>
    {(i) =>
      i === '-' ? (
        <hr />
      ) : (
        <button
          data-mc={i.mc}
          class={i.class}
          disabled={i.disabled}
          title={i.title}
          data-status={i.status}
          onClick={(e) => {
            if (!i.keep) e.currentTarget.closest<HTMLElement>('[popover]')!.hidePopover()
            i.run(e)
          }}
        >
          {i.label}
        </button>
      )
    }
  </For>
)

export function contextMenu<T>(find: (e: MouseEvent) => T | null | undefined) {
  const [target, setTarget] = createSignal<T>()
  let menu!: HTMLElement
  return {
    target,
    ref: (m: HTMLElement) => (menu = m),
    open(e: MouseEvent) {
      const t = find(e)
      if (t == null) return
      setTarget(() => t)
      popAt(menu, e)
    },
  }
}
