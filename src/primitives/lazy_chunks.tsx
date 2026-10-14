// Items built in chunks, each once it comes near its scroller's view; until then a chunk is empty, as tall as its
// rows (the CSS sizes it from --count, its count of items), so thousands of emoji aren't built and styled on every open

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
  const watch = (element: Element, show: () => void) => {
    seeing ??= new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          near.get(entry.target)?.()
          observer.unobserve(entry.target)
        }
      },
      { root: p.root(), rootMargin: '200px 0px' },
    )
    near.set(element, show)
    seeing.observe(element)
  }
  onCleanup(() => seeing?.disconnect())
  return (
    <For each={chunks()} keyed={false}>
      {(chunk) => {
        const [seen, setSeen] = createSignal(false)
        return (
          <div class="chunk" ref={(div) => watch(div, () => setSeen(true))} style={{ '--count': chunk().length }}>
            <Show when={seen()}>
              <For each={chunk()}>{(item) => p.children(item)}</For>
            </Show>
          </div>
        )
      }}
    </For>
  )
}
