// Discord's Flux stores as Solid dependencies: `$.ReadState.hasUnread(id)` reads the store like `S.ReadState`, and
// subscribes the computation reading it to the store's changes. Solid applies writes in a microtask, so the stores
// one dispatch changes (a message changes several) update the UI once, after the dispatch.

import { createSignal } from 'solid-js'

import { S } from '../adapter/needs'
import type { FluxStore } from '../adapter/discord'
import type { Channel } from './types'

const reads = new Map<FluxStore, () => void>()

function track(store: FluxStore | undefined) {
  // anything that isn't a store (a devtools inspection, a typo) passes through untracked
  if (!store?.addChangeListener) return store
  let read = reads.get(store)
  if (!read) {
    // ownedWrite: a dispatch can fire synchronously while a component renders, which writes this signal there
    const [get, set] = createSignal(undefined, { equals: false, ownedWrite: true })
    store.addChangeListener(() => set())
    read = get
    reads.set(store, read)
  }
  read()
  return store
}

export const $ = new Proxy(S, { get: (stores, name) => track(stores[name as keyof typeof S]) }) as typeof S

export const selected = () => $.SelectedChannel.getChannelId()
export const selectedChannel = () => $.Channel.getChannel(selected()!) as Channel | undefined
export const selectedGuild = () => $.SelectedGuild.getGuildId()
// the channel whose messages show: none for a server's voice or stage channel, which shows its call in their place
export const selectedChat = () => (selectedChannel()?.isGuildVocal() ? null : selected())
