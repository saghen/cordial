// The selected channel's messages: the list (scrolling, jumps, loading more), the new messages bar, the viewer and the
// message menu. Each message is a Message row; the list works out which start groups, carry dividers, or are collapsed.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import * as channels from '../api/channels'
import { cancel, typingNames } from '../api/composer'
import * as messages from '../api/messages'
import * as pickers from '../api/pickers'
import type { Emoji as EmojiRecord, Id, Message as MessageRecord } from '../api/types'
import { Permission } from '../api/types'
import { selectedChannel, selectedChat } from '../api/store'
import { text, textAround } from '../api/strings'
import * as users from '../api/users'
import { Emoji } from '../components/emoji'
import { flash } from '../components/message/head'
import { Message } from '../components/message/message'
import { Viewer } from '../components/viewer'
import { Button } from '../primitives/button'
import { contextMenu, Items } from '../primitives/menu'
import { SearchInput } from '../primitives/search'
import { focus } from './composer'
import { createScroller } from './scroller'

// a second right click this soon after the first on a message is a double one
const DOUBLE_MS = 500

export function Chat() {
  const channelId = selectedChat
  const channel = createMemo(selectedChannel)
  const loaded = createMemo(() => {
    const id = channelId()
    return id ? messages.list(id) : null
  })
  const list = createMemo(() => (loaded()?.toArray() ?? []) as MessageRecord[])
  // the NEW line: where ReadStateStore puts it when the channel is opened (or first, while it's shown), then kept there
  // until Escape, Mark As Read or Mark Unread. The store's own goes when you send, and moves to the first message
  // that arrives after the window was left
  const [unread, setUnread] = createSignal<Id | null>(null)
  createEffect(
    () => {
      const id = channelId()
      return { id, oldest: id && messages.oldestUnread(id) }
    },
    ({ id, oldest }, prev) => {
      if (id !== prev?.id || (oldest && !unread())) setUnread(oldest || null)
    },
  )
  const replying = createMemo(() => {
    const id = channelId()
    return id && messages.pendingReply(id)
  })
  const editing = createMemo(() => {
    const id = channelId()
    return id && messages.editing(id)
  })
  const menu = messageMenu(() => setUnread(null))

  // the runs of blocked or ignored messages shown, by their first message
  const [shown, setShown] = createSignal<Record<Id, boolean>>({})

  // keyed by id: an updated message (an edit, a reaction, a scan) keeps its row, which keeps its measured height
  function Row(message: () => MessageRecord, i: () => number) {
    // as stock, a run of blocked (or ignored) messages is one line, "N blocked messages", until Show messages
    const id = message().id
    const hidden = createMemo(() => messages.hiddenAs(message()))
    const run = createMemo(() => {
      if (!hidden()) return
      let start = i()
      while (start > 0 && messages.hiddenAs(list()[start - 1]) === hidden()) start--
      return list()[start].id
    })
    const count = createMemo(() => {
      let length = 0
      if (run() === id) while (messages.hiddenAs(list()[i() + length]) === hidden()) length++
      return length
    })
    const collapsed = () => Boolean(hidden()) && !shown()[run()!]
    return (
      <Message
        message={message()}
        channel={channel()}
        // a system message is a line of its own, without an author line
        head={!collapsed() && messages.isUser(message()) && messages.startsGroup(channel(), list()[i() - 1], message())}
        day={messages.dayOf(list()[i() - 1], message())}
        isNew={unread() === id}
        replying={replying() === id}
        editing={editing() === id}
        collapsed={collapsed()}
        gone={collapsed() && !count()}
        run={
          count() > 0 && (
            <button class={`${hidden()}-show`} onClick={() => setShown((prev) => ({ ...prev, [id]: !prev[id] }))}>
              {text(hidden() === 'blocked' ? 'BLOCKED_MESSAGE_COUNT' : 'IGNORED_MESSAGE_COUNT', { count: count() })} —{' '}
              {text(collapsed() ? 'BLOCKED_MESSAGES_SHOW' : 'BLOCKED_MESSAGES_HIDE', { count: count() })}
            </button>
          )
        }
        onReact={(e) => menu.show(e, { message: message(), react: true })}
      />
    )
  }

  // scrolled up more than a screen, or the newest messages not loaded: a button back to them (stock's Jump to Present)
  const [up, setUp] = createSignal(false)
  // .up: off the bottom at all (the typing row covers what scrolls under it)
  const view = (
    <div
      class="messages"
      onScroll={() => {
        const below = scroller.fromBottom()
        setUp(below > view.clientHeight)
        view.classList.toggle('up', below > 1)
      }}
    >
      <div>
        <For each={list()} keyed={(message) => message.id}>
          {Row}
        </For>
      </div>
    </div>
  ) as HTMLElement
  let jumping = false
  function present() {
    if (loaded()?.hasMoreAfter) {
      jumping = true
      messages.jumpToPresent(channelId()!)
    } else scroller.toBottom(true)
  }

  // Escape, as stock's, anywhere but another field or an open menu: the edit or the reply dropped, else the channel
  // read and back at its newest message; then the box has the focus
  function escape(e: KeyboardEvent) {
    const id = channelId()
    const target = e.target as Element
    if (e.key !== 'Escape' || e.defaultPrevented || !id || document.fullscreenElement) return
    if (document.querySelector(':popover-open:not([popover=manual]), dialog[open]')) return
    if (target.closest('input, textarea, [contenteditable=true]') && target.id !== 'mc-composer') return
    if (!cancel(id)) {
      messages.readByKey(id)
      setUnread(null)
      present()
    }
    focus()
  }
  document.addEventListener('keydown', escape)
  onCleanup(() => document.removeEventListener('keydown', escape))

  // a jump (a reply, the new messages bar, a link to a message): its target in view once rendered, flashed. Each
  // channel's last jump seen is kept, so coming back to a channel doesn't jump again
  const jumps = new Map<Id, number>()
  function jumped(id: Id) {
    const jump = messages.jumpTarget(id, jumps.get(id))
    jumps.set(id, jump.sequence)
    if (!jump.id) return
    // after the scroller's frame, which takes a switched channel to the bottom
    requestAnimationFrame(() => {
      const row = view.querySelector<HTMLElement>(`[data-id="${jump.id}"]`)
      if (!row) return
      row.scrollIntoView({ block: jump.top ? 'start' : 'center' })
      scroller.moved(row)
      if (jump.flash) flash(row)
    })
  }

  // after the rows are in the DOM: the scroller, and the list's `data-id` (the channel whose messages it shows)
  const scroller = createScroller(view, channelId)
  createEffect(
    () => ({ id: channelId(), list: list(), ready: loaded()?.ready }),
    ({ id, list, ready }, prev) => {
      // your own new message brings the list down to it, unless you're reading more than a view above (stock always
      // jumps)
      const last = list.at(-1)
      const sent =
        prev !== undefined &&
        id === prev.id &&
        last?.id !== prev.list.at(-1)?.id &&
        Boolean(last && messages.own(last)) &&
        scroller.fromBottom() <= view.clientHeight
      scroller.rendered(id !== prev?.id, sent)
      if (id && ready) jumped(id)
      if (jumping && !loaded()?.hasMoreAfter) {
        jumping = false
        scroller.toBottom()
      }
      if (id && ready) view.dataset.id = id
      else delete view.dataset.id
    },
  )
  view.addEventListener('contextmenu', (e) => {
    const id = (e.target as Element).closest<HTMLElement>('article[data-id]')?.dataset.id
    if (id) right = { id, at: e.timeStamp }
    menu.open(e)
  })
  // ours: a double right click on a message (the second on it or on the menu the first opened) edits your own, or
  // leaves the edit on the one being edited, else replies
  let right: { id: string; at: number } | null = null
  function onRight(e: MouseEvent) {
    const target = e.target as Element
    const first = right
    right = null
    if (!first || e.timeStamp - first.at > DOUBLE_MS) return
    if (
      !target.closest('menu.message-menu') &&
      target.closest<HTMLElement>('article[data-id]')?.dataset.id !== first.id
    )
      return
    e.preventDefault()
    e.stopPropagation()
    menu.hide()
    const id = channelId()
    const current = channel()
    const message = id && messages.get(id, first.id)
    if (!id || !current || !message) return
    if (messages.editing(id) === message.id) cancel(id)
    else if (messages.canEdit(message)) messages.startEdit(message)
    else if (messages.canReply(message, current)) messages.reply(message, current)
    else return
    focus()
  }
  document.addEventListener('contextmenu', onRight, true)
  onCleanup(() => document.removeEventListener('contextmenu', onRight, true))
  return (
    <>
      {view}
      <NewMessages channelId={channelId} onRead={() => setUnread(null)} />
      <Typing channelId={channelId} />
      <Show when={up() || loaded()?.hasMoreAfter}>
        <Button variant="primary" class="jump" onClick={present}>
          {text('JUMP_TO_PRESENT')}
        </Button>
      </Show>
      {menu.view}
      <Viewer />
    </>
  )
}

// stock's new messages bar, while the channel has unreads: "N new messages since 10:59 PM", a click jumps to the oldest
// unread, Mark As Read acks the channel
function NewMessages(p: { channelId: () => Id | null; onRead(): void }) {
  function bar() {
    const id = p.channelId()
    return id && messages.newMessages(id)
  }
  return (
    <Show when={bar()}>
      {(line) => (
        <div class="new-messages">
          <Button variant="link" class="new-messages-jump" onClick={() => messages.jumpToUnread(p.channelId()!)}>
            {line()}
          </Button>
          <Button
            variant="link"
            class="new-messages-read"
            onClick={() => {
              messages.markRead(p.channelId()!)
              p.onRead()
            }}
          >
            {text('MARK_AS_READ')}
          </Button>
        </div>
      )}
    </Show>
  )
}

// who else is typing, in stock's words: "A is typing...", "A and B are...", "A, B, and C are...", then "Several
// people are..."
const TYPING = ['ONE_USER_TYPING', 'TWO_USERS_TYPING', 'THREE_USERS_TYPING'] as const
function Typing(p: { channelId: () => Id | null }) {
  const names = createMemo(() => {
    const id = p.channelId()
    return id ? typingNames(id) : []
  })
  return (
    <Show when={names().length}>
      <output class="typing">
        {names().length > TYPING.length
          ? text('SEVERAL_USERS_TYPING')
          : textAround(TYPING[names().length - 1], {}, ['a', 'b', 'c'].slice(0, names().length)).map((part) =>
              typeof part === 'number' ? <b>{names()[part]}</b> : part,
            )}
      </output>
    </Show>
  )
}

// the message menu (right click on a message); from the add-reaction chip, straight to the emoji search
function messageMenu(onMarkUnread: () => void) {
  const menu = contextMenu<{ message: MessageRecord; react: boolean }>({
    class: 'message-menu',
    find(e) {
      const id = (e.target as Element).closest('article')?.dataset.id
      const channelId = selectedChat()
      const message = id && channelId ? messages.get(channelId, id) : undefined
      return message && { message, react: false }
    },
    children: (target) => (
      <MessageItems
        message={target().message}
        react={target().react}
        onMarkUnread={onMarkUnread}
        onClose={() => menu.hide()}
      />
    ),
  })
  return menu
}

// the four most used reactions on top, as stock; React swaps the items for an emoji search: the most used, then what
// the query matches
const TOP_REACTIONS = 4
const REACTION_RESULTS = 24
function MessageItems(p: { message: MessageRecord; react: boolean; onMarkUnread(): void; onClose(): void }) {
  const [query, setQuery] = createSignal<string | null>(p.react ? '' : null)
  const message = () => p.message
  const channel = () => channels.get(message().channel_id)!
  const can = (permission: bigint) => users.can(permission, channel())
  function emojis() {
    const search = query()
    return (search ? pickers.searchReactions(channel(), search, REACTION_RESULTS) : pickers.frequentReactions()).slice(
      0,
      REACTION_RESULTS,
    )
  }
  function Emojis(p: { each: EmojiRecord[] }) {
    return (
      <p>
        <Items
          items={p.each.map((emoji) => ({
            name: 'react',
            id: emoji.id ?? emoji.name,
            title: `:${emoji.name}:`,
            label: <Emoji emoji={emoji} />,
            run: () => messages.react(message(), emoji),
          }))}
        />
      </p>
    )
  }
  return (
    <Show
      when={query() == null}
      fallback={
        <>
          <SearchInput
            class="react-search"
            placeholder={text('SEARCH_FOR_EMOJI')}
            autofocus
            onInput={setQuery}
            onEnter={() => {
              if (!emojis()[0]) return
              p.onClose()
              messages.react(message(), emojis()[0])
            }}
          />
          <Emojis each={emojis()} />
        </>
      }
    >
      <Show when={can(Permission.ADD_REACTIONS)}>
        <Emojis each={pickers.frequentReactions().slice(0, TOP_REACTIONS)} />
      </Show>
      <Items
        items={[
          can(Permission.ADD_REACTIONS) && {
            name: 'menu-react',
            icon: 'reaction',
            label: text('ADD_REACTION'),
            keep: true,
            run: () => setQuery(''),
          },
          can(Permission.ADD_REACTIONS) && '-',
          messages.canEdit(message()) && {
            name: 'menu-edit',
            icon: 'pencil',
            label: text('EDIT_MESSAGE'),
            run() {
              messages.startEdit(message())
              focus()
            },
          },
          messages.canReply(message(), channel()) && {
            name: 'menu-reply',
            icon: 'reply',
            label: text('MESSAGE_ACTION_REPLY'),
            run() {
              messages.reply(message(), channel())
              focus()
            },
          },
          '-',
          {
            name: 'menu-copy',
            icon: 'copy',
            label: text('COPY_TEXT'),
            run: () => navigator.clipboard.writeText(message().content),
          },
          messages.canPin(message(), channel()) && {
            name: 'menu-pin',
            icon: 'pin',
            label: text(message().pinned ? 'UNPIN_MESSAGE' : 'PIN_MESSAGE'),
            run: () => messages.togglePin(message()),
          },
          {
            name: 'menu-unread',
            icon: 'unread',
            label: text('MARK_UNREAD'),
            run() {
              messages.markUnread(message())
              p.onMarkUnread()
            },
          },
          {
            name: 'menu-link',
            icon: 'link',
            label: text('COPY_MESSAGE_LINK'),
            run: () => navigator.clipboard.writeText(messages.link(message(), channel())),
          },
          messages.canDelete(message(), channel()) && '-',
          messages.canDelete(message(), channel()) && {
            name: 'menu-delete',
            icon: 'trash',
            class: 'danger',
            label: text('DELETE_MESSAGE'),
            confirm: text('CONFIRM_DELETE'),
            run: () => messages.remove(message()),
          },
        ]}
      />
    </Show>
  )
}
