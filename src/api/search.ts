// Message search, as stock's header search bar: stock's own search, whose parser reads from:, in:, has:, before: and
// the rest, in the server (or the DM), 25 results a page, newest first. SearchMessageStore keeps a search's results by
// the server's or the DM's id.

import { A } from '../adapter/needs'
import * as guilds from './guilds'
import type { Channel, Message } from './types'
import { $ } from './store'
import { text } from './strings'

export const PAGE = 25

// stock's search context, and its id in SearchMessageStore
const context = (c: Channel) =>
  c.guild_id ? { type: 'GUILD', guildId: c.guild_id } : { type: 'CHANNEL', channelId: c.id }
export const searchId = (c: Channel) => c.guild_id ?? c.id

// a page of the results from offset: as stock, it replaces the last
export async function run(c: Channel, query: string, offset: number) {
  const search = await A.search.load()
  search.fetchMessages({
    searchContext: context(c),
    searchQueryString: query,
    pagination: { offset },
    searchMode: 'newest',
    searchEverywhere: false,
    searchAnalyticsIds: null,
    onFetchStart: () => search.clearSearchMessages(searchId(c)),
  })
}
export const clear = (c: Channel) => A.search.load().then((s) => s.clearSearchMessages(searchId(c)))

export const fetching = (c: Channel) => Boolean($.Search.getIsFetching(searchId(c)))
export const total = (c: Channel) => ($.Search.getTotalCount(searchId(c)) ?? 0) as number
export const failed = (c: Channel) => Boolean($.Search.getError(searchId(c)))
export const results = (c: Channel) => ($.Search.getMessages(searchId(c)) ?? []) as Message[]

// the field's placeholder: "Search {server}" in a server
export const placeholder = (c: Channel) => {
  const g = c.guild_id && guilds.get(c.guild_id)
  return g ? text('SEARCH_IN', { name: g.name }) : text('SEARCH')
}
