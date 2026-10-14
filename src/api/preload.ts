// Messages loaded before a channel opens: two of stock's first pages (its CHANNEL_PRELOAD loads one) when the channel
// has none; opening it then fetches nothing (MessageManager loads only a channel without messages). On hover (stock
// preloads on mouse down), and the `warm` most used channels after connecting (FrecencyStore; `warm` in
// <userData>/config.json, default 5, 0 for none).

import { G } from '../adapter/anchor'
import { A, S } from '../adapter/needs'
import type { Id, Rec } from '../adapter/discord'
import { Permission, type Channel } from './types'
import { can } from './users'

export const preload = (id?: Id | null) => {
  const ms = id && S.Channel.getChannel(id) && S.Message.getMessages(id)
  if (ms && (!ms.ready || ms.cached) && !ms.loadingMore)
    A.messages.fetchMessages({ channelId: id!, limit: 2 * A.pages.size() })
}

// pointer handlers for a row that opens a channel: preloaded when the pointer stays 100 ms
export function onHover(channel: () => Id | null | undefined) {
  let t = 0
  return {
    onPointerEnter: () => (t = setTimeout(() => preload(channel()), 100)),
    onPointerLeave: () => clearTimeout(t),
  }
}

const readable = (c: Rec) =>
  typeof c.isPrivate === 'function' && !c.isGuildVocal() && can(Permission.READ_MESSAGE_HISTORY, c as Channel)

// once per load, after the first connection, one channel at a time
export function preloadChannels() {
  const n = G.config?.warm ?? 5
  const start = async () => {
    await A.frecencySettings.loadIfNecessary().catch(() => {})
    const top = S.Frecency.getFrequentlyWithoutFetchingLatest().filter(readable).slice(0, n)
    top.forEach((c, i) => setTimeout(() => preload(c.id), 1000 + i * 300))
  }
  if (!n) return
  if (S.Gateway.isConnected()) start()
  else {
    let done = false
    A.dispatcher.subscribe('CONNECTION_OPEN', () => done || ((done = true), setTimeout(start)))
  }
}
