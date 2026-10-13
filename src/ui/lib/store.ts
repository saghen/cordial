// Discord's Flux stores as Solid dependencies: `$.ReadState.hasUnread(id)` reads the store like `S.ReadState`, and
// subscribes the computation reading it to the store's changes. Solid applies writes in a microtask, so the stores
// one dispatch changes (a message changes several) update the UI once, after the dispatch.

import { createSignal } from 'solid-js'

import { S } from '../../adapter/core'
import type { FluxStore } from '../../adapter/discord'

const reads = new Map<FluxStore, () => void>()

function track(store: FluxStore) {
  // anything that isn't a store (a devtools inspection, a typo) passes through untracked
  if (!store?.addChangeListener) return store
  let read = reads.get(store)
  if (!read) {
    const [get, set] = createSignal(undefined, { equals: false })
    store.addChangeListener(() => set())
    reads.set(store, (read = get))
  }
  read()
  return store
}

export const $ = new Proxy(S, { get: (s, k) => track(s[k as keyof typeof S]) }) as typeof S

export const selected = () => $.SelectedChannel.getChannelId()
export const selectedChannel = () => $.Channel.getChannel(selected()!)
export const selectedGuild = () => $.SelectedGuild.getGuildId()
