// The composer: stock's chat input actions in stock's order. useComposer gives the composer view its state (why the
// box is closed, slowmode, the reply, uploads, edit mode, the placeholder) and its actions (typing into it, sending,
// editing, the pickers' sends, uploads); the box's text stays the view's. typingNames is the chat's typing line;
// mentions, channelResults and emojiResults are autocomplete's queries, stock's own.

import { createMemo } from 'solid-js'

import type { AnyRecord } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import * as channels from './channels'
import { useNow } from './hooks'
import {
  ChannelType,
  EmojiIntention,
  Permission,
  type Channel,
  type Emoji,
  type Id,
  type Message,
  type PrivateChannel,
  type User,
} from './types'
import { $ } from './store'
import { text } from './strings'
import { startTyping, stopTyping } from './triggers'
import * as users from './users'

// a file waiting to go with the next message (stock's CloudUpload)
export interface Upload {
  id: string
  filename: string
  item?: { file?: File }
}

// stock's cap on autocomplete's results of each kind
const MAX_RESULTS = 10

export function useComposer(channelId: () => Id | null) {
  const channel = createMemo(() => (channelId() ? channels.get(channelId()!) : undefined))
  const editing = createMemo(() => (channelId() ? $.EditMessage.getEditingMessageId(channelId()!) : undefined))
  // a timeout's end and slowmode's, as times, so the clock runs only until the later of them
  const timedOutUntil = createMemo(() => {
    const current = channel()
    const until = current?.guild_id && users.member(users.me()!, current.guild_id)?.communicationDisabledUntil
    return until ? Date.parse(until) : 0
  })
  // slowmode: none for those who manage messages or the channel
  const slowUntil = createMemo(() => {
    const current = channel()
    if (
      !current?.rateLimitPerUser ||
      users.can(Permission.MANAGE_MESSAGES, current) ||
      users.can(Permission.MANAGE_CHANNELS, current)
    )
      return 0
    const left = $.Slowmode.getSlowmodeCooldownGuess(current.id, 0)
    return left > 0 ? Date.now() + left : 0
  })
  const now = useNow(() => Math.max(timedOutUntil(), slowUntil()))
  // why the box is closed, as stock says it: no permission, a blocked DM recipient, a timeout
  const closed = createMemo(() => {
    const current = channel()
    if (!current) return null
    if (!users.can(Permission.SEND_MESSAGES, current)) return text('NO_SEND_MESSAGES_PERMISSION_PLACEHOLDER')
    if (current.type === ChannelType.DM && $.Relationship.isBlocked((current as PrivateChannel).recipients[0]))
      return text('BLOCKED_DM')
    if (timedOutUntil() > now()) return text('GUILD_COMMUNICATION_DISABLED_BOTTOM_SHEET_TITLE')
    return null
  })
  const open = () => Boolean(channel()) && !closed()
  // an edit emptied: Enter deletes the message (stock asks first), unless it has files or stickers to keep
  const deletes = createMemo(() => {
    const id = channelId()
    const edit = editing()
    if (!id || !edit) return false
    const message = S.Message.getMessage(id, edit) as Message | undefined
    return (
      !$.EditMessage.getEditingTextValue(id)?.trim() && !message?.attachments.length && !message?.stickerItems?.length
    )
  })
  // seconds left before the next message
  const cooldown = () => Math.max(0, Math.ceil((slowUntil() - now()) / 1000))
  const reply = createMemo(() => (channelId() ? $.PendingReply.getPendingReply(channelId()!) : undefined))
  const uploads = createMemo(() => (channelId() ? $.UploadAttachment.getUploads(channelId()!, 0) : []) as Upload[])
  function placeholder() {
    if (editing()) return text('EDITING')
    const reason = closed()
    if (reason !== null) return reason
    if (cooldown()) return text('CHANNEL_SLOWMODE_COOLDOWN', { seconds: cooldown() })
    const current = channel()
    return text('TEXTAREA_PLACEHOLDER', { channel: current ? channels.title(current) : '' })
  }

  // as stock: the draft saves at most every 500 ms while it changes (first and last change included), and on a switch
  let last = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  function save(id: Id) {
    clearTimeout(timer)
    timer = undefined
    last = Date.now()
    A.drafts.saveDraft(id, S.Draft.getDraft(id, 0), 0)
  }
  function saveSoon(id: Id) {
    const wait = last + 500 - Date.now()
    if (wait <= 0) save(id)
    else timer ??= setTimeout(() => save(id), wait)
  }
  const options = (id: Id) => ({
    ...A.messages.getSendMessageOptionsForReply(S.PendingReply.getPendingReply(id)),
    location: 'chat_input',
  })
  const sent = (id: Id) => reply() && A.replies.remove(id)

  return {
    channel,
    editing,
    deletes,
    closed,
    open,
    cooldown,
    reply,
    uploads,
    placeholder,
    // the box's text for a channel: the message being edited, or the draft
    textOf: (id: Id) =>
      editing() ? A.parser.unparse(S.EditMessage.getEditingTextValue(id) ?? '', id) : S.Draft.getDraft(id, 0),
    // the box left behind on a switch: its draft saved (empty included)
    leave: save,
    // the box's text changed: the edit, or the draft and typing
    input(id: Id, value: string) {
      if (editing()) return A.messages.updateEditMessage(id, value)
      A.drafts.changeDraft(id, value, 0)
      saveSoon(id)
      if (value.trim() && !value.startsWith('/')) startTyping(id)
      else if (!value) stopTyping(id)
    },
    // Enter: an edit saved (an unchanged one just leaves edit mode), an emptied one's message deleted, or the text and
    // files sent; true when the box empties
    send(id: Id, value: string) {
      const current = channel()!
      const edit = editing()
      const content = value.trim()
      if (edit) {
        const parsed = A.parser.parse(current, content).content
        if (deletes()) A.messages.deleteMessage(id, edit)
        else if (parsed !== S.Message.getMessage(id, edit)?.content)
          A.messages.editMessage(id, edit, { content: parsed, components: undefined })
        A.messages.endEditMessage(id)
        return false
      }
      if ((!content && !uploads().length) || cooldown()) return false
      // with files, as stock: no optimistic row (eagerDispatch), the message shows once uploaded
      const attachmentsToUpload = uploads().length ? uploads() : undefined
      A.messages.sendMessage(id, A.parser.parse(current, content), undefined, {
        ...options(id),
        attachmentsToUpload,
        eagerDispatch: attachmentsToUpload ? false : undefined,
      })
      sent(id)
      if (attachmentsToUpload) A.uploads.clearAll(id, 0)
      // stock clears its box (a save of the empty draft), then hears its own change (a change, and a throttled save)
      A.drafts.saveDraft(id, '', 0)
      A.drafts.changeDraft(id, '', 0)
      saveSoon(id)
      return true
    },
    // a GIF's link, sent at once (stock's picker), leaving the box as it is
    sendLink(id: Id, url: string) {
      A.messages.sendMessage(id, A.parser.parse(channel()!, url), undefined, options(id))
      sent(id)
    },
    // a sticker, sent at once with nothing else
    sendSticker(id: Id, stickerId: Id) {
      A.messages.sendStickers(id, [stickerId], '', options(id))
      sent(id)
    },
    // Up in an empty box: the last own message into edit mode; false when there's none
    editLast(id: Id) {
      const message = S.Message.getLastEditableMessage(id)
      if (message) A.messages.startEditMessageRecord(id, message)
      return Boolean(message)
    },
    removeReply: (id: Id) => A.replies.remove(id),
    mention: (id: Id, on: boolean) => A.replies.mention(id, on),
    // files picked, pasted or dropped, through stock's prompt
    upload: (files: File[]) => A.promptToUpload.prompt(files, channel()!, 0),
    removeUpload: (id: Id, upload: Upload) => A.uploads.remove(id, upload.id, 0),
  }
}

// Escape: out of edit mode, else the reply dropped; false when neither
export function cancel(id: Id) {
  if (S.EditMessage.getEditingMessageId(id)) A.messages.endEditMessage(id)
  else if (S.PendingReply.getPendingReply(id)) A.replies.remove(id)
  else return false
  return true
}

// the replied-to message's author, as the author line names them (a webhook by its own name)
export const replyName = (message: Message, guildId: Id | null) =>
  users.displayName(message.author, message.webhookId ? null : guildId)

// who else is typing in a channel, by the names the author line uses
export function typingNames(channelId: Id) {
  const myId = users.me()?.id
  const guildId = channels.get(channelId)?.guild_id
  return Object.keys($.Typing.getTypingUsers(channelId))
    .filter((id) => id !== myId)
    .map((id) => users.displayName(users.get(id), guildId))
}

// autocomplete: stock's @ results (members, @everyone and @here, then roles: as stock's box, every role with the
// permission to mention everyone), # results, : results (two letters at least, as stock)
export function mentions(query: string, channel: Channel) {
  const everyone =
    channel.type !== ChannelType.DM &&
    channel.type !== ChannelType.GroupDM &&
    users.can(Permission.MENTION_EVERYONE, channel)
  const results = A.autocomplete.queryMentionResults({ query, channel, canMentionEveryone: everyone, request: true })
  return {
    users: results.users.slice(0, MAX_RESULTS) as { user: User; nick?: string | null }[],
    globals: (results.globals as { text: string; description: string }[]).filter(
      (result) => result.text === '@everyone' || result.text === '@here',
    ),
    roles: results.roles as { name: string; colorString?: string | null }[],
  }
}
export const channelResults = (query: string, channel: Channel) =>
  A.autocomplete.queryChannelResults({ query, channel }).channels.slice(0, MAX_RESULTS) as Channel[]
export function emojiResults(query: string, channel: Channel) {
  if (query.length < 2) return []
  return A.autocomplete
    .queryEmojiResults({ query, channel, intention: EmojiIntention.Chat, maxCount: MAX_RESULTS })
    .emojis.unlocked.map((result: AnyRecord) => ({
      emoji: { ...(result.emojiObject ?? result), name: result.name } as Emoji,
      guild: result.guildId ? ($.Guild.getGuild(result.guildId)?.name as string | undefined) : undefined,
    }))
}
// a # result's hint: its category
export const categoryName = (channel: Channel) => channels.get(channel.parent_id!)?.name
