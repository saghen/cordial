// The selected channel's messages: the list (scrolling, jumps, loading more), the new messages bar, the viewer and the
// message menu. Each message is a Message row; the list works out which start groups, carry dividers, or are collapsed.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import * as channels from '../api/channels'
import { cancel, typingNames } from '../api/composer'
import * as messages from '../api/messages'
import * as pickers from '../api/pickers'
import type { Emoji as EmojiRecord, Id, Message as Record } from '../api/types'
import { Permission } from '../api/types'
import { selected, selectedChannel } from '../api/store'
import { text, textAround } from '../api/strings'
import * as users from '../api/users'
import { Emoji } from '../components/emoji'
import { flash } from '../components/message/head'
import { Message } from '../components/message/message'
import { Viewer } from '../components/viewer'
import { Button, IconButton } from '../primitives/button'
import { contextMenu, Items } from '../primitives/menu'
import { SearchInput } from '../primitives/search'
import { focus } from './composer'
import { createScroller } from './scroller'

export function Chat() {
  const channelId = selected
  const channel = createMemo(selectedChannel)
  const loaded = createMemo(() => {
    const id = channelId()
    return id ? messages.list(id) : null
  })
  const list = createMemo(() => (loaded()?.toArray() ?? []) as Record[])
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
  const [shown, setShown] = createSignal<{ [id: Id]: boolean }>({})

  const Row = (m: Record, i: () => number) => {
    // as stock, a run of blocked (or ignored) messages is one line, "N blocked messages", until Show messages
    const hid = messages.hiddenAs(m)
    const run = createMemo(() => {
      if (!hid) return
      let j = i()
      while (j > 0 && messages.hiddenAs(list()[j - 1]) === hid) j--
      return list()[j].id
    })
    const count = createMemo(() => {
      let n = 0
      if (run() === m.id) while (messages.hiddenAs(list()[i() + n]) === hid) n++
      return n
    })
    const collapsed = () => Boolean(hid) && !shown()[run()!]
    return (
      <Message
        m={m}
        channel={channel()}
        // a system message is a line of its own, without an author line
        head={!collapsed() && messages.isUser(m) && messages.startsGroup(channel(), list()[i() - 1], m)}
        day={messages.dayOf(list()[i() - 1], m)}
        isNew={unread() === m.id}
        replying={replying() === m.id}
        editing={editing() === m.id}
        collapsed={collapsed()}
        gone={collapsed() && !count()}
        run={
          count() > 0 && (
            <button class={`${hid}-show`} onClick={() => setShown((s) => ({ ...s, [m.id]: !s[m.id] }))}>
              {text(hid === 'blocked' ? 'BLOCKED_MESSAGE_COUNT' : 'IGNORED_MESSAGE_COUNT', { count: count() })} —{' '}
              {text(collapsed() ? 'BLOCKED_MESSAGES_SHOW' : 'BLOCKED_MESSAGES_HIDE', { count: count() })}
            </button>
          )
        }
        onReact={(e) => menu.show(e, { m, react: true })}
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
        setUp(view.scrollTop < -view.clientHeight)
        view.classList.toggle('up', view.scrollTop < -1)
      }}
    >
      <div>
        <For each={list()}>{Row}</For>
      </div>
    </div>
  ) as HTMLElement
  let jumping = false
  const present = () => {
    if (loaded()?.hasMoreAfter) {
      jumping = true
      messages.jumpToPresent(channelId()!)
    } else view.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Escape, as stock's, anywhere but another field or an open menu: the edit or the reply dropped, else the channel
  // read and back at its newest message; then the box has the focus
  const escape = (e: KeyboardEvent) => {
    const id = channelId()
    const t = e.target as Element
    if (e.key !== 'Escape' || e.defaultPrevented || !id || document.fullscreenElement) return
    if (document.querySelector(':popover-open:not([popover=manual]), dialog[open]')) return
    if (t.closest('input, textarea, [contenteditable=true]') && t.id !== 'mc-composer') return
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
      if (jump.flash) flash(row)
    })
  }

  // after the rows are in the DOM: the scroller, and the list's `data-id` (the channel whose messages it shows)
  const rendered = createScroller(view, channelId)
  createEffect(
    () => ({ id: channelId(), list: list(), ready: loaded()?.ready }),
    ({ id, ready }, prev) => {
      rendered(id !== prev?.id)
      if (id && ready) jumped(id)
      if (jumping && !loaded()?.hasMoreAfter) {
        jumping = false
        view.scrollTop = 0
      }
      if (id && ready) view.dataset.id = id
      else delete view.dataset.id
    },
  )
  view.addEventListener('contextmenu', menu.open)
  return (
    <>
      {view}
      <NewMessages channelId={channelId} onRead={() => setUnread(null)} />
      <Typing channelId={channelId} />
      <Show when={up() || loaded()?.hasMoreAfter}>
        <IconButton class="jump" icon="chevron" title={text('JUMP_TO_PRESENT')} onClick={present} />
      </Show>
      {menu.view}
      <Viewer />
    </>
  )
}

// stock's new messages bar, while the channel has unreads: "N new messages since 10:59 PM", a click jumps to the oldest
// unread, Mark As Read acks the channel
function NewMessages(p: { channelId: () => Id | null; onRead(): void }) {
  const bar = () => {
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
const messageMenu = (onMarkUnread: () => void) =>
  contextMenu<{ m: Record; react: boolean }>({
    class: 'message-menu',
    find(e) {
      const id = (e.target as Element).closest('article')?.dataset.id
      const channelId = selected()
      const m = id && channelId ? messages.get(channelId, id) : undefined
      return m && { m, react: false }
    },
    children: (t) => <MessageItems message={t().m} react={t().react} onMarkUnread={onMarkUnread} />,
  })

// the four most used reactions on top, as stock; React swaps the items for an emoji search: the most used, then what
// the query matches
const TOP_REACTIONS = 4
const REACTION_RESULTS = 24
function MessageItems(p: { message: Record; react: boolean; onMarkUnread(): void }) {
  const [query, setQuery] = createSignal<string | null>(p.react ? '' : null)
  const m = () => p.message
  const channel = () => channels.get(m().channel_id)!
  const can = (permission: bigint) => users.can(permission, channel())
  const emojis = () => {
    const search = query()
    return (search ? pickers.searchReactions(channel(), search, REACTION_RESULTS) : pickers.frequentReactions()).slice(
      0,
      REACTION_RESULTS,
    )
  }
  const Emojis = (p: { each: EmojiRecord[] }) => (
    <p>
      <Items
        items={p.each.map((e) => ({
          name: 'react',
          id: e.id ?? e.name,
          title: `:${e.name}:`,
          label: <Emoji emoji={e} />,
          run: () => messages.react(m(), e),
        }))}
      />
    </p>
  )
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
              document.querySelector<HTMLElement>('.message-menu')!.hidePopover()
              messages.react(m(), emojis()[0])
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
          messages.own(m()) && {
            name: 'menu-edit',
            icon: 'pencil',
            label: text('EDIT_MESSAGE'),
            run: () => {
              messages.startEdit(m())
              focus()
            },
          },
          can(Permission.SEND_MESSAGES) && {
            name: 'menu-reply',
            icon: 'reply',
            label: text('MESSAGE_ACTION_REPLY'),
            run: () => {
              messages.reply(m(), channel())
              focus()
            },
          },
          '-',
          {
            name: 'menu-copy',
            icon: 'copy',
            label: text('COPY_TEXT'),
            run: () => navigator.clipboard.writeText(m().content),
          },
          messages.canPin(m(), channel()) && {
            name: 'menu-pin',
            icon: 'pin',
            label: text(m().pinned ? 'UNPIN_MESSAGE' : 'PIN_MESSAGE'),
            run: () => messages.togglePin(m()),
          },
          {
            name: 'menu-unread',
            icon: 'unread',
            label: text('MARK_UNREAD'),
            run: () => {
              messages.markUnread(m())
              p.onMarkUnread()
            },
          },
          {
            name: 'menu-link',
            icon: 'link',
            label: text('COPY_MESSAGE_LINK'),
            run: () => navigator.clipboard.writeText(messages.link(m(), channel())),
          },
          messages.canDelete(m(), channel()) && '-',
          messages.canDelete(m(), channel()) && {
            name: 'menu-delete',
            icon: 'trash',
            class: 'danger',
            label: text('DELETE_MESSAGE'),
            confirm: text('CONFIRM_DELETE'),
            run: () => messages.remove(m()),
          },
        ]}
      />
    </Show>
  )
}
