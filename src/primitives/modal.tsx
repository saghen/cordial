// A modal <dialog> for a value: open(value) shows it with its contents for that value (mounted while it's open);
// Escape or a click on the backdrop closes it, and onClose gets the value it was open for.

import { createSignal, flush, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

export function modal<T>(p: { class: string; children(value: () => T): JSX.Element; onClose?(value: T): void }) {
  const [value, setValue] = createSignal<T>()
  let dialog!: HTMLDialogElement
  return {
    open(v: T) {
      setValue(() => v)
      flush()
      dialog.showModal()
    },
    close: () => dialog.close(),
    view: (
      <dialog
        ref={dialog}
        class={p.class}
        // the dialog itself, outside its contents, is the backdrop
        onClick={(e) => e.target === dialog && dialog.close()}
        onClose={() => {
          const v = value()
          setValue(undefined)
          if (v !== undefined) p.onClose?.(v)
        }}
      >
        <Show when={value()}>{(v) => p.children(v)}</Show>
      </dialog>
    ),
  }
}
