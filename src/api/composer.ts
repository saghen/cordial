// The composer: stock's chat input actions in stock's order. useComposer gives the composer view its state (why the
// box is closed, slowmode, the reply, uploads, edit mode, the placeholder) and its actions (typing into it, sending,
// editing, the pickers' sends, uploads); the box's text stays the view's. typingNames is the chat's typing line;
// mentions, channelResults and emojiResults are autocomplete's queries, stock's own.

import { createMemo } from 'solid-js'

import type { Rec } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import * as channels from './channels'
import { useNow } from './hooks'
import {
  ChannelType,
  Permission,
  type Channel,
  type Emoji,
  type Id,
  type Message,
  type PrivateChannel,
  type User,
} from './records'
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

export function useComposer(channelId: () => Id | null) {
  const channel = createMemo(() => (channelId() ? channels.get(channelId()!) : undefined))
  const editing = createMemo(() => (channelId() ? $.EditMessage.getEditingMessageId(channelId()!) : undefined))
  // a timeout's end and slowmode's, as times, so the clock runs only until the later of them
  const timedOutUntil = createMemo(() => {
    const c = channel(),
      until = c?.guild_id && users.member(users.me()!, c.guild_id)?.communicationDisabledUntil
    return until ? Date.parse(until) : 0
  })
  // slowmode: none for those who manage messages or the channel
  const slowUntil = createMemo(() => {
    const c = channel()
    if (!c?.rateLimitPerUser || users.can(Permission.MANAGE_MESSAGES, c) || users.can(Permission.MANAGE_CHANNELS, c))
      return 0
    const left = $.Slowmode.getSlowmodeCooldownGuess(c.id, 0)
    return left > 0 ? Date.now() + left : 0
  })
  const now = useNow(() => Math.max(timedOutUntil(), slowUntil()))
  // why the box is closed, as stock says it: no permission, a blocked DM recipient, a timeout
  const closed = createMemo(() => {
    const c = channel()
    if (!c) return null
    if (!users.can(Permission.SEND_MESSAGES, c)) return text('NO_SEND_MESSAGES_PERMISSION_PLACEHOLDER')
    if (c.type === ChannelType.DM && $.Relationship.isBlocked((c as PrivateChannel).recipients[0]))
      return text('BLOCKED_DM')
    if (timedOutUntil() > now()) return text('GUILD_COMMUNICATION_DISABLED_BOTTOM_SHEET_TITLE')
    return null
  })
  const open = () => !!channel() && !closed()
  // seconds left before the next message
  const cooldown = () => Math.max(0, Math.ceil((slowUntil() - now()) / 1000))
  const reply = createMemo(() => (channelId() ? $.PendingReply.getPendingReply(channelId()!) : undefined))
  const uploads = createMemo(() => (channelId() ? $.UploadAttachment.getUploads(channelId()!, 0) : []) as Upload[])
  const placeholder = () =>
    editing()
      ? text('EDITING')
      : (closed() ??
        (cooldown()
          ? text('CHANNEL_SLOWMODE_COOLDOWN', { seconds: cooldown() })
          : text('TEXTAREA_PLACEHOLDER', { channel: channel() ? channels.title(channel()!) : '' })))

  // as stock: the draft is saved at most every 500 ms while it changes (first and last change included), and on a switch
  let last = 0,
    timer: ReturnType<typeof setTimeout> | undefined
  const save = (id: Id) => {
    clearTimeout(timer)
    timer = undefined
    last = Date.now()
    A.drafts.saveDraft(id, S.Draft.getDraft(id, 0), 0)
  }
  const saveSoon = (id: Id) => {
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
    // Enter: an edit saved (an unchanged or emptied one just leaves edit mode; stock asks to delete an emptied one), or
    // the text and files sent; true when the box empties
    send(id: Id, value: string) {
      const c = channel()!,
        edit = editing(),
        content = value.trim()
      if (edit) {
        const parsed = A.parser.parse(c, content).content
        if (content && parsed !== S.Message.getMessage(id, edit)?.content)
          A.messages.editMessage(id, edit, { content: parsed, components: undefined })
        A.messages.endEditMessage(id)
        return false
      }
      if ((!content && !uploads().length) || cooldown()) return false
      // with files, as stock: no optimistic row (eagerDispatch), the message shows once uploaded
      const attachmentsToUpload = uploads().length ? uploads() : undefined
      A.messages.sendMessage(id, A.parser.parse(c, content), undefined, {
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
      const m = S.Message.getLastEditableMessage(id)
      if (m) A.messages.startEditMessageRecord(id, m)
      return !!m
    },
    // Escape: out of edit mode, else the reply dropped; false when neither
    cancel(id: Id) {
      if (editing()) A.messages.endEditMessage(id)
      else if (reply()) A.replies.remove(id)
      else return false
      return true
    },
    removeReply: (id: Id) => A.replies.remove(id),
    mention: (id: Id, on: boolean) => A.replies.mention(id, on),
    // files picked, pasted or dropped, through stock's prompt
    upload: (files: File[]) => A.promptToUpload.prompt(files, channel()!, 0),
    removeUpload: (id: Id, upload: Upload) => A.uploads.remove(id, upload.id, 0),
  }
}

// the replied-to message's author, as the author line names them (a webhook by its own name)
export const replyName = (m: Message, guildId: Id | null) =>
  users.nameOf(m.author, m.webhookId ? undefined : users.member(m.author, guildId)?.nick)

// who else is typing in a channel, by the names the author line uses
export function typingNames(channelId: Id) {
  const me = users.me()?.id,
    guildId = channels.get(channelId)?.guild_id
  return Object.keys($.Typing.getTypingUsers(channelId))
    .filter((id) => id !== me)
    .map((id) => {
      const u = users.get(id)
      return users.nameOf(u, u && users.member(u, guildId)?.nick)
    })
}

// autocomplete: stock's @ results (members, @everyone and @here, then roles: as stock's box, every role with the
// permission to mention everyone), # results, : results (two letters at least, as stock)
export function mentions(query: string, c: Channel) {
  const everyone =
    c.type !== ChannelType.DM && c.type !== ChannelType.GroupDM && users.can(Permission.MENTION_EVERYONE, c)
  const r = A.autocomplete.queryMentionResults({ query, channel: c, canMentionEveryone: everyone, request: true })
  return {
    users: r.users.slice(0, 10) as { user: User; nick?: string | null }[],
    globals: (r.globals as { text: string; description: string }[]).filter(
      (g) => g.text === '@everyone' || g.text === '@here',
    ),
    roles: r.roles as { name: string; colorString?: string | null }[],
  }
}
export const channelResults = (query: string, c: Channel) =>
  A.autocomplete.queryChannelResults({ query, channel: c }).channels.slice(0, 10) as Channel[]
export const emojiResults = (query: string, c: Channel) =>
  query.length < 2
    ? []
    : A.autocomplete
        .queryEmojiResults({ query, channel: c, intention: 3, maxCount: 10 })
        .emojis.unlocked.map((e: Rec) => ({
          emoji: { ...(e.emojiObject ?? e), name: e.name } as Emoji,
          guild: e.guildId ? ($.Guild.getGuild(e.guildId)?.name as string | undefined) : undefined,
        }))
// a # result's hint: its category
export const categoryName = (c: Channel) => channels.get(c.parent_id!)?.name
