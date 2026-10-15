// Menus as data. An item is a button (its class, the id of what it's for, label and state); a click closes the
// popover around it, unless it keeps it open, then runs it. One with `confirm` runs on a second click, showing that
// label after the first; one with `checked` is a radio; `status` puts a presence status before the label; one with a
// `submenu` shows it beside itself while hovered or focused. '-' is a divider; false or null leaves an item out. A
// context menu's target is what the right click was on, the menu shown at the pointer.

import { createSignal, flush, For, onCleanup, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { Icon } from './icon'
import { Status } from './status'
import type { IconName } from './icons'

export type Item = {
  name: string
  id?: string
  label: JSX.Element
  run(e: MouseEvent): void
  icon?: IconName
  checked?: boolean
  confirm?: JSX.Element
  class?: string | Record<string, boolean>
  disabled?: boolean
  title?: string
  status?: string
  keep?: boolean
  submenu?: Item[]
}

export function Items(p: { items: (Item | '-' | false | null | undefined)[] }) {
  // the item waiting for its second click, by name and id (the items are rebuilt as their state changes)
  const [armed, setArmed] = createSignal<string>()
  const key = (item: Item) => `${item.name} ${item.id ?? ''}`
  return (
    <For each={p.items.filter((item): item is Item | '-' => Boolean(item))}>
      {(item) =>
        item === '-' ? (
          <hr />
        ) : (
          <>
            <button
              class={[item.name, item.class]}
              style={item.submenu && { 'anchor-name': `--${item.name}` }}
              data-id={item.id}
              role={item.checked == null ? undefined : 'menuitemradio'}
              aria-checked={item.checked == null ? undefined : (String(item.checked) as 'true' | 'false')}
              disabled={item.disabled}
              title={item.title}
              onClick={(e) => {
                if (item.confirm && armed() !== key(item)) return setArmed(key(item))
                if (!item.keep) e.currentTarget.closest<HTMLElement>('[popover]')!.hidePopover()
                item.run(e)
              }}
            >
              <Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>
              <Show when={item.status}>{(kind) => <Status kind={kind()} />}</Show>
              {armed() === key(item) ? item.confirm : item.label}
            </button>
            <Show when={item.submenu}>
              {(items) => (
                <menu class="submenu" style={{ 'position-anchor': `--${item.name}` }}>
                  <Items items={items()} />
                </menu>
              )}
            </Show>
          </>
        )
      }
    </For>
  )
}

// a second right click this soon after the first is a double one
const DOUBLE_MS = 500

// a context menu at the pointer, above it or to its left where it wouldn't fit
function popAt(menu: HTMLElement, e: MouseEvent) {
  e.preventDefault()
  function show() {
    menu.showPopover()
    const { width, height } = menu.getBoundingClientRect()
    Object.assign(menu.style, {
      left: `${e.clientX + width > innerWidth ? e.clientX - width : e.clientX}px`,
      top: `${e.clientY + height > innerHeight ? e.clientY - height : e.clientY}px`,
    })
  }
  // on Linux contextmenu fires on the press: opened before the release, the release would light-dismiss it
  if (e.buttons) addEventListener('pointerup', show, { once: true })
  else show()
}

// A menu at the pointer for what a right click finds (nothing found, no menu), or for a target given (show). Its
// contents mount for each target while it's open, so each opening starts afresh
export function contextMenu<T>(p: {
  class: string
  find(e: MouseEvent): T | null | undefined
  children(target: () => T): JSX.Element
}) {
  const [target, setTarget] = createSignal<T>()
  let menu!: HTMLMenuElement
  function show(e: MouseEvent, value: T) {
    setTarget(() => value)
    // rendered before popAt measures it
    flush()
    popAt(menu, e)
  }
  return {
    open(e: MouseEvent) {
      const found = p.find(e)
      if (found != null) show(e, found)
    },
    show,
    hide: () => menu.hidePopover(),
    // ours: a double right click, the second on what the first found (by id) or on the menu the first opened; it runs
    // in place of the menu, given what the first found. Each call finds its own things, apart from the others'
    onDoubleRight(find: (target: Element) => string | undefined, run: (id: string) => void) {
      let first: { id: string; at: number } | null = null
      function right(e: MouseEvent) {
        const target = e.target as Element
        const prev = first
        const id = find(target)
        first = id === undefined ? null : { id, at: e.timeStamp }
        if (!prev || e.timeStamp - prev.at > DOUBLE_MS) return
        if (id !== prev.id && !menu.contains(target)) return
        first = null
        e.preventDefault()
        e.stopPropagation()
        menu.hidePopover()
        run(prev.id)
      }
      document.addEventListener('contextmenu', right, true)
      onCleanup(() => document.removeEventListener('contextmenu', right, true))
    },
    view: (
      <menu
        ref={menu}
        class={['context-menu', p.class]}
        popover
        // the toggle event comes late: by then a right click elsewhere may have opened it again
        onToggle={(e) => e.newState === 'closed' && !menu.matches(':popover-open') && setTarget(undefined)}
      >
        <Show when={target()} keyed>
          {(shown) => p.children(() => shown)}
        </Show>
      </menu>
    ),
  }
}
