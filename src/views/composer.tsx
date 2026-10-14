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
  const c = composer.useComposer(selected)
  const id = () => selected()!
  let files!: HTMLInputElement
  const complete = createAutocomplete(() => box!, c.channel)

  // a switch saves the text left behind; the box then shows the new channel's draft, or the message being edited, and
  // takes the focus
  createEffect(
    () => [selected(), c.editing()] as const,
    ([channelId], prev) => {
      if (prev?.[0] && prev[0] !== channelId) c.leave(prev[0])
      box!.value = channelId ? c.textOf(channelId) : ''
      if (channelId) box!.focus()
    },
  )

  const key = (e: KeyboardEvent) => {
    if (complete.key(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (c.send(id(), box!.value)) box!.value = ''
    } else if (e.key === 'ArrowUp' && !box!.value && !c.editing() && c.editLast(id())) e.preventDefault()
  }
  // pasted files (a screenshot, a copied image) join the uploads, as + does
  const paste = (e: ClipboardEvent) => {
    const pasted = [...(e.clipboardData?.files ?? [])]
    if (!pasted.length || !c.open()) return
    e.preventDefault()
    c.upload(pasted)
  }
  // files dropped anywhere on the window join them too (left to the browser, a drop would navigate to the file)
  useFileDrop((dropped) => c.open() && c.upload(dropped))
  const picking = () => (c.open() ? c.channel() : undefined)

  return (
    <section class="composer" hidden={!selected()}>
      <Show when={c.reply()}>
        {(r) => (
          <div class="reply">
            <span>
              {textAround('REPLYING_TO', {}, ['userHook']).map((part) =>
                part === 0 ? <b>{composer.replyName(r().message as Message, r().channel.guild_id)}</b> : part,
              )}
            </span>
            <Show when={r().showMentionToggle}>
              <Button
                variant="link"
                class={['reply-mention', { on: r().shouldMention }]}
                aria-pressed={r().shouldMention ? 'true' : 'false'}
                onClick={() => c.mention(id(), !r().shouldMention)}
              >
                @ {text(r().shouldMention ? 'REPLY_MENTION_ON' : 'REPLY_MENTION_OFF')}
              </Button>
            </Show>
            <IconButton
              class="reply-cancel"
              icon="close"
              title={text('CANCEL_REPLY')}
              onClick={() => c.removeReply(id())}
            />
          </div>
        )}
      </Show>
      <div class={['box', { editing: !!c.editing() }]}>
        <Show when={c.uploads().length}>
          <ul class="uploads">
            <For each={c.uploads()}>
              {(u) => {
                // an image shows itself, as stock's card, from the picked file
                const file: File | undefined = u.item?.file
                const preview = file?.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
                onCleanup(() => preview && URL.revokeObjectURL(preview))
                return (
                  <li
                    class="upload"
                    data-id={u.filename}
                    style={preview ? { '--preview': `url(${preview})` } : undefined}
                  >
                    <span>{u.filename}</span>
                    <IconButton
                      class="upload-remove"
                      icon="trash"
                      title={text('REMOVE')}
                      onClick={() => c.removeUpload(id(), u)}
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
            c.upload([...files.files!])
            files.value = ''
          }}
        />
        <IconButton
          class="attach"
          icon="plus"
          title={text('CHAT_ATTACH_UPLOAD_A_FILE')}
          hidden={!c.open()}
          onClick={() => files.click()}
        />
        <textarea
          ref={box}
          id="mc-composer"
          rows={1}
          disabled={!c.open()}
          placeholder={c.placeholder()}
          onInput={() => {
            complete.update()
            c.input(id(), box!.value)
          }}
          onKeyDown={key}
          onPaste={paste}
        />
        <StickerPicker channel={picking} send={(sticker) => c.sendSticker(id(), sticker)} />
        <GifPicker channel={picking} send={(url) => c.sendLink(id(), url)} />
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
  div?: boolean
}

const TOKEN = /(?:^|\s)([@#:])([^\s@#:]*)$/
type Token = { kind: string; query: string; at: number }
// stock's headings: "Members" alone, "Members matching **@pie**" with a query
const heading = (
  alone: Parameters<typeof text>[0],
  matching: Parameters<typeof textAround>[0],
  t: Token,
): JSX.Element =>
  t.query
    ? textAround(matching, {}, ['prefix']).map((part) => (part === 0 ? <b>{t.kind + t.query}</b> : part))
    : text(alone)
// sections in order, each after a divider (stock's @ list: members, @everyone and @here, roles)
const sections = (...lists: Item[][]) =>
  lists.filter((l) => l.length).flatMap((l, i) => (i ? [{ ...l[0], div: true }, ...l.slice(1)] : l))

function items(t: Token, c: Channel): Item[] {
  if (t.kind === '@') {
    const r = composer.mentions(t.query, c)
    return sections(
      r.users.map((u, i) => ({
        text: `@${u.user.username}`,
        label: users.nameOf(u.user, u.nick),
        icon: <Avatar user={u.user} guildId={c.guild_id} size={24} status={users.status(u.user.id)} />,
        hint: u.user.username,
        head: i ? undefined : heading('MEMBERS', 'MEMBERS_MATCHING', t),
      })),
      r.globals.map((g) => ({ text: g.text, label: g.text, hint: g.description })),
      r.roles.map((role) => ({
        text: `@${role.name}`,
        label: `@${role.name}`,
        hint: text('MENTION_USERS_WITH_ROLE'),
        color: role.colorString ?? undefined,
      })),
    ).slice(0, 15)
  }
  if (t.kind === '#')
    return composer.channelResults(t.query, c).map((ch, i) => ({
      text: `#${ch.name}`,
      label: ch.name,
      icon: <ChannelIcon channel={ch} />,
      hint: ch.parent_id ? composer.categoryName(ch) : undefined,
      head: i ? undefined : heading('TEXT_CHANNELS', 'TEXT_CHANNELS_MATCHING', t),
    }))
  return composer.emojiResults(t.query, c).map((e, i) => ({
    text: `:${e.emoji.name}:`,
    label: `:${e.emoji.name}:`,
    icon: <Emoji emoji={e.emoji} />,
    hint: e.guild,
    head: i ? undefined : heading('EMOJI', 'EMOJI_MATCHING', t),
  }))
}

function createAutocomplete(box: () => HTMLTextAreaElement, channel: () => Channel | undefined) {
  const [token, setToken] = createSignal<Token | null>(null)
  const [sel, setSel] = createSignal(0)
  let menu!: HTMLMenuElement
  const list = createMemo(() => (token() && channel() ? items(token()!, channel()!) : []))

  // after each input: the token the caret ends
  const update = () => {
    const b = box(),
      m = TOKEN.exec(b.value.slice(0, b.selectionStart))
    setToken(m ? { kind: m[1], query: m[2], at: b.selectionStart - m[2].length - 1 } : null)
    setSel(0)
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
    const b = box()
    b.setRangeText(`${item.text} `, token()!.at, b.selectionStart, 'end')
    b.dispatchEvent(new Event('input', { bubbles: true }))
    b.focus()
  }

  // true when the key was the list's
  const key = (e: KeyboardEvent) => {
    const n = list().length
    if (!n || !menu.matches(':popover-open')) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setSel((sel() + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    else if (e.key === 'Tab' || e.key === 'Enter') pick(list()[sel()])
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
            {item.head ? <h3>{item.head}</h3> : item.div ? <hr /> : null}
            <Row
              name="suggestion"
              class={{ sel: i() === sel() }}
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
