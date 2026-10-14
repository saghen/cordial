// Items built in chunks, each once it comes near its scroller's view; until then a chunk is empty, as tall as its
// rows (the CSS sizes it from --n, its count of items), so thousands of emoji aren't built and styled on every open

import { createSignal, For, onCleanup, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

export function LazyChunks<T>(p: {
  items: T[]
  // 36: four rows of emoji, nine of stickers
  size?: number
  // the scroller
  root: () => Element
  children: (item: T) => JSX.Element
}) {
  const size = () => p.size ?? 36
  const chunks = () =>
    Array.from({ length: Math.ceil(p.items.length / size()) }, (_, i) => p.items.slice(i * size(), (i + 1) * size()))
  const near = new Map<Element, () => void>()
  let seeing: IntersectionObserver | undefined
  const watch = (el: Element, show: () => void) => {
    seeing ??= new IntersectionObserver(
      (es, observer) => {
        for (const e of es) {
          if (!e.isIntersecting) continue
          near.get(e.target)?.()
          observer.unobserve(e.target)
        }
      },
      { root: p.root(), rootMargin: '200px 0px' },
    )
    near.set(el, show)
    seeing.observe(el)
  }
  onCleanup(() => seeing?.disconnect())
  return (
    <For each={chunks()} keyed={false}>
      {(chunk) => {
        const [seen, setSeen] = createSignal(false)
        return (
          <div class="chunk" ref={(el) => watch(el, () => setSeen(true))} style={{ '--n': chunk().length }}>
            <Show when={seen()}>
              <For each={chunk()}>{(item) => p.children(item)}</For>
            </Show>
          </div>
        )
      }}
    </For>
  )
}
