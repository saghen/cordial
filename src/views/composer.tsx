// The composer (api/composer.ts): the reply bar, then the box: the files waiting to go, the text (the draft, or the
// message being edited) and the buttons around it. Enter sends, Shift+Enter is a new line, Up in an empty box edits the
// last own message (Enter saves, Escape leaves: the chat's). Autocomplete offers what @, # and : start.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as composer from '../api/composer'
import { useFileDrop } from '../api/hooks'
import type { Channel, Message } from '../api/types'
import { selected } from '../api/store'
import { text, textAround } from '../api/strings'
import * as users from '../api/users'
import { Avatar } from '../components/avatar'
import { ChannelIcon } from '../components/channel_icon'
import { Emoji } from '../components/emoji'
import { EmojiPicker, GifPicker, StickerPicker } from '../components/pickers'
import { Button, IconButton } from '../primitives/button'
import { Row } from '../primitives/row'

let box: HTMLTextAreaElement | undefined
// the box focused, for what fills it from elsewhere (the message menu's Edit and Reply)
export const focus = () => box?.focus()

export function Composer() {
  const state = composer.useComposer(selected)
  const id = () => selected()!
  let files!: HTMLInputElement
  const complete = createAutocomplete(() => box!, state.channel)

  // a switch saves the text left behind; the box then shows the new channel's draft, or the message being edited, and
  // takes the focus
  createEffect(
    () => ({ channelId: selected(), editing: state.editing() }),
    ({ channelId }, prev) => {
      if (prev?.channelId && prev.channelId !== channelId) state.leave(prev.channelId)
      box!.value = channelId ? state.textOf(channelId) : ''
      if (channelId) box!.focus()
    },
  )

  const key = (e: KeyboardEvent) => {
    if (complete.key(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (state.send(id(), box!.value)) box!.value = ''
    } else if (e.key === 'ArrowUp' && !box!.value && !state.editing() && state.editLast(id())) e.preventDefault()
  }
  // pasted files (a screenshot, a copied image) join the uploads, as + does
  const paste = (e: ClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])]
    if (!pasted.length || !state.open()) return
    e.preventDefault()
    state.upload(pasted)
  }
  // files dropped anywhere on the window join them too (left to the browser, a drop would navigate to the file)
  useFileDrop((dropped) => state.open() && state.upload(dropped))
  const picking = () => (state.open() ? state.channel() : undefined)

  return (
    <section class="composer" hidden={!selected()}>
      <Show when={state.reply()}>
        {(reply) => (
          <div class="reply">
            <span>
              {textAround('REPLYING_TO', {}, ['userHook']).map((part) =>
                part === 0 ? <b>{composer.replyName(reply().message as Message, reply().channel.guild_id)}</b> : part,
              )}
            </span>
            <Show when={reply().showMentionToggle}>
              <Button
                variant="link"
                class={['reply-mention', { on: reply().shouldMention }]}
                aria-pressed={reply().shouldMention ? 'true' : 'false'}
                onClick={() => state.mention(id(), !reply().shouldMention)}
              >
                @ {text(reply().shouldMention ? 'REPLY_MENTION_ON' : 'REPLY_MENTION_OFF')}
              </Button>
            </Show>
            <IconButton
              class="reply-cancel"
              icon="close"
              title={text('CANCEL_REPLY')}
              onClick={() => state.removeReply(id())}
            />
          </div>
        )}
      </Show>
      <div class={['box', { editing: Boolean(state.editing()) }]}>
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
        <textarea
          ref={box}
          id="mc-composer"
          rows={1}
          disabled={!state.open()}
          placeholder={state.placeholder()}
          onInput={() => {
            complete.update()
            state.input(id(), box!.value)
          }}
          onKeyDown={key}
          onPaste={paste}
        />
        <StickerPicker channel={picking} send={(sticker) => state.sendSticker(id(), sticker)} />
        <GifPicker channel={picking} send={(url) => state.sendLink(id(), url)} />
        <EmojiPicker box={() => box!} channel={picking} />
      </div>
      {complete.view}
    </section>
  )
}

// Autocomplete from stock's queries: `@` members, @everyone and @here, then roles; `#` channels; `:` emoji. A pick goes
// in as text the parser turns back into a mention.

// one row: what goes in, what shows, stock's hint at its end. A section's first row carries its heading or a divider
interface Item {
  text: string
  label: string
  icon?: JSX.Element
  hint?: string
  color?: string
  head?: JSX.Element
  divider?: boolean
}

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
const sections = (...lists: Item[][]) =>
  lists
    .filter((list) => list.length)
    .flatMap((list, i) => (i ? [{ ...list[0], divider: true }, ...list.slice(1)] : list))

function items(token: Token, channel: Channel): Item[] {
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
  const [active, setActive] = createSignal(0)
  let menu!: HTMLMenuElement
  const list = createMemo(() => {
    const typed = token()
    const current = channel()
    return typed && current ? items(typed, current) : []
  })

  // after each input: the token the caret ends
  const update = () => {
    const textarea = box()
    const match = TOKEN.exec(textarea.value.slice(0, textarea.selectionStart))
    setToken(match ? { kind: match[1], query: match[2], at: textarea.selectionStart - match[2].length - 1 } : null)
    setActive(0)
  }
  // open while there's something to pick (writes apply in a microtask: read them in an effect)
  createEffect(
    () => list().length > 0,
    (open) => {
      if (open) menu.showPopover()
      else if (menu.matches(':popover-open')) menu.hidePopover()
    },
  )

  const pick = (item: Item) => {
    const textarea = box()
    textarea.setRangeText(`${item.text} `, token()!.at, textarea.selectionStart, 'end')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus()
  }

  // true when the key was the list's
  const key = (e: KeyboardEvent) => {
    const count = list().length
    if (!count || !menu.matches(':popover-open')) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      setActive((active() + (e.key === 'ArrowDown' ? 1 : count - 1)) % count)
    else if (e.key === 'Tab' || e.key === 'Enter') pick(list()[active()])
    else if (e.key === 'Escape') menu.hidePopover()
    else return false
    e.preventDefault()
    return true
  }

  const view = (
    <menu ref={menu} class="autocomplete" popover="manual">
      <For each={list()}>
        {(item, i) => (
          <>
            {item.head ? <h3>{item.head}</h3> : item.divider && <hr />}
            <Row
              name="suggestion"
              class={{ selected: i() === active() }}
              data-id={item.text}
              icon={item.icon}
              end={item.hint}
              style={item.color ? { color: item.color } : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
            >
              {item.label}
            </Row>
          </>
        )}
      </For>
    </menu>
  )

  return { view, update, key }
}
