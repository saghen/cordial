// A list row: its icon, its label (the children) and a second line under it, and what goes at its end (a count, a
// time, state icons). Its state is classes; callers work it out through the api.

import { omit, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

export function Row(
  p: JSX.AnchorHTMLAttributes<HTMLAnchorElement> & {
    name: string
    icon?: JSX.Element
    sub?: JSX.Element
    end?: JSX.Element
  },
) {
  const rest = omit(p, 'name', 'class', 'icon', 'sub', 'end', 'children')
  return (
    <a {...rest} class={['row', p.name, p.class]}>
      {p.icon}
      {p.children}
      <Show when={p.sub}>
        <small>{p.sub}</small>
      </Show>
      <Show when={p.end}>
        <span class="end">{p.end}</span>
      </Show>
    </a>
  )
}
