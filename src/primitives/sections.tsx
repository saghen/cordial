// A picker's search, rail, sections and footer, as stock's pickers: the sections in one list under sticky names, built
// in chunks; a rail of them beside it, where a button scrolls to its section; a footer naming the hovered item, else
// the first shown. A search shows its results in place of the sections, as one section without a name

import { createEffect, createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { LazyChunks } from './lazy_chunks'

export interface Section<T> {
  id: string
  name: string
  items: T[]
}

export function Sections<T, S extends Section<T>>(p: {
  search: JSX.Element
  all: S[]
  shown: Section<T>[]
  // a rail button's contents
  rail: (s: S) => JSX.Element
  item: (item: T) => JSX.Element
  footer?: (item: T) => JSX.Element
  // items to a chunk
  chunk?: number
}) {
  const [hovered, setHovered] = createSignal<T>()
  createEffect(
    () => p.shown,
    () => setHovered(undefined),
  )
  const named = () => hovered() ?? p.shown[0]?.items[0]
  let list!: HTMLDivElement
  return (
    <div class="sections">
      {p.search}
      <nav class="rail">
        <For each={p.all}>
          {(s) => (
            <button
              data-id={s.id}
              title={s.name}
              onClick={() => list.querySelector(`h3[data-id="${s.id}"]`)?.scrollIntoView()}
            >
              {p.rail(s)}
            </button>
          )}
        </For>
      </nav>
      <div class="list" ref={list}>
        {/* by id: the sections are new each read, their items the same records */}
        <For each={p.shown} keyed={(s) => s.id}>
          {(s) => (
            <>
              <Show when={s().name}>
                <h3 data-id={s().id}>{s().name}</h3>
              </Show>
              <LazyChunks items={s().items} size={p.chunk} root={() => list}>
                {(item) => {
                  const el = p.item(item) as HTMLElement
                  el.addEventListener('pointerenter', () => setHovered(() => item))
                  return el
                }}
              </LazyChunks>
            </>
          )}
        </For>
      </div>
      <Show when={p.footer}>
        {(footer) => (
          <footer>
            <Show when={named()}>{(item) => footer()(item())}</Show>
          </footer>
        )}
      </Show>
    </div>
  )
}
