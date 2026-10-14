// Messages: a channel's list and how stock groups and labels its rows, a message's content as stock's markdown AST,
// the list's triggers (loading more, its position, automatic acks), the new messages bar, and the actions on a message.
// Messages come as records.

import { A, S } from '../adapter/needs'
import type { Id } from '../adapter/discord'
import type { Channel, Emoji, Message, Reaction } from './types'
import { MessageType, Permission } from './types'
import { $ } from './store'
import { day, text } from './strings'
import { automaticAck, channelDimensions, localAck } from './triggers'
import * as users from './users'

// a channel's loaded messages: a new ChannelMessages object on every change
export const list = (channelId: Id) => $.Message.getMessages(channelId)
export const get = (channelId: Id, id: Id) => S.Message.getMessage(channelId, id) as Message | undefined

// Grouping, ported from Discord's module with "IS_SCHEDULED)!==" (2026-10): it lives in a chunk only Discord's message
// list loads. A message starts a new group unless it continues the previous one: same author (and, for webhooks, the
// same name) within 7 minutes on the same day, both user messages, matching flags

const GROUP_MS = 7 * 60 * 1000
// user messages (content as markdown); any other type is a system message (stock's text for it)
const USER = new Set([0, 19, 20, 23, 26, 41, 45, 47, 68])
export const isUser = (m: Message) => USER.has(m.type)
// a blocked or ignored author's message (MessageStore keeps the flags current), which stock collapses in runs
export const hiddenAs = (m?: Message): 'blocked' | 'ignored' | undefined =>
  m?.blocked ? 'blocked' : m?.ignored ? 'ignored' : undefined
const HAS_THREAD = 1 << 5,
  EPHEMERAL = 1 << 6,
  SUPPRESS_NOTIFICATIONS = 1 << 12,
  IS_SCHEDULED = 1 << 20

const flag = (m: Message, f: number) => (m.flags & f) !== 0
const orNull = (s: unknown) => (s == null || s === '' ? null : s)

export function startsGroup(channel: Channel | undefined, prev: Message | undefined, m: Message) {
  if (!prev) return true
  if (flag(m, HAS_THREAD) || m.isCommandType?.() || prev.blocked !== m.blocked || prev.ignored !== m.ignored)
    return true
  if (m.applicationId !== prev.applicationId || orNull(m.additionalName) !== orNull(prev.additionalName)) return true
  if (m.type > 0) return isUser(prev) || m.type === MessageType.Reply
  const a = prev.timestamp,
    b = m.timestamp,
    apart = Math.abs(a.getTime() - b.getTime())
  return (
    !isUser(prev) ||
    prev.author.id !== m.author.id ||
    flag(prev, EPHEMERAL) !== flag(m, EPHEMERAL) ||
    flag(prev, IS_SCHEDULED) !== flag(m, IS_SCHEDULED) ||
    (m.webhookId != null && prev.author.username !== m.author.username) ||
    (channel?.isForumPost?.() && prev.id === channel.id) ||
    !(apart <= 864e5 && a.getDate() === b.getDate()) ||
    !(apart < GROUP_MS) ||
    (flag(m, SUPPRESS_NOTIFICATIONS) && !flag(prev, SUPPRESS_NOTIFICATIONS)) ||
    (flag(prev, SUPPRESS_NOTIFICATIONS) &&
      !flag(m, SUPPRESS_NOTIFICATIONS) &&
      (m.mentions.length > 0 || m.mentionRoles.length > 0 || m.mentionEveryone))
  )
}

// the date divider above a message, when it's the first loaded of its day
export const dayOf = (prev: Message | undefined, m: Message) =>
  prev && prev.timestamp.toDateString() !== m.timestamp.toDateString() ? day(m.timestamp) : undefined

// whose name the author line shows: a webhook's own, not a member's
export const authorGuild = (m: Message, guildId: Id | null | undefined) => (m.webhookId ? null : guildId)

// message content as Discord's markdown AST (what its React output is built from), with message-content options
export function contentAST(m: Pick<Message, 'id' | 'content'>, channelId: Id): any[] {
  return A.markdown.parseToAST(m.content, true, {
    channelId,
    messageId: m.id,
    allowLinks: true,
    allowHeading: true,
    allowList: true,
    allowEmojiLinks: true,
  })
}
// an embed's text: links and lists
export const embedAST = (text: string): any[] =>
  A.markdown.parseToAST(text, true, { allowLinks: true, allowList: true })
// a system message: stock's text for it (its formatter, as in notifications)
export const systemText = (m: Message) => A.systemMessages.stringify(m) ?? (m.content || `(message type ${m.type})`)

// a DM call that I wasn't in
export const missed = (m: Message) => !(m.call?.participants ?? []).includes(S.Auth.getId())
// the replied-to message, and its state (stock's ReferencedMessageState: 0 loaded, 1 not loaded, 2 deleted)
export const replied = (m: Message) =>
  m.type === MessageType.Reply && m.messageReference
    ? ($.ReferencedMessage.getMessageByReference(m.messageReference) as { state: 0 | 1 | 2; message?: Message | null })
    : null
// as stock: a message that's only the link of its image or GIF shows just the media
export const linkOnly = (m: Message) =>
  m.embeds.length > 0 && m.embeds.every((e) => (e.type === 'image' || e.type === 'gifv') && e.url === m.content.trim())

// The list's triggers, which stock's list component issues

// stock's cap on a fetch's limit
const MAX_FETCH = 30

// As stock's: older within 500 px of the top, newer (truncated by a fetch of older) within 500 px of the bottom, two
// pages at a time, truncating the other end. Only toward where the reader is heading: a short window can be near both
// ends, and loading one truncates the other. With unreads, stock waits for the very top (2 px: scrollTop stops 1 px
// short here), so reading down from the unread line doesn't pull in history
export function loadMore(channelId: Id, fromTop: number, fromBottom: number, down: boolean) {
  const ms = S.Message.getMessages(channelId)
  if (!ms.ready || ms.loadingMore || !ms.length) return
  const top =
    !down && ms.hasMoreBefore && fromTop <= (S.ReadState.getOldestUnreadMessageId(channelId) != null ? 2 : 500)
  if (top || (down && ms.hasMoreAfter && fromBottom <= 500))
    A.messages.fetchMessages({
      channelId,
      before: top ? ms.first().id : undefined,
      after: top ? undefined : ms.last().id,
      limit: Math.min(MAX_FETCH, 2 * A.pages.size('scrollManager.loadMore')),
      truncate: true,
    })
}

// the list's position, from the top. While the newest messages aren't loaded the bottom isn't the present: stock counts
// a placeholder there in its height, so ReadStateStore doesn't ack
export function reportPosition(channelId: Id, top: number, height: number, view: number) {
  channelDimensions(channelId, top, height + (S.Message.getMessages(channelId).hasMoreAfter ? view : 0), view)
}

export const ready = (channelId: Id) => S.Message.getMessages(channelId).ready
export { automaticAck }

// a jump's target, once its messages are in: the message, whether it flashes, whether it goes to the top (an offset:
// stock's jump to unread, from the last read message). Undefined for the same jump again
export function jumpTarget(channelId: Id, seen: number | undefined) {
  const ms = S.Message.getMessages(channelId)
  if (seen === undefined || seen === ms.jumpSequenceId || !ms.jumpTargetId) return { sequence: ms.jumpSequenceId }
  return {
    sequence: ms.jumpSequenceId,
    id: ms.jumpTargetId as Id,
    flash: !!ms.jumpFlash,
    top: !!ms.jumpTargetOffset,
  }
}
// the newest messages, loaded around the present when they aren't
export const jumpToPresent = (channelId: Id) => A.messages.jumpToPresent(channelId, 50)
// a reply's message: a fetch around it when it isn't loaded
export const jumpToReplied = (m: Message) =>
  A.messages.jumpToMessage({
    channelId: m.messageReference!.channel_id,
    messageId: m.messageReference!.message_id,
    flash: true,
    returnMessageId: m.id,
  })

// The read state

export const oldestUnread = (channelId: Id) => $.ReadState.getOldestUnreadMessageId(channelId)
// stock's new messages bar: "N new messages since 10:59 PM", while the channel has unreads
export function newMessages(channelId: Id) {
  const n = $.ReadState.getUnreadCount(channelId),
    since = $.ReadState.getOldestUnreadTimestamp(channelId)
  if (!n || !since) return null
  const timestamp = new Date(since),
    today = timestamp.toDateString() === new Date().toDateString()
  return $.ReadState.isEstimated(channelId)
    ? text(today ? 'NEW_MESSAGES_ESTIMATED' : 'NEW_MESSAGES_ESTIMATED_WITH_DATE', { count: n, timestamp })
    : text(today ? 'NEW_MESSAGES' : 'NEW_MESSAGES_WITH_DATE', { count: n, timestamp })
}
// the bar's click: the oldest unread, the messages after the last read one from the top
export const jumpToUnread = (channelId: Id) =>
  A.messages.jumpToMessage({
    channelId,
    messageId: S.ReadState.ackMessageId(channelId) ?? channelId,
    offset: 1,
    context: 'Mark As Read',
  })
// the bar's Mark As Read
export const markRead = (channelId: Id) =>
  A.acks.ack(channelId, {
    section: 'New Messages Banner',
    object: 'Mark Channel as Read Button',
    objectType: 'ack_manual',
  })
// stock's Escape once there's no edit or reply to drop: the channel acked if it has unreads, and its NEW line gone
export function readByKey(channelId: Id) {
  if (S.ReadState.hasUnread(channelId))
    A.acks.ack(channelId, { object: 'Mark Channel as Read Keybind', objectType: 'ack_manual' })
  localAck(channelId)
}

// stock's Mark Unread: a manual ack of the message before this one (or of the millisecond before it), with the
// mentions after it as the count
export function markUnread(m: Message) {
  const me = S.User.getCurrentUser()!,
    all = S.Message.getMessages(m.channel_id).toArray() as Message[]
  const before =
    all.filter((x) => BigInt(x.id) < BigInt(m.id)).at(-1)?.id ?? String(((BigInt(m.id) >> 22n) - 1n) << 22n)
  const mentions = all.filter((x) => BigInt(x.id) > BigInt(before) && A.readStates.countsAsMention(x, me)).length
  A.rest.post({
    url: A.endpoints.MESSAGE_ACK(m.channel_id, before),
    body: { manual: true, mention_count: mentions },
    oldFormErrors: true,
    rejectWithError: true,
  })
}

// The actions on a message

export const own = (m: Message) => m.author.id === users.me()?.id
export const pendingReply = (channelId: Id) => $.PendingReply.getPendingReply(channelId)?.message.id as Id | undefined
export const editing = (channelId: Id) => $.EditMessage.getEditingMessageId(channelId) as Id | undefined

// up to three who reacted, as stock's tooltip (the store fetches them on the first read)
export function reactors(m: Message, r: Reaction) {
  const who = [...$.MessageReactions.getReactions(m.channel_id, m.id, r.emoji, 3, 0).values()]
  const more = r.count - who.length
  return who.map((u) => users.nameOf(u)).join(', ') + (more > 0 ? ` and ${more} more` : '')
}
// a reaction chip's click: mine added or removed
export const toggleReaction = (m: Message, r: Reaction) =>
  r.me
    ? A.reactions.remove({
        channelId: m.channel_id,
        messageId: m.id,
        emoji: r.emoji,
        location: 'Message Inline Button',
      })
    : A.reactions.add(m.channel_id, m.id, r.emoji, 'Message Inline Button')
// a reaction from the message menu
export const react = (m: Message, e: Emoji) =>
  A.reactions.add(
    m.channel_id,
    m.id,
    e.id ? { id: e.id, name: e.name, animated: e.animated } : { id: null, name: e.surrogates! },
    'Message Context Menu',
  )

export const canPin = (m: Message, c: Channel) =>
  (m.type === MessageType.Default || m.type === MessageType.Reply) &&
  users.can(Permission.PIN_MESSAGES, c) &&
  users.can(Permission.READ_MESSAGE_HISTORY, c)
export function togglePin(m: Message) {
  const url = A.endpoints.PIN(m.channel_id, m.id)
  if (m.pinned) A.rest.del({ url, oldFormErrors: true, rejectWithError: true })
  else A.rest.put({ url, rejectWithError: true })
}

export const link = (m: Message, c: Channel) => `https://discord.com/channels/${c.guild_id ?? '@me'}/${c.id}/${m.id}`
export const startEdit = (m: Message) => A.messages.startEditMessageRecord(m.channel_id, m)
export const reply = (m: Message, c: Channel) =>
  A.replies.create({ message: m, channel: c, shouldMention: !own(m), showMentionToggle: !own(m) })
export const canDelete = (m: Message, c: Channel) => own(m) || users.can(Permission.MANAGE_MESSAGES, c)
// local: a failed message, which only this client has
export const remove = (m: Message, local = false) => A.messages.deleteMessage(m.channel_id, m.id, local)

// stock's Resend (its menu's chunk, not loaded without it): the failed copy goes, the same message is sent again with
// its nonce. Stock adds the options SendMessageOptionsStore kept for it, also not loaded: a reply's mention setting
export function resend(m: Message) {
  remove(m, true)
  A.messages.sendMessage(
    m.channel_id,
    { content: m.content, tts: m.tts, invalidEmojis: [], validNonShortcutEmojis: [] },
    undefined,
    { nonce: m.nonce, flags: m.flags, messageReference: m.messageReference ?? undefined, location: 'explicit_retry' },
  )
}

// a message's own place, from a card (pins, search): the channel scrolled to it
export function jumpTo(m: Message) {
  const c = S.Channel.getChannel(m.channel_id)
  A.nav.transitionTo(`/channels/${c?.guild_id ?? '@me'}/${m.channel_id}/${m.id}`)
}

// Pins

export const pins = (channelId: Id) =>
  $.ChannelPins.getPins(channelId) as { state: string; items: { message: Message; pinnedAt: Date }[] } | undefined
export const unreadPins = (channelId: Id) => $.ReadState.hasUnreadPins(channelId)
// stock's CHANNEL_PINS_ACK, when the pins open: the button's dot goes
export function ackPins(channelId: Id) {
  if (S.ReadState.hasUnreadPins(channelId)) A.dispatcher.dispatch({ type: 'CHANNEL_PINS_ACK', channelId })
}

// stock's fetchPins (its pins chunk, not loaded without it): a page of 25, unless the store has them or is loading
export function fetchPins(channelId: Id, before?: Date) {
  const pins = S.ChannelPins.getPins(channelId)
  const need =
    !pins ||
    pins.state === 'FAILED' ||
    (pins.state === 'LOADED_HAS_MORE' && (before ? pins.items.at(-1)?.pinnedAt === before : !pins.items.length))
  if (!need) return
  A.dispatcher.dispatch({ type: 'LOAD_PINNED_MESSAGES', channelId, reset: false })
  A.rest
    .get({
      url: A.endpoints.PINS(channelId),
      query: { limit: 25, before: before?.toISOString() },
      retries: 2,
      oldFormErrors: true,
      rejectWithError: true,
    })
    .then(
      (r) =>
        A.dispatcher.dispatch({
          type: 'LOAD_PINNED_MESSAGES_SUCCESS',
          pins: r.body.items,
          channelId,
          hasMore: r.body.has_more,
        }),
      () => A.dispatcher.dispatch({ type: 'LOAD_PINNED_MESSAGES_FAILURE', channelId }),
    )
}
