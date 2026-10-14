// A popover opened by a button elsewhere (its popovertarget, mc-NAME, which also anchors it to the button: the CSS
// places it with position-area). Its contents mount while it's open, before it shows; onOpen runs once it has.

import { createSignal, flush, omit, Show } from 'solid-js'
import { Dynamic, type JSX } from '@solidjs/web'

export function Popout(
  p: Omit<JSX.HTMLAttributes<HTMLElement>, 'id' | 'popover'> & {
    name: string
    as?: 'menu' | 'div' | 'form'
    onOpen?(element: HTMLElement): void
    onClose?(): void
    onSubmit?: JSX.EventHandler<HTMLFormElement, SubmitEvent>
  },
) {
  const [open, setOpen] = createSignal(false)
  const rest = omit(p, 'name', 'as', 'onOpen', 'onClose', 'children', 'ref')
  return (
    <Dynamic
      // typed as a form, the widest of the three (onSubmit)
      component={(p.as ?? 'menu') as 'form'}
      {...rest}
      // a ref on a component arrives as its setter
      ref={(element: HTMLFormElement) => (p.ref as ((element: HTMLElement) => void) | undefined)?.(element)}
      id={`mc-${p.name}`}
      popover
      onBeforeToggle={(e: ToggleEvent) => {
        if (e.newState !== 'open') return
        setOpen(true)
        flush()
      }}
      onToggle={(e: ToggleEvent) => {
        if (e.newState === 'open') return p.onOpen?.(e.currentTarget as HTMLElement)
        setOpen(false)
        p.onClose?.()
      }}
    >
      <Show when={open()}>{p.children}</Show>
    </Dynamic>
  )
}
