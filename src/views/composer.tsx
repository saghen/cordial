// The message input: one textarea calling stock's chat input actions in stock's order. Enter sends, Shift+Enter is a new
// line, Up in an empty box edits the last own message in place (Enter saves, Escape leaves). Its text is the draft.
// Files from + wait as chips above it and go with the next message.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import { A, S } from '../adapter/needs'
import { startTyping, stopTyping } from '../api/triggers'
import type { Rec } from '../adapter/discord'
import { useFileDrop } from '../api/hooks'
import { authorOf, can as allowed, emojiSrc, type Message, PERMS } from '../api/model'
import { nameOf } from '../api/users'
import * as channels from '../api/channels'
import type { Channel, PrivateChannel } from '../api/records'
import { $, selected, selectedChannel } from '../api/store'
import { EmojiPicker, GifPicker, StickerPicker } from '../components/pickers'
import { Button, IconButton } from '../primitives/button'

export function MessageInput() {
  const channelId = selected
  const channel = createMemo(selectedChannel)
  const editing = createMemo(() => (channelId() ? $.EditMessage.getEditingMessageId(channelId()!) : undefined))
  // why the box is closed, as stock says it: no permission, a blocked DM recipient, a timeout
  const [now, setNow] = createSignal(Date.now())
  const closed = createMemo(() => {
    const c = channel()
    if (!c) return null
    if (!allowed(PERMS.SEND_MESSAGES, c)) return 'You do not have permission to send messages in this channel.'
    if (c.type === 1 && $.Relationship.isBlocked((c as PrivateChannel).recipients[0]))
      return 'You cannot send messages to a user you have blocked.'
    const until =
      c.guild_id && $.GuildMember.getMember(c.guild_id, S.User.getCurrentUser()!.id)?.communicationDisabledUntil
    if (until && Date.parse(until) > now()) return `You are timed out until ${new Date(until).toLocaleString()}.`
    return null
  })
  const can = createMemo(() => !!channel() && !closed())
  // slowmode: seconds left before the next message (none for those who manage messages or the channel)
  const cooldown = createMemo(() => {
    const c = channel()
    if (!c?.rateLimitPerUser || allowed(PERMS.MANAGE_MESSAGES, c) || allowed(PERMS.MANAGE_CHANNELS, c)) return 0
    now()
    return Math.ceil($.Slowmode.getSlowmodeCooldownGuess(c.id, 0) / 1000)
  })
  // a clock while a countdown or a timeout runs
  createEffect(
    () => cooldown() > 0 || (closed()?.startsWith('You are timed out') ?? false),
    (ticking) => {
      if (!ticking) return
      const t = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(t)
    },
  )
  const reply = createMemo(() => (channelId() ? $.PendingReply.getPendingReply(channelId()!) : undefined))
  const uploads = createMemo(() => (channelId() ? $.UploadAttachment.getUploads(channelId()!, 0) : []))
  let box!: HTMLTextAreaElement, files!: HTMLInputElement
  const complete = createAutocomplete(() => box, channel)

  // as stock: the draft is saved at most every 500 ms while it changes (first and last change included), and on a switch
  let last = 0,
    timer: ReturnType<typeof setTimeout> | undefined
  const save = (id: string) => {
    clearTimeout(timer)
    timer = undefined
    last = Date.now()
    A.drafts.saveDraft(id, S.Draft.getDraft(id, 0), 0)
  }
  const saveSoon = (id: string) => {
    const wait = last + 500 - Date.now()
    if (wait <= 0) save(id)
    else timer ??= setTimeout(() => save(id), wait)
  }

  // a switch saves the text left behind (empty included); the box then shows the new channel's draft, or the
  // message being edited, and takes the focus
  createEffect(
    () => [channelId(), editing()] as const,
    ([id, edit], prev) => {
      if (prev?.[0] && prev[0] !== id) save(prev[0])
      box.value = !id
        ? ''
        : edit
          ? A.parser.unparse(S.EditMessage.getEditingTextValue(id) ?? '', id)
          : S.Draft.getDraft(id, 0)
      if (id) box.focus()
    },
  )
  // as stock: "Message #channel", "Message @user"
  const target = () => {
    const c = channel()
    return c ? ` ${channels.title(c)}` : ''
  }

  const input = () => {
    const id = channelId()!,
      text = box.value
    complete.update()
    if (editing()) return A.messages.updateEditMessage(id, text)
    A.drafts.changeDraft(id, text, 0)
    saveSoon(id)
    if (text.trim() && !text.startsWith('/')) startTyping(id)
    else if (!text) stopTyping(id)
  }

  // a GIF's link, sent at once (stock's picker), leaving the box as it is
  const sendLink = (url: string) => {
    const id = channelId()!
    const options = A.messages.getSendMessageOptionsForReply(S.PendingReply.getPendingReply(id))
    A.messages.sendMessage(id, A.parser.parse(channel()!, url), undefined, { ...options, location: 'chat_input' })
    if (reply()) A.replies.remove(id)
  }
  // a sticker, sent at once with nothing else
  const sendSticker = (stickerId: string) => {
    const id = channelId()!
    const options = A.messages.getSendMessageOptionsForReply(S.PendingReply.getPendingReply(id))
    A.messages.sendStickers(id, [stickerId], '', { ...options, location: 'chat_input' })
    if (reply()) A.replies.remove(id)
  }
  const send = () => {
    const id = channelId()!,
      c = channel()!,
      text = box.value.trim(),
      edit = editing()
    if (edit) {
      // an unchanged or emptied message just leaves edit mode (stock asks to delete an emptied one)
      const content = A.parser.parse(c, text).content
      if (text && content !== S.Message.getMessage(id, edit)?.content)
        A.messages.editMessage(id, edit, { content, components: undefined })
      A.messages.endEditMessage(id)
    } else if ((text || uploads().length) && !cooldown()) {
      const options = A.messages.getSendMessageOptionsForReply(S.PendingReply.getPendingReply(id))
      // with files, as stock: no optimistic row (eagerDispatch), the message shows once uploaded
      const attachmentsToUpload = uploads().length ? uploads() : undefined
      A.messages.sendMessage(id, A.parser.parse(c, text), undefined, {
        ...options,
        attachmentsToUpload,
        eagerDispatch: attachmentsToUpload ? false : undefined,
        location: 'chat_input',
      })
      if (reply()) A.replies.remove(id)
      if (attachmentsToUpload) A.uploads.clearAll(id, 0)
      // stock clears its box (a save of the empty draft), then hears its own change (a change, and a throttled save)
      box.value = ''
      A.drafts.saveDraft(id, '', 0)
      A.drafts.changeDraft(id, '', 0)
      saveSoon(id)
    }
  }

  // pasted files (a screenshot, a copied image) join the uploads, through stock's prompt as + does
  const paste = (e: ClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])]
    if (!pasted.length || !can()) return
    e.preventDefault()
    A.promptToUpload.prompt(pasted, channel()!, 0)
  }
  // files dropped anywhere on the window join them too (left to the browser, a drop would navigate to the file)
  useFileDrop((dropped) => can() && A.promptToUpload.prompt(dropped, channel()!, 0))

  const key = (e: KeyboardEvent) => {
    const id = channelId()!
    if (complete.key(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape' && editing()) {
      A.messages.endEditMessage(id)
    } else if (e.key === 'Escape' && reply()) {
      A.replies.remove(id)
    } else if (e.key === 'ArrowUp' && !box.value && !editing()) {
      const last = S.Message.getLastEditableMessage(id)
      if (last) {
        e.preventDefault()
        A.messages.startEditMessageRecord(id, last)
      }
    }
  }

  return (
    <>
      <Typing />
      <Show when={reply()}>
        {(r) => (
          <label class="reply">
            Replying to <b>{authorOf(r().message as Message, r().channel.guild_id).name}</b>
            <Show when={r().showMentionToggle}>
              <Button
                variant="link"
                class={['reply-mention', { on: r().shouldMention }]}
                aria-pressed={r().shouldMention ? 'true' : 'false'}
                onClick={() => A.replies.mention(channelId()!, !r().shouldMention)}
              >
                @ {r().shouldMention ? 'on' : 'off'}
              </Button>
            </Show>
            <IconButton
              class="reply-cancel"
              icon="close"
              title="Cancel Reply"
              onClick={() => A.replies.remove(channelId()!)}
            />
          </label>
        )}
      </Show>
      <Show when={uploads().length}>
        <ul class="uploads">
          <For each={uploads()}>
            {(u) => {
              // an image shows itself, as stock's card, from the picked file
              const file: File | undefined = u.item?.file
              const preview = file?.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
              onCleanup(() => preview && URL.revokeObjectURL(preview))
              return (
                <button
                  class="upload"
                  data-id={u.filename}
                  title="Remove"
                  style={preview ? { '--preview': `url(${preview})` } : undefined}
                  onClick={() => A.uploads.remove(channelId()!, u.id, 0)}
                >
                  {u.filename} ✕
                </button>
              )
            }}
          </For>
        </ul>
      </Show>
      <input
        ref={files}
        type="file"
        multiple
        hidden
        onChange={() => {
          A.promptToUpload.prompt([...files.files!], channel()!, 0)
          files.value = ''
        }}
      />
      <div class="box" hidden={!channelId()}>
        <IconButton class="attach" icon="plus" title="Upload a file" hidden={!can()} onClick={() => files.click()} />
        <textarea
          ref={box}
          id="mc-composer"
          class={{ editing: !!editing() }}
          rows={1}
          disabled={!can()}
          placeholder={
            editing()
              ? 'Editing: Enter saves, Escape cancels'
              : (closed() ??
                (cooldown()
                  ? `Slowmode: wait ${cooldown()} s`
                  : `Message${target()}${channel()?.rateLimitPerUser ? ' (slowmode)' : ''}`))
          }
          onInput={input}
          onKeyDown={key}
          onPaste={paste}
        />
        <StickerPicker channel={() => (can() ? channel() : undefined)} send={sendSticker} />
        <GifPicker channel={() => (can() ? channel() : undefined)} send={sendLink} />
        <EmojiPicker box={() => box} channel={() => (can() ? channel() : undefined)} />
      </div>
      {complete.view}
    </>
  )
}

// who else is typing, in stock's words: "A is typing…", "A and B are…", "A, B, and C are…", then "Several people are…"
function Typing() {
  const names = createMemo(() => {
    const id = selected(),
      me = S.User.getCurrentUser()?.id
    const guild = id && S.Channel.getChannel(id)?.guild_id
    return !id
      ? []
      : Object.keys($.Typing.getTypingUsers(id))
          .filter((u) => u !== me)
          .map((u) => nameOf(S.User.getUser(u), guild ? S.GuildMember.getMember(guild, u)?.nick : null))
  })
  return (
    <Show when={names().length}>
      <output class="typing">
        {names().length > 3 ? (
          'Several people are typing…'
        ) : (
          <>
            {names().map((n, i) => (
              <>
                {!i ? '' : i < names().length - 1 ? ', ' : i > 1 ? ', and ' : ' and '}
                <b>{n}</b>
              </>
            ))}
            {names().length > 1 ? ' are' : ' is'} typing…
          </>
        )}
      </output>
    </Show>
  )
}

// autocomplete from stock's own queries: `@` users and roles, `#` channels, `:` emoji (two letters at least, as stock).
// A pick goes in as text the parser turns back into a mention

// One row: what goes in, what shows, stock's hint at the end. A section's first row carries its heading or a divider
interface Item {
  text: string
  label: string
  hint?: string
  head?: string
  div?: boolean
  img?: string
  avatar?: string
  status?: string
  kind?: string
  color?: string
}

const TOKEN = /(?:^|\s)([@#:])([^\s@#:]*)$/
const ROLE_HINT = 'Notify users with this role who have permission to view this channel.'
// stock's headings: "Members" alone, "Members matching @pie" with a query
const heading = (what: string, t: { kind: string; query: string }) =>
  t.query ? `${what} matching ${t.kind}${t.query}` : what
// sections in order, each after a divider (stock's @ list: members, @everyone and @here, roles)
const sections = (...lists: Item[][]) =>
  lists.filter((l) => l.length).flatMap((l, i) => (i ? [{ ...l[0], div: true }, ...l.slice(1)] : l))

function createAutocomplete(box: () => HTMLTextAreaElement, channel: () => Rec | undefined) {
  const [token, setToken] = createSignal<{ kind: string; query: string; at: number } | null>(null)
  const [sel, setSel] = createSignal(0)
  let menu!: HTMLMenuElement

  const items = createMemo((): Item[] => {
    const t = token(),
      c = channel()
    if (!t || !c) return []
    if (t.kind === '@') {
      // as stock's box: @everyone, @here and every role with the permission to mention everyone
      const everyone = !c.isPrivate() && S.Permission.can(PERMS.MENTION_EVERYONE, c)
      const r = A.autocomplete.queryMentionResults({
        query: t.query,
        channel: c,
        canMentionEveryone: everyone,
        request: true,
      })
      const users: Item[] = r.users.slice(0, 10).map((u: Rec, i: number) => ({
        text: `@${u.user.username}`,
        label: nameOf(u.user, u.nick),
        hint: u.user.username,
        head: i ? undefined : heading('Members', t),
        avatar: u.user.getAvatarURL(c.guild_id, 32),
        status: $.Presence.getStatus(u.user.id),
      }))
      const globals: Item[] = r.globals
        .filter((g: Rec) => g.text === '@everyone' || g.text === '@here')
        .map((g: Rec) => ({ text: g.text, label: g.text, hint: g.description }))
      const roles: Item[] = r.roles.map((role: Rec) => ({
        text: `@${role.name}`,
        label: `@${role.name}`,
        hint: ROLE_HINT,
        color: role.colorString ?? undefined,
      }))
      return sections(users, globals, roles).slice(0, 15)
    }
    if (t.kind === '#')
      return A.autocomplete
        .queryChannelResults({ query: t.query, channel: c })
        .channels.slice(0, 10)
        .map((ch: Rec, i: number) => ({
          text: `#${ch.name}`,
          label: ch.name,
          hint: S.Channel.getChannel(ch.parent_id)?.name,
          kind: channels.kindOf(ch as Channel) ?? '',
          head: i ? undefined : heading(t.query ? 'Text channels' : 'Text Channels', t),
        }))
    if (t.query.length < 2) return []
    return A.autocomplete
      .queryEmojiResults({ query: t.query, channel: c, intention: 3, maxCount: 10 })
      .emojis.unlocked.map((e: Rec, i: number) => ({
        text: `:${e.name}:`,
        label: `:${e.name}:`,
        img: emojiSrc(e.emojiObject ?? e),
        hint: e.guildId && S.Guild.getGuild(e.guildId)?.name,
        head: i ? undefined : heading('Emoji', t),
      }))
  })

  // after each input: the token the caret ends
  const update = () => {
    const b = box(),
      m = TOKEN.exec(b.value.slice(0, b.selectionStart))
    setToken(m ? { kind: m[1], query: m[2], at: b.selectionStart - m[2].length - 1 } : null)
    setSel(0)
  }
  // open while there's something to pick (writes apply in a microtask: read them in an effect)
  createEffect(
    () => items().length > 0,
    (open) => {
      if (open) menu.showPopover()
      else if (menu.matches(':popover-open')) menu.hidePopover()
    },
  )

  const pick = (item: Item) => {
    const b = box(),
      t = token()!
    b.setRangeText(`${item.text} `, t.at, b.selectionStart, 'end')
    b.dispatchEvent(new Event('input', { bubbles: true }))
    b.focus()
  }

  // true when the key was the list's
  const key = (e: KeyboardEvent) => {
    const n = items().length
    if (!n || !menu.matches(':popover-open')) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setSel((sel() + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    else if (e.key === 'Tab' || e.key === 'Enter') pick(items()[sel()])
    else if (e.key === 'Escape') menu.hidePopover()
    else return false
    e.preventDefault()
    return true
  }

  const view = (
    <menu ref={menu} class="autocomplete" popover="manual">
      <For each={items()}>
        {(item, i) => (
          <>
            {item.head ? <h3>{item.head}</h3> : item.div ? <hr /> : null}
            <button
              data-id={item.text}
              class={[item.kind, { sel: i() === sel(), ch: item.kind !== undefined }]}
              data-status={item.status}
              style={
                item.avatar || item.color
                  ? { '--icon': item.avatar && `url(${item.avatar})`, color: item.color }
                  : undefined
              }
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
            >
              {item.img ? <img alt="" src={item.img} /> : null}
              {item.label}
              {item.hint ? <small>{item.hint}</small> : null}
            </button>
          </>
        )}
      </For>
    </menu>
  )

  return { view, update, key }
}
