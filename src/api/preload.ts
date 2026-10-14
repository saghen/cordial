// Messages loaded before a channel opens: two of stock's first pages (its CHANNEL_PRELOAD loads one) when the channel
// has none; opening it then fetches nothing (MessageManager loads only a channel without messages). On hover (stock
// preloads on mouse down), and the `warm` most used channels after connecting (FrecencyStore; `warm` in
// <userData>/config.json, default 5, 0 for none).

import { G } from '../adapter/anchor'
import { A, S } from '../adapter/needs'
import type { Id, AnyRecord } from '../adapter/discord'
import { Permission, type Channel } from './types'
import { can } from './users'

export function preload(id?: Id | null) {
  if (!id || !S.Channel.getChannel(id)) return
  const loaded = S.Message.getMessages(id)
  if ((!loaded.ready || loaded.cached) && !loaded.loadingMore)
    A.messages.fetchMessages({ channelId: id, limit: 2 * A.pages.size() })
}

const HOVER_MS = 100

// pointer handlers for a row that opens a channel: preloaded when the pointer stays 100 ms
export function onHover(channel: () => Id | null | undefined) {
  let timer = 0
  return {
    onPointerEnter() {
      timer = setTimeout(() => preload(channel()), HOVER_MS)
    },
    onPointerLeave: () => clearTimeout(timer),
  }
}

const readable = (channel: AnyRecord) =>
  typeof channel.isPrivate === 'function' &&
  !channel.isGuildVocal() &&
  can(Permission.READ_MESSAGE_HISTORY, channel as Channel)

// once per load, after the first connection, one channel at a time
export function preloadChannels() {
  const count = G.config?.warm ?? 5
  async function start() {
    await A.frecencySettings.loadIfNecessary().catch(() => {})
    const top = S.Frecency.getFrequentlyWithoutFetchingLatest().filter(readable).slice(0, count)
    top.forEach((channel, i) => setTimeout(() => preload(channel.id), 1000 + i * 300))
  }
  if (!count) return
  if (S.Gateway.isConnected()) start()
  else {
    let done = false
    A.dispatcher.subscribe('CONNECTION_OPEN', () => {
      if (done) return
      done = true
      setTimeout(start)
    })
  }
}
