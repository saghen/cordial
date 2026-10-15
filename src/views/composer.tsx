// The composer (api/composer.ts): the reply bar, then the box: the files waiting to go, the text (the draft, or the
// message being edited) and the buttons around it. Enter sends, Shift+Enter is a new line, Up in an empty box edits the
// last own message (Enter saves, Escape leaves: the chat's). Autocomplete offers what @, # and : start.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as composer from '../api/composer'
import { useFileDrop } from '../api/hooks'
import type { Channel, Message } from '../api/types'
import { selectedChat } from '../api/store'
import { text, textAround } from '../api/strings'
import * as users from '../api/users'
import { Avatar } from '../components/avatar'
import { ChannelIcon } from '../components/channel_icon'
import { Emoji } from '../components/emoji'
import { EmojiPicker, GifPicker, StickerPicker } from '../components/pickers'
import { createSuggestions, type Suggestion } from '../components/suggestions'
import { Button, IconButton } from '../primitives/button'
import { hasCode, preview } from './preview'

let box: HTMLTextAreaElement | undefined
// the box focused, for what fills it from elsewhere (the message menu's Edit and Reply)
export const focus = () => box?.focus()
// text put in at the caret (the member menu's Mention, the emoji picker), a space before it where it would join a
// word; `insert` then focuses the box, `place` leaves the focus where it is (a picker kept open by Shift)
export const canInsert = () => Boolean(box && !box.disabled)
function place(text: string) {
  if (!box || box.disabled) return
  const before = box.value.slice(0, box.selectionStart)
  box.setRangeText(before && !/\s$/.test(before) ? ` ${text}` : text, box.selectionStart, box.selectionEnd, 'end')
  box.dispatchEvent(new Event('input', { bubbles: true }))
}
export function insert(text: string) {
  place(text)
  focus()
}

export function Composer() {
  // the chat's id, not its record: the ChannelStore changes far more often than the selection
  const chat = createMemo(selectedChat)
  const state = composer.useComposer(chat)
  const id = () => chat()!
  let files!: HTMLInputElement
  let layer!: HTMLDivElement
  // the preview under the text; with a code block, the whole box in monospace (a textarea has one font)
  const render = () => {
    layer.innerHTML = preview(box!.value, render)
    layer.parentElement!.toggleAttribute('data-code', hasCode(box!.value))
  }
  const complete = createAutocomplete(() => box!, state.channel)

  // a switch saves the text left behind; the box then shows the new channel's draft, or the message being edited, and
  // takes the focus
  createEffect(
    () => ({ channelId: chat(), editing: state.editing() }),
    ({ channelId }, prev) => {
      if (prev?.channelId && prev.channelId !== channelId) state.leave(prev.channelId)
      box!.value = channelId ? state.textOf(channelId) : ''
      render()
      if (channelId) box!.focus()
    },
  )

  // as stock, a key typed with nothing else to take it goes into the box: no field focused, no popover, menu or dialog
  // open, no modifier but Shift
  function typeInto(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || !state.open()) return
    if ((e.target as Element).closest('input, textarea, select, [contenteditable=true]')) return
    if (document.querySelector(':popover-open:not([popover=manual]), dialog[open]')) return
    box!.focus()
  }
  document.addEventListener('keydown', typeInto)
  onCleanup(() => document.removeEventListener('keydown', typeInto))

  function key(e: KeyboardEvent) {
    if (complete.key(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (state.send(id(), box!.value)) {
        box!.value = ''
        render()
      }
    } else if (e.key === 'ArrowUp' && !box!.value && !state.editing() && state.editLast(id())) e.preventDefault()
  }
  // pasted files (a screenshot, a copied image) join the uploads, as + does
  function paste(e: ClipboardEvent) {
    const pasted = [...(e.clipboardData?.files ?? [])]
    if (!pasted.length || !state.open()) return
    e.preventDefault()
    state.upload(pasted)
  }
  // files dropped anywhere on the window join them too (left to the browser, a drop would navigate to the file)
  useFileDrop((dropped) => state.open() && state.upload(dropped))
  const picking = () => (state.open() ? state.channel() : undefined)

  return (
    <section class="composer" hidden={!chat()}>
      {/* the bar over the box: the edit (red once emptied: Enter deletes), else the reply */}
      <Show
        when={state.editing()}
        fallback={
          <Show when={state.reply()} keyed>
            {(reply) => (
              <div class="bar reply">
                <span>
                  {textAround('REPLYING_TO', {}, ['userHook']).map((part) =>
                    part === 0 ? <b>{composer.replyName(reply.message as Message, reply.channel.guild_id)}</b> : part,
                  )}
                </span>
                <Show when={reply.showMentionToggle}>
                  <Button
                    variant="link"
                    class={['reply-mention', { on: reply.shouldMention }]}
                    aria-pressed={reply.shouldMention ? 'true' : 'false'}
                    onClick={() => state.mention(id(), !reply.shouldMention)}
                  >
                    @ {text(reply.shouldMention ? 'REPLY_MENTION_ON' : 'REPLY_MENTION_OFF')}
                  </Button>
                </Show>
                <IconButton
                  class="bar-cancel"
                  icon="close"
                  title={text('CANCEL_REPLY')}
                  onClick={() => state.removeReply(id())}
                />
              </div>
            )}
          </Show>
        }
      >
        <div class={['bar', 'edit', { delete: state.deletes() }]}>
          <b>{text(state.deletes() ? 'DELETE_MESSAGE' : 'EDITING_MESSAGE')}</b>
          <span>
            {state.deletes() ? text('EDIT_DELETE_HELP') : text('EDIT_TEXTAREA_HELP', { onCancel: '', onSave: '' })}
          </span>
          <IconButton class="bar-cancel" icon="close" title={text('CANCEL')} onClick={() => composer.cancel(id())} />
        </div>
      </Show>
      <div class={['box', { editing: Boolean(state.editing()), delete: state.deletes() }]}>
        <Show when={state.uploads().length}>
          <ul class="uploads">
            <For each={state.uploads()}>
              {(upload) => {
                // an image shows itself, as stock's card, from the picked file
                const file: File | undefined = upload.item?.file
                const preview = file?.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
                onCleanup(() => preview && URL.revokeObjectURL(preview))
                return (
                  <li
                    class="upload"
                    data-id={upload.filename}
                    style={preview ? { '--preview': `url(${preview})` } : undefined}
                  >
                    <span>{upload.filename}</span>
                    <IconButton
                      class="upload-remove"
                      icon="trash"
                      title={text('REMOVE')}
                      onClick={() => state.removeUpload(id(), upload)}
                    />
                  </li>
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
            state.upload([...files.files!])
            files.value = ''
          }}
        />
        <IconButton
          class="attach"
          icon="plus"
          title={text('CHAT_ATTACH_UPLOAD_A_FILE')}
          hidden={!state.open()}
          onClick={() => files.click()}
        />
        {/* the text styled as markdown, under the box's own (transparent) text */}
        <div ref={layer} class="preview" aria-hidden="true" />
        <textarea
          ref={box}
          id="mc-composer"
          rows={1}
          disabled={!state.open()}
          placeholder={state.placeholder()}
          onInput={() => {
            complete.update()
            state.input(id(), box!.value)
            render()
          }}
          onScroll={() => {
            layer.scrollTop = box!.scrollTop
          }}
          onKeyDown={key}
          onPaste={paste}
        />
        <StickerPicker channel={picking} send={(sticker) => state.sendSticker(id(), sticker)} />
        <GifPicker channel={picking} send={(url) => state.sendLink(id(), url)} />
        <EmojiPicker insert={place} onClose={focus} channel={picking} />
      </div>
      {complete.view}
    </section>
  )
}

// Autocomplete from stock's queries: `@` members, @everyone and @here, then roles; `#` channels; `:` emoji. A pick goes
// in as text the parser turns back into a mention.

// one row: what goes in, what shows, stock's hint at its end. A section's first row carries its heading or a divider

const TOKEN = /(?:^|\s)([@#:])([^\s@#:]*)$/
const MENTION_LIMIT = 15
type Token = { kind: string; query: string; at: number }
// stock's headings: "Members" alone, "Members matching **@pie**" with a query
const heading = (
  alone: Parameters<typeof text>[0],
  matching: Parameters<typeof textAround>[0],
  token: Token,
): JSX.Element =>
  token.query
    ? textAround(matching, {}, ['prefix']).map((part) => (part === 0 ? <b>{token.kind + token.query}</b> : part))
    : text(alone)
// sections in order, each after a divider (stock's @ list: members, @everyone and @here, roles)
const sections = (...lists: Suggestion[][]) =>
  lists
    .filter((list) => list.length)
    .flatMap((list, i) => (i ? [{ ...list[0], divider: true }, ...list.slice(1)] : list))

function items(token: Token, channel: Channel): Suggestion[] {
  if (token.kind === '@') {
    const results = composer.mentions(token.query, channel)
    return sections(
      results.users.map((member, i) => ({
        text: `@${member.user.username}`,
        label: users.nameOf(member.user, member.nick),
        icon: <Avatar user={member.user} guildId={channel.guild_id} size={24} status={users.status(member.user.id)} />,
        hint: member.user.username,
        head: i ? undefined : heading('MEMBERS', 'MEMBERS_MATCHING', token),
      })),
      results.globals.map((mention) => ({ text: mention.text, label: mention.text, hint: mention.description })),
      results.roles.map((role) => ({
        text: `@${role.name}`,
        label: `@${role.name}`,
        hint: text('MENTION_USERS_WITH_ROLE'),
        color: role.colorString ?? undefined,
      })),
    ).slice(0, MENTION_LIMIT)
  }
  if (token.kind === '#')
    return composer.channelResults(token.query, channel).map((result, i) => ({
      text: `#${result.name}`,
      label: result.name,
      icon: <ChannelIcon channel={result} />,
      hint: result.parent_id ? composer.categoryName(result) : undefined,
      head: i ? undefined : heading('TEXT_CHANNELS', 'TEXT_CHANNELS_MATCHING', token),
    }))
  return composer.emojiResults(token.query, channel).map((result, i) => ({
    text: `:${result.emoji.name}:`,
    label: `:${result.emoji.name}:`,
    icon: <Emoji emoji={result.emoji} />,
    hint: result.guild,
    head: i ? undefined : heading('EMOJI', 'EMOJI_MATCHING', token),
  }))
}

function createAutocomplete(box: () => HTMLTextAreaElement, channel: () => Channel | undefined) {
  const [token, setToken] = createSignal<Token | null>(null)
  const list = createMemo(() => {
    const typed = token()
    const current = channel()
    return typed && current ? items(typed, current) : []
  })
  const suggestions = createSuggestions({ class: 'autocomplete', list, pick })

  // after each input: the token the caret ends
  function update() {
    const textarea = box()
    const match = TOKEN.exec(textarea.value.slice(0, textarea.selectionStart))
    setToken(match ? { kind: match[1], query: match[2], at: textarea.selectionStart - match[2].length - 1 } : null)
    suggestions.reset()
  }

  function pick(item: Suggestion) {
    const textarea = box()
    textarea.setRangeText(`${item.text} `, token()!.at, textarea.selectionStart, 'end')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
  }

  return { view: suggestions.view, update, key: suggestions.key }
}
