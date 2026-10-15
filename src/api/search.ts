// Message search, as stock's header search bar: stock's own search, whose parser reads from:, in:, has:, before: and
// the rest, in the server (or the DM), 25 results a page, newest first. SearchMessageStore keeps a search's results by
// the server's or the DM's id; SearchHistoryStore_Web its last five queries, which a search adds to as stock's does.

import { createSignal } from 'solid-js'

import { A } from '../adapter/needs'
import * as composer from './composer'
import * as guilds from './guilds'
import type { Channel, Message, User } from './types'
import { $ } from './store'
import * as users from './users'
import { text } from './strings'

export const PAGE = 25

// stock's search context, and its id in SearchMessageStore
const context = (channel: Channel) =>
  channel.guild_id ? { type: 'GUILD', guildId: channel.guild_id } : { type: 'CHANNEL', channelId: channel.id }
export const searchId = (channel: Channel) => channel.guild_id ?? channel.id

// the search's chunks (with its history) loaded: the field warms them when it takes the focus
const [loaded, setLoaded] = createSignal(false)
export const warm = () => void A.search.load().then(() => setLoaded(true))

// a page of the results from offset: as stock, it replaces the last, and puts the query into the history (each page)
export async function run(channel: Channel, query: string, offset: number) {
  const search = await A.search.load()
  A.dispatcher.dispatch({ type: 'SEARCH_HISTORY_WEB_ADD_ITEM', id: searchId(channel), query })
  search.fetchMessages({
    searchContext: context(channel),
    searchQueryString: query,
    pagination: { offset },
    searchMode: 'newest',
    searchEverywhere: false,
    searchAnalyticsIds: null,
    onFetchStart: () => search.clearSearchMessages(searchId(channel)),
  })
}
export const clear = (channel: Channel) =>
  A.search.load().then((search) => search.clearSearchMessages(searchId(channel)))

export const fetching = (channel: Channel) => Boolean($.Search.getIsFetching(searchId(channel)))
export const total = (channel: Channel) => ($.Search.getTotalCount(searchId(channel)) ?? 0) as number
export const failed = (channel: Channel) => Boolean($.Search.getError(searchId(channel)))
export const results = (channel: Channel) => ($.Search.getMessages(searchId(channel)) ?? []) as Message[]

// the field's placeholder: "Search {server}" in a server
export function placeholder(channel: Channel) {
  const guild = channel.guild_id && guilds.get(channel.guild_id)
  return guild ? text('SEARCH_IN', { name: guild.name }) : text('SEARCH')
}

// the last searches here, newest first
export const history = (channel: Channel) =>
  (loaded() ? $.SearchHistory?.getHistory(searchId(channel)) : undefined) ?? []
export const clearHistory = (channel: Channel) =>
  A.dispatcher.dispatch({ type: 'SEARCH_HISTORY_WEB_CLEAR_ITEMS', id: searchId(channel) })

// what a filter takes: members (from:, mentions:, a bare word) as stock's SearchAutocompleteStore finds them, in a
// server asked of it as they're typed (ten, not for an empty answer: the recent authors then), and channels (in:)
const MEMBER_REQUEST = 10
export function members(query: string, channel: Channel, max: number): { user: User; nick?: string | null }[] {
  const guildId = channel.guild_id
  if (!guildId)
    return A.autocomplete.queryMentionResults({ query, channel, canMentionEveryone: false }).users.slice(0, max) as {
      user: User
      nick?: string | null
    }[]
  return A.autocomplete
    .queryGuildUsers({ guildId, query, limit: MEMBER_REQUEST })
    .slice(0, max)
    .map(({ record }) => ({ user: record as User, nick: users.member(record as User, guildId)?.nick }))
}
export const channelsMatching = (query: string, channel: Channel) => composer.channelResults(query, channel)
