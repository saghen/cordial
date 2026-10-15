// Messages: a channel's list and how stock groups and labels its rows, a message's content as stock's markdown AST,
// the list's triggers (loading more, its position, automatic acks), the new messages bar, and the actions on a message.
// Messages come as records.

import { A, S } from '../adapter/needs'
import type { Id } from '../adapter/discord'
import type { Channel, Emoji, MarkdownNode, Message, Reaction, ReferencedMessageState } from './types'
import { MessageType, Permission } from './types'
import { $ } from './store'
import { day, text } from './strings'
import { automaticAck, channelDimensions, localAck } from './triggers'
import * as users from './users'

// a channel's loaded messages: a new ChannelMessages object on every change
export const list = (channelId: Id) => $.Message.getMessages(channelId)
export const get = (channelId: Id, id: Id) => S.Message.getMessage(channelId, id) as Message | undefined

// Grouping, ported from Discord's module with "IS_SCHEDULED)!==": it lives in a chunk only Discord's message list
// loads. A message starts a new group unless it continues the previous one: same author (and, for webhooks, the same
// name) within 7 minutes on the same day, both user messages, matching flags

const GROUP_MS = 7 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
// user messages (content as markdown); any other type is a system message (stock's text for it)
const USER_TYPES = new Set([
  MessageType.Default,
  MessageType.Reply,
  MessageType.ChatInputCommand,
  MessageType.ContextMenuCommand,
  MessageType.InteractionPremiumUpsell,
  MessageType.CustomGift,
  MessageType.VoiceHangoutInvite,
  MessageType.Changelog,
  MessageType.MediaMentionMessage,
])
export const isUser = (message: Message) => USER_TYPES.has(message.type)
// a blocked or ignored author's message (MessageStore keeps the flags current), which stock collapses in runs
export function hiddenAs(message?: Message): 'blocked' | 'ignored' | undefined {
  if (message?.blocked) return 'blocked'
  if (message?.ignored) return 'ignored'
  return undefined
}
const HAS_THREAD = 1 << 5
const EPHEMERAL = 1 << 6
const SUPPRESS_NOTIFICATIONS = 1 << 12
const IS_SCHEDULED = 1 << 20

const flag = (message: Message, bit: number) => (message.flags & bit) !== 0
const orNull = (value: unknown) => (value == null || value === '' ? null : value)

export function startsGroup(channel: Channel | undefined, prev: Message | undefined, message: Message) {
  if (!prev) return true
  if (
    flag(message, HAS_THREAD) ||
    message.isCommandType?.() ||
    prev.blocked !== message.blocked ||
    prev.ignored !== message.ignored
  )
    return true
  if (message.applicationId !== prev.applicationId || orNull(message.additionalName) !== orNull(prev.additionalName))
    return true
  if (message.type !== MessageType.Default) return isUser(prev) || message.type === MessageType.Reply
  const prevTime = prev.timestamp
  const time = message.timestamp
  const apart = Math.abs(prevTime.getTime() - time.getTime())
  return (
    !isUser(prev) ||
    prev.author.id !== message.author.id ||
    flag(prev, EPHEMERAL) !== flag(message, EPHEMERAL) ||
    flag(prev, IS_SCHEDULED) !== flag(message, IS_SCHEDULED) ||
    (message.webhookId != null && prev.author.username !== message.author.username) ||
    (channel?.isForumPost?.() && prev.id === channel.id) ||
    apart > DAY_MS ||
    prevTime.getDate() !== time.getDate() ||
    apart >= GROUP_MS ||
    (flag(message, SUPPRESS_NOTIFICATIONS) && !flag(prev, SUPPRESS_NOTIFICATIONS)) ||
    (flag(prev, SUPPRESS_NOTIFICATIONS) &&
      !flag(message, SUPPRESS_NOTIFICATIONS) &&
      (message.mentions.length > 0 || message.mentionRoles.length > 0 || message.mentionEveryone))
  )
}

// the date divider above a message, when it's the first loaded of its day
export const dayOf = (prev: Message | undefined, message: Message) =>
  prev && prev.timestamp.toDateString() !== message.timestamp.toDateString() ? day(message.timestamp) : undefined

// whose name the author line shows: a webhook's own, not a member's
export const authorGuild = (message: Message, guildId: Id | null | undefined) => (message.webhookId ? null : guildId)

// message content as Discord's markdown AST (what its React output is built from), with message-content options
export const contentAST = (message: Pick<Message, 'id' | 'content'>, channelId: Id) =>
  A.markdown.parseToAST(message.content, true, {
    channelId,
    messageId: message.id,
    allowLinks: true,
    allowHeading: true,
    allowList: true,
    allowEmojiLinks: true,
  }) as MarkdownNode[]
// an embed's text: links and lists
export const embedAST = (text: string) =>
  A.markdown.parseToAST(text, true, { allowLinks: true, allowList: true }) as MarkdownNode[]
// a system message: stock's text for it (its formatter, as in notifications)
export const systemText = (message: Message) =>
  A.systemMessages.stringify(message) ?? (message.content || `(message type ${message.type})`)

// a DM call you weren't in
export const missed = (message: Message) => !(message.call?.participants ?? []).includes(S.Auth.getId())
// the replied-to message, and its state
export const replied = (message: Message) =>
  message.type === MessageType.Reply && message.messageReference
    ? ($.ReferencedMessage.getMessageByReference(message.messageReference) as {
        state: ReferencedMessageState
        message?: Message | null
      })
    : null
// as stock: a message that's only the link of its image or GIF shows just the media
export const linkOnly = (message: Message) =>
  message.embeds.length > 0 &&
  message.embeds.every(
    (embed) => (embed.type === 'image' || embed.type === 'gifv') && embed.url === message.content.trim(),
  )

// The list's triggers, which stock's list component issues

// stock's cap on a fetch's limit
const MAX_FETCH = 30
// how near an end of the list loads more: stock's 500 px, or sooner (ours: at 500 px a reader scrolling on waits at the
// end for the fetch) up to two views ahead, as far as truncation allows; near the top with unreads stock's 2 px
const LOAD_PX = 500
const LOAD_VIEWS = 2
const LOAD_UNREAD_PX = 2
// a fetch past ~120 rows truncates the far end to 60: the 30 fetched and the 30 rows nearest them, which the reader's
// view has to stay within, or the rows under it go. Until it is, a fetch leaves the far end (ours: stock always
// truncates), up to MAX_ROWS
export const KEPT_ROWS = 30
const MAX_ROWS = 240

// where the list is: its distance from each end, the view's height, and the height of the KEPT_ROWS rows at each end
interface Position {
  fromTop: number
  fromBottom: number
  view: number
  keptTop: number
  keptBottom: number
}
const ahead = (view: number, kept: number) => Math.max(LOAD_PX, Math.min(LOAD_VIEWS * view, kept - view))

// As stock's but sooner: older near the top, newer (truncated by a fetch of older) near the bottom, two pages at a
// time, truncating the other end. Only toward where the reader is heading: a short window can be near both ends, and
// loading one truncates the other. With unreads, stock waits for the very top (2 px),
// so reading down from the unread line doesn't pull in history
export function loadMore(channelId: Id, position: Position, down: boolean) {
  const loaded = S.Message.getMessages(channelId)
  if (!loaded.ready || loaded.loadingMore || !loaded.length) return
  const top =
    !down &&
    loaded.hasMoreBefore &&
    position.fromTop <=
      (S.ReadState.getOldestUnreadMessageId(channelId) != null
        ? LOAD_UNREAD_PX
        : ahead(position.view, position.keptTop))
  const bottom = down && loaded.hasMoreAfter && position.fromBottom <= ahead(position.view, position.keptBottom)
  if (!top && !bottom) return
  const inKept = top
    ? position.fromTop + position.view <= position.keptTop
    : position.fromBottom + position.view <= position.keptBottom
  const truncate = inKept || loaded.length >= MAX_ROWS
  A.messages.fetchMessages({
    channelId,
    before: top ? loaded.first().id : undefined,
    after: top ? undefined : loaded.last().id,
    limit: Math.min(MAX_FETCH, 2 * A.pages.size('scrollManager.loadMore')),
    // the store truncates when the flag is there at all, false too
    truncate: truncate ? true : undefined,
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
  const loaded = S.Message.getMessages(channelId)
  if (seen === undefined || seen === loaded.jumpSequenceId || !loaded.jumpTargetId)
    return { sequence: loaded.jumpSequenceId }
  return {
    sequence: loaded.jumpSequenceId,
    id: loaded.jumpTargetId as Id,
    flash: Boolean(loaded.jumpFlash),
    top: Boolean(loaded.jumpTargetOffset),
  }
}
// the newest messages, loaded around the present when they aren't
export const jumpToPresent = (channelId: Id) => A.messages.jumpToPresent(channelId, 50)
// a reply's message: a fetch around it when it isn't loaded
export const jumpToReplied = (message: Message) =>
  A.messages.jumpToMessage({
    channelId: message.messageReference!.channel_id,
    messageId: message.messageReference!.message_id,
    flash: true,
    returnMessageId: message.id,
  })

// The read state

export const oldestUnread = (channelId: Id) => $.ReadState.getOldestUnreadMessageId(channelId)
// stock's new messages bar: "N new messages since 10:59 PM", while the channel has unreads
export function newMessages(channelId: Id) {
  const count = $.ReadState.getUnreadCount(channelId)
  const since = $.ReadState.getOldestUnreadTimestamp(channelId)
  if (!count || !since) return null
  const timestamp = new Date(since)
  const today = timestamp.toDateString() === new Date().toDateString()
  return $.ReadState.isEstimated(channelId)
    ? text(today ? 'NEW_MESSAGES_ESTIMATED' : 'NEW_MESSAGES_ESTIMATED_WITH_DATE', { count, timestamp })
    : text(today ? 'NEW_MESSAGES' : 'NEW_MESSAGES_WITH_DATE', { count, timestamp })
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
export function markUnread(message: Message) {
  const currentUser = S.User.getCurrentUser()!
  const all = S.Message.getMessages(message.channel_id).toArray() as Message[]
  const before =
    all.filter((other) => BigInt(other.id) < BigInt(message.id)).at(-1)?.id ??
    String(((BigInt(message.id) >> 22n) - 1n) << 22n)
  const mentions = all.filter(
    (other) => BigInt(other.id) > BigInt(before) && A.readStates.countsAsMention(other, currentUser),
  ).length
  A.rest.post({
    url: A.endpoints.MESSAGE_ACK(message.channel_id, before),
    body: { manual: true, mention_count: mentions },
    oldFormErrors: true,
    rejectWithError: true,
  })
}

// The actions on a message

export const own = (message: Message) => message.author.id === users.me()?.id
export const pendingReply = (channelId: Id) => $.PendingReply.getPendingReply(channelId)?.message.id as Id | undefined
export const editing = (channelId: Id) => $.EditMessage.getEditingMessageId(channelId) as Id | undefined

// up to three who reacted, as stock's tooltip (the store fetches them on the first read)
export function reactors(message: Message, reaction: Reaction) {
  const who = [...$.MessageReactions.getReactions(message.channel_id, message.id, reaction.emoji, 3, 0).values()]
  const more = reaction.count - who.length
  return who.map((user) => users.nameOf(user)).join(', ') + (more > 0 ? ` and ${more} more` : '')
}
// a reaction chip's click: mine added or removed
export const toggleReaction = (message: Message, reaction: Reaction) =>
  reaction.me
    ? A.reactions.remove({
        channelId: message.channel_id,
        messageId: message.id,
        emoji: reaction.emoji,
        location: 'Message Inline Button',
      })
    : A.reactions.add(message.channel_id, message.id, reaction.emoji, 'Message Inline Button')
// a reaction from the message menu
export const react = (message: Message, emoji: Emoji) =>
  A.reactions.add(
    message.channel_id,
    message.id,
    emoji.id ? { id: emoji.id, name: emoji.name, animated: emoji.animated } : { id: null, name: emoji.surrogates! },
    'Message Context Menu',
  )

export const canPin = (message: Message, channel: Channel) =>
  (message.type === MessageType.Default || message.type === MessageType.Reply) &&
  users.can(Permission.PIN_MESSAGES, channel) &&
  users.can(Permission.READ_MESSAGE_HISTORY, channel)
export function togglePin(message: Message) {
  const url = A.endpoints.PIN(message.channel_id, message.id)
  if (message.pinned) A.rest.del({ url, oldFormErrors: true, rejectWithError: true })
  else A.rest.put({ url, rejectWithError: true })
}

export const link = (message: Message, channel: Channel) =>
  `https://discord.com/channels/${channel.guild_id ?? '@me'}/${channel.id}/${message.id}`
// a message is edited or replied to once it's sent: your own of a user's kind; any, where you can send
export const canEdit = (message: Message) => own(message) && isUser(message) && message.state === 'SENT'
export const canReply = (message: Message, channel: Channel) =>
  message.state === 'SENT' && users.can(Permission.SEND_MESSAGES, channel)
export const startEdit = (message: Message) => A.messages.startEditMessageRecord(message.channel_id, message)
export const reply = (message: Message, channel: Channel) =>
  A.replies.create({ message, channel, shouldMention: !own(message), showMentionToggle: !own(message) })
// in a DM only your own: users.can allows everything there
export const canDelete = (message: Message, channel: Channel) =>
  own(message) || (!channel.isPrivate() && users.can(Permission.MANAGE_MESSAGES, channel))
// local: a failed message, which only this client has
export const remove = (message: Message, local = false) =>
  A.messages.deleteMessage(message.channel_id, message.id, local)

// stock's Resend (its menu's chunk, not loaded without it): the failed copy goes, the same message is sent again with
// its nonce. Stock adds the options SendMessageOptionsStore kept for it, also not loaded: a reply's mention setting
export function resend(message: Message) {
  remove(message, true)
  A.messages.sendMessage(
    message.channel_id,
    { content: message.content, tts: message.tts, invalidEmojis: [], validNonShortcutEmojis: [] },
    undefined,
    {
      nonce: message.nonce,
      flags: message.flags,
      messageReference: message.messageReference ?? undefined,
      location: 'explicit_retry',
    },
  )
}

// a message's own place, from a card (pins, search): the channel scrolled to it
export function jumpTo(message: Message) {
  const channel = S.Channel.getChannel(message.channel_id)
  A.nav.transitionTo(`/channels/${channel?.guild_id ?? '@me'}/${message.channel_id}/${message.id}`)
}

// Pins

export const pins = (channelId: Id) =>
  $.ChannelPins.getPins(channelId) as { state: string; items: { message: Message; pinnedAt: Date }[] } | undefined
export const unreadPins = (channelId: Id) => $.ReadState.hasUnreadPins(channelId)
// stock's CHANNEL_PINS_ACK, when the pins open: the button's dot goes
export function ackPins(channelId: Id) {
  if (S.ReadState.hasUnreadPins(channelId)) A.dispatcher.dispatch({ type: 'CHANNEL_PINS_ACK', channelId })
}

const PINS_PAGE = 25

// stock's fetchPins (its pins chunk, not loaded without it): a page of 25, unless the store has them or is loading
export function fetchPins(channelId: Id, before?: Date) {
  const stored = S.ChannelPins.getPins(channelId)
  const need =
    !stored ||
    stored.state === 'FAILED' ||
    (stored.state === 'LOADED_HAS_MORE' && (before ? stored.items.at(-1)?.pinnedAt === before : !stored.items.length))
  if (!need) return
  A.dispatcher.dispatch({ type: 'LOAD_PINNED_MESSAGES', channelId, reset: false })
  A.rest
    .get({
      url: A.endpoints.PINS(channelId),
      query: { limit: PINS_PAGE, before: before?.toISOString() },
      retries: 2,
      oldFormErrors: true,
      rejectWithError: true,
    })
    .then(
      (response) =>
        A.dispatcher.dispatch({
          type: 'LOAD_PINNED_MESSAGES_SUCCESS',
          pins: response.body.items,
          channelId,
          hasMore: response.body.has_more,
        }),
      () => A.dispatcher.dispatch({ type: 'LOAD_PINNED_MESSAGES_FAILURE', channelId }),
    )
}
