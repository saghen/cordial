// The selected channel's messages. One element per message (with its author line, the name and its time): the avatar
// is the row's ::before. Message records are immutable (an edit replaces the record), so a row's
// content is built once per record and cached; only whether it starts a group can change.

import { createEffect, createMemo, createSignal, For, Show, untrack } from 'solid-js'

import { A, S } from '../adapter/core'
import type { Id } from '../adapter/discord'
import { embed, fit, img } from './embeds'
import { renderAST } from './lib/content'
import {
  type Attachment,
  authorOf,
  can as allowed,
  clock,
  contentAST,
  dayOf,
  emojiSrc,
  type Message,
  nameOf,
  PERMS,
  type Reaction,
  startsGroup,
  USER_MESSAGE,
  hiddenAs,
  when,
} from './lib/model'
import { contextMenu, Items } from './lib/menu'
import { createScroller } from './lib/scroller'
import { $, selected, selectedChannel } from './lib/store'

let built = new WeakMap<Message, globalThis.Node[]>()

// ai/lab/budgets.py --cold: every row parses its content again
export function resetContent() {
  built = new WeakMap()
}

// a DM call: stock's own component writes it (its strings, outside the formatter), here in its English: the caller's
// name as an author's, the text, the time. The call record's duration is a moment duration (stock's "a few seconds",
// "15 minutes")
const CALL = 3
const missed = (m: Message) => !((m as any).call?.participants ?? []).includes(S.Auth.getId())
const callMessage = (m: Message): globalThis.Node[] => {
  const duration = (m as any).call?.duration,
    who = (
      <b class="author" data-id={m.author.id}>
        {nameOf(m.author)}
      </b>
    ) as HTMLElement,
    lasted = duration ? ` that lasted ${duration.humanize()}` : ''
  const text = missed(m) ? ['You missed a call from ', who, `${lasted}.`] : [who, ` started a call${lasted}.`]
  return [
    ...text.map((n) => (typeof n === 'string' ? document.createTextNode(n) : n)),
    (<time class="ts">{when(m.timestamp)}</time>) as HTMLElement,
  ]
}

function content(m: Message, channelId: Id) {
  let nodes = built.get(m)
  if (!nodes) {
    // a system message is stock's text for it (its formatter, as in notifications); a call's is above
    const f = USER_MESSAGE.has(m.type)
      ? renderAST(contentAST(m, channelId), document.createDocumentFragment())
      : m.type === CALL
        ? callMessage(m)
        : document.createTextNode(A.systemMessages.stringify(m) ?? (m.content || `(message type ${m.type})`))
    built.set(m, (nodes = f instanceof DocumentFragment ? [...f.childNodes] : Array.isArray(f) ? f : [f]))
    // as stock: emoji alone (up to 30) show large
    const shown = nodes.filter((n) => n.nodeType !== 3 || n.textContent!.trim())
    if (shown.length <= 30 && shown.every((n) => n.nodeName === 'IMG'))
      for (const n of shown) (n as Element).classList.add('jumbo')
  }
  return nodes
}

// images and videos inline (images in the larger box), anything else a link
const attachment = (a: Attachment) => {
  const type = a.content_type?.split('/')[0],
    m = { url: a.url, proxyURL: a.proxy_url, width: a.width!, height: a.height! }
  if (type === 'image' && a.width) return img(m, 'sent')
  if (type === 'video')
    return <video class="media" controls preload="metadata" {...(a.width ? fit(m, 400, 300) : {})} src={a.url} />
  return (
    <a class="file" href={a.url} target="_blank" rel="noreferrer noopener" data-size={size(a.size)}>
      {a.filename}
    </a>
  )
}
// a sticker as its image from Discord's CDN, at stock's 160 px (an APNG animates with passthrough); a Lottie one, an
// animated vector, as its name
const sticker = (s: { id: string; name: string; format_type: number }) =>
  s.format_type === 3 ? (
    <i class="sticker">{s.name}</i>
  ) : (
    <img
      class="sticker"
      alt={s.name}
      title={s.name}
      width={160}
      height={160}
      src={`https://media.discordapp.net/stickers/${s.id}.${s.format_type === 4 ? 'gif' : 'png'}?size=160${s.format_type === 2 ? '&passthrough=true' : ''}`}
    />
  )
const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

// a chip per emoji: the emoji, the count, mine highlighted; a click adds or removes mine. Hovered, its title names up
// to three who reacted, as stock's tooltip (the store fetches them on the first read)
const react = (m: Message) => (r: Reaction) => {
  const [hovered, setHovered] = createSignal(false)
  const title = () => {
    if (!hovered()) return undefined
    const users = [...$.MessageReactions.getReactions(m.channel_id, m.id, r.emoji, 3, 0).values()]
    const more = r.count - users.length
    return users.map((u) => nameOf(u)).join(', ') + (more > 0 ? ` and ${more} more` : '')
  }
  return (
    <button
      class={['reaction', { me: r.me }]}
      data-id={r.emoji.id ?? r.emoji.name}
      title={title()}
      onPointerEnter={() => setHovered(true)}
      onClick={() =>
        r.me
          ? A.reactions.remove({
              channelId: m.channel_id,
              messageId: m.id,
              emoji: r.emoji,
              location: 'Message Inline Button',
            })
          : A.reactions.add(m.channel_id, m.id, r.emoji, 'Message Inline Button')
      }
    >
      <img alt={r.emoji.name} src={emojiSrc(r.emoji)} />
      {r.count}
    </button>
  )
}

// stock's Resend (its menu's chunk, not loaded without it): the failed copy goes, the same message is sent again with
// its nonce. Stock adds the options SendMessageOptionsStore kept for it, also not loaded: a reply's mention setting
function resend(channelId: Id, m: Message) {
  A.messages.deleteMessage(channelId, m.id, true)
  A.messages.sendMessage(
    channelId,
    { content: m.content, tts: m.tts, invalidEmojis: [], validNonShortcutEmojis: [] },
    undefined,
    { nonce: m.nonce, flags: m.flags, messageReference: m.messageReference ?? undefined, location: 'explicit_retry' },
  )
}

export function Chat(p: { root: HTMLElement }) {
  const channelId = selected
  const channel = createMemo(selectedChannel)
  // a new ChannelMessages object on every change to the channel's messages
  const messages = createMemo(() => (channelId() ? $.Message.getMessages(channelId()!) : null))
  const list = createMemo(() => (messages()?.toArray() ?? []) as Message[])
  const unread = createMemo(() => channelId() && $.ReadState.getOldestUnreadMessageId(channelId()!))
  const replying = createMemo(() => channelId() && $.PendingReply.getPendingReply(channelId()!)?.message.id)

  // the runs of blocked or ignored messages shown, by their first message
  const [shown, setShown] = createSignal<Record<Id, boolean>>({})

  const Row = (m: Message, i: () => number) => {
    // as stock, a run of blocked (or ignored) messages is one line, "N blocked messages", until Show messages
    const hid = hiddenAs(m)
    const run = createMemo(() => {
      if (!hid) return
      let j = i()
      while (j > 0 && hiddenAs(list()[j - 1]) === hid) j--
      return list()[j].id
    })
    const count = createMemo(() => {
      let n = 0
      if (run() === m.id) while (hiddenAs(list()[i() + n]) === hid) n++
      return n
    })
    const collapsed = () => !!hid && !shown()[run()!]
    // a system message is a line of its own, without an author line (stock: an icon, the text, the time)
    const head = createMemo(
      () => !collapsed() && USER_MESSAGE.has(m.type) && startsGroup(channel(), list()[i() - 1], m),
    )
    const author = createMemo(() => (head() ? authorOf(m, channel()?.guild_id) : null))
    // a new day always starts a group, so the author line carries the divider
    const day = createMemo(() => dayOf(list()[i() - 1], m))
    // a reply's message, once loaded (ReferencedMessageStore)
    const ref = createMemo(() => (m.type === 19 ? $.ReferencedMessage.getMessageByReference(m.messageReference) : null))
    // an app's reply to a command: who used it, as stock's line above the message
    const command = m.interaction ?? m.interactionMetadata
    // as stock: a message that's only the link of its image or GIF shows just the media
    const linkOnly =
      m.embeds?.length &&
      m.embeds.every((e: any) => (e.type === 'image' || e.type === 'gifv') && e.url === m.content.trim())
    const nodes = linkOnly ? [] : content(m, untrack(channelId)!)
    return (
      <article
        data-id={m.id}
        class={{
          sending: m.state === 'SENDING',
          failed: m.state === 'SEND_FAILED',
          head: head(),
          system: !USER_MESSAGE.has(m.type),
          call: m.type === CALL,
          missed: m.type === CALL && missed(m),
          new: unread() === m.id,
          edited: !!m.editedTimestamp,
          day: !!day(),
          reply: !!ref() || !!command,
          mention: m.mentioned,
          replying: replying() === m.id,
          collapsed: collapsed(),
          gone: collapsed() && !count(),
        }}
        style={author() ? { '--av': `url(${author()!.avatar})` } : undefined}
        data-t={head() || m.type === CALL ? undefined : clock(m.timestamp)}
      >
        <Show when={count()}>
          {(n) => (
            <button class={`${hid}-show`} onClick={() => setShown((s) => ({ ...s, [m.id]: !s[m.id] }))}>
              {n()} {hid} message{n() > 1 ? 's' : ''} — {collapsed() ? 'Show' : 'Collapse'} message{n() > 1 ? 's' : ''}
            </button>
          )}
        </Show>
        <Show when={!collapsed()}>
          <Show when={ref()}>
            {(r) => (
              <q
                class="reply-to"
                // as stock: a jump (a fetch around it when it isn't loaded), the list scrolls to it below
                onClick={() =>
                  A.messages.jumpToMessage({
                    channelId: m.messageReference.channel_id,
                    messageId: m.messageReference.message_id,
                    flash: true,
                    returnMessageId: m.id,
                  })
                }
              >
                <Show when={r().message} fallback="Original message was deleted or isn't loaded">
                  {(rm) => {
                    // as stock: its author's avatar and name (with @ if the reply pings them), then its text
                    const a = authorOf(rm() as Message, channel()?.guild_id)
                    return (
                      <>
                        <img src={a.avatar} />
                        <b style={{ color: a.color ?? undefined }}>
                          {m.mentions?.includes(a.id) ? '@' : ''}
                          {a.name}
                        </b>
                        {rm().content ? (
                          <span ref={(s) => renderAST(contentAST(rm() as Message, rm().channel_id), s)} />
                        ) : (
                          'Click to see attachment'
                        )}
                      </>
                    )
                  }}
                </Show>
              </q>
            )}
          </Show>
          <Show when={command}>
            {(i) => {
              const user = i().user && $.User.getUser(i().user.id)
              return (
                <q class="command">
                  <img src={user?.getAvatarURL(channel()?.guild_id, 32)} />
                  <b>{nameOf(user ?? i().user)}</b> used <span>/{i().displayName ?? i().name}</span>
                </q>
              )
            }}
          </Show>
          <Show when={author()}>
            {(a) => (
              <>
                <b class="author" data-id={a().id} data-day={day()} style={{ color: a().color ?? undefined }}>
                  {a().name}
                  <Show when={a().bot}>
                    <i>APP</i>
                  </Show>
                </b>
                <time class="ts">{when(m.timestamp)}</time>
                {'\n'}
              </>
            )}
          </Show>
          {nodes}
          {m.messageSnapshots?.map((f: { message: Message }) => (
            // a forward: the message as it was, under stock's "Forwarded" line
            <blockquote class="forward">
              <span ref={(s) => renderAST(contentAST(f.message, m.channel_id), s)} />
              {f.message.attachments?.map(attachment)}
              {f.message.embeds?.map(embed)}
            </blockquote>
          ))}
          {m.attachments?.map(attachment)}
          {m.stickerItems?.map(sticker)}
          {m.embeds?.map(embed)}
          <Show when={m.reactions?.length}>
            <p class="reactions">
              {m.reactions.map(react(m))}
              <button
                class="reaction-add"
                title="Add Reaction"
                onClick={(e) =>
                  e.currentTarget.dispatchEvent(
                    new MouseEvent('contextmenu', { bubbles: true, clientX: e.clientX, clientY: e.clientY }),
                  )
                }
              />
            </p>
          </Show>
          <Show when={m.state === 'SEND_FAILED'}>
            <p class="failed">
              Not sent.
              <button class="retry" onClick={() => resend(m.channel_id, m)}>
                Retry
              </button>
              <button class="discard" onClick={() => A.messages.deleteMessage(m.channel_id, m.id, true)}>
                Delete
              </button>
            </p>
          </Show>
        </Show>
      </article>
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
    if (messages()?.hasMoreAfter) {
      jumping = true
      A.messages.jumpToPresent(channelId()!, 50)
    } else view.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // a jump (a reply, the new messages bar, a link to a message): its target in view once rendered, flashed. Each
  // channel's last jump seen is kept, so coming back to a channel doesn't jump again
  const jumps = new Map<Id, number>()
  function jumped(id: Id) {
    const ms = messages()!,
      seen = jumps.get(id)
    jumps.set(id, ms.jumpSequenceId)
    if (seen === undefined || seen === ms.jumpSequenceId || !ms.jumpTargetId) return
    // after the scroller's frame, which takes a switched channel to the bottom
    requestAnimationFrame(() => {
      const row = view.querySelector<HTMLElement>(`[data-id="${ms.jumpTargetId}"]`)
      if (!row) return
      // an offset (stock's jump to unread, from the last read message): the messages after it from the top
      row.scrollIntoView({ block: ms.jumpTargetOffset ? 'start' : 'center' })
      if (ms.jumpFlash) row.animate([{ background: 'var(--mention-bg)' }, {}], { duration: 2000 })
    })
  }

  // after the rows are in the DOM: the scroller, and the lab's marker that this channel is shown
  const rendered = createScroller(view, channelId)
  createEffect(
    () => [channelId(), list(), messages()?.ready] as const,
    ([id, , ready], prev) => {
      rendered(id !== prev?.[0])
      if (id && ready) jumped(id)
      if (jumping && !messages()?.hasMoreAfter) {
        jumping = false
        view.scrollTop = 0
      }
      if (id && ready) p.root.dataset.view = `channel:${id}`
      else delete p.root.dataset.view
    },
  )
  return (
    <>
      {view}
      <NewMessages channelId={channelId} />
      <Show when={up() || messages()?.hasMoreAfter}>
        <button class="jump" title="Jump to Present" onClick={present} />
      </Show>
      <MessageMenu list={view} channelId={channelId} />
      <Viewer list={view} />
    </>
  )
}

// stock's new messages bar, while the channel has unreads: "N new messages since 10:59 PM", a click jumps to the oldest
// unread, Mark As Read acks the channel
function NewMessages(p: { channelId: () => Id | null }) {
  const bar = createMemo(() => {
    const id = p.channelId()
    const n = id ? $.ReadState.getUnreadCount(id) : 0,
      since = id ? $.ReadState.getOldestUnreadTimestamp(id) : 0
    if (!n || !since) return null
    const t = new Date(since),
      today = t.toDateString() === new Date().toDateString()
    return `${n}${$.ReadState.isEstimated(id!) ? '+' : ''} new message${n === 1 ? '' : 's'} since ${clock(t)}${today ? '' : ` on ${t.toLocaleDateString()}`}`
  })
  return (
    <Show when={bar()}>
      {(text) => (
        <div class="new-messages">
          <button
            class="new-messages-jump"
            onClick={() => {
              const id = p.channelId()!
              A.messages.jumpToMessage({
                channelId: id,
                messageId: S.ReadState.ackMessageId(id) ?? id,
                offset: 1,
                context: 'Mark As Read',
              })
            }}
          >
            {text()}
          </button>
          <button
            class="new-messages-read"
            onClick={() =>
              A.acks.ack(p.channelId()!, {
                section: 'New Messages Banner',
                object: 'Mark Channel as Read Button',
                objectType: 'ack_manual',
              })
            }
          >
            Mark As Read
          </button>
        </div>
      )}
    </Show>
  )
}

// stock's media viewer, roughly: an image large over a dimmed window, with a link to the original. Escape or a click
// outside the image closes it
function Viewer(p: { list: HTMLElement }) {
  const [shown, setShown] = createSignal<{ src: string; url: string }>()
  let dialog!: HTMLDialogElement
  p.list.addEventListener('click', (e) => {
    const i = e.target as HTMLElement
    if (!i.matches('img[data-full]')) return
    setShown({ src: i.dataset.full!, url: i.dataset.url! })
    dialog.showModal()
  })
  return (
    <dialog ref={dialog} class="viewer" onClick={(e) => e.target === dialog && dialog.close()}>
      <Show when={shown()}>
        {(s) => (
          <>
            <img alt="" src={s().src} />
            <a href={s().url} target="_blank" rel="noreferrer noopener">
              Open in Browser
            </a>
          </>
        )}
      </Show>
    </dialog>
  )
}

// stock's Mark Unread: a manual ack of the message before this one (or of the millisecond before it), with the
// mentions after it as the count
function markUnread(channelId: Id, messageId: Id) {
  const me = S.User.getCurrentUser()!,
    all = S.Message.getMessages(channelId).toArray() as Message[]
  const before =
    all.filter((m) => BigInt(m.id) < BigInt(messageId)).at(-1)?.id ?? String(((BigInt(messageId) >> 22n) - 1n) << 22n)
  const mentions = all.filter((m) => BigInt(m.id) > BigInt(before) && A.readStates.countsAsMention(m, me)).length
  A.rest.post({
    url: A.endpoints.MESSAGE_ACK(channelId, before),
    body: { manual: true, mention_count: mentions },
    oldFormErrors: true,
    rejectWithError: true,
  })
}

// the message menu (right click on a message)
function MessageMenu(p: { list: HTMLElement; channelId: () => Id | null }) {
  // deleting takes a second click
  const [sure, setSure] = createSignal(false)
  // the four most used reactions on top, as stock; React swaps the items for an emoji search: the most used, then
  // what the query matches
  const [query, setQuery] = createSignal<string | null>(null)
  const menu = contextMenu((e) => {
    const id = (e.target as Element).closest('article')?.dataset.id,
      channelId = p.channelId()
    const m = id && channelId ? (S.Message.getMessage(channelId, id) as Message | undefined) : undefined
    if (!m) return
    setSure(false)
    // the add-reaction chip opens the emoji search
    setQuery((e.target as Element).closest('.reaction-add') ? '' : null)
    return m
  })
  p.list.addEventListener('contextmenu', menu.open)

  const target = () => menu.target()!
  const channel = () => S.Channel.getChannel(target().channel_id)!
  const own = () => target().author.id === S.User.getCurrentUser()?.id
  const can = (permission: bigint) => allowed(permission, channel())
  const recent = () => S.Emoji.emojiReactionFrecencyWithoutFetchingLatest.frequently
  const emojis = () =>
    (query()
      ? S.Emoji.searchWithoutFetchingLatest({ channel: channel(), query: query()!, count: 24, intention: 0 }).unlocked
      : recent()
    ).slice(0, 24)
  const react = (e: Record<string, any>) =>
    A.reactions.add(
      channel().id,
      target().id,
      e.id ? { id: e.id, name: e.name, animated: e.animated } : { id: null, name: e.surrogates },
      'Message Context Menu',
    )
  const Emojis = (p: { each: Record<string, any>[] }) => (
    <p>
      <Items
        items={p.each.map((e) => ({
          name: 'react',
          id: e.id ?? e.name,
          title: `:${e.name}:`,
          label: <img alt={e.name} src={emojiSrc(e)} />,
          run: () => react(e),
        }))}
      />
    </p>
  )
  const box = () => document.querySelector<HTMLTextAreaElement>('#mc-composer')?.focus()
  const pinnable = () =>
    (target().type === 0 || target().type === 19) && can(PERMS.PIN_MESSAGES) && can(PERMS.READ_MESSAGE_HISTORY)
  const pin = () => {
    const url = A.endpoints.PIN(channel().id, target().id)
    if (target().pinned) A.rest.del({ url, oldFormErrors: true, rejectWithError: true })
    else A.rest.put({ url, rejectWithError: true })
  }
  const link = () => `https://discord.com/channels/${channel().guild_id ?? '@me'}/${channel().id}/${target().id}`
  const deletable = () => own() || can(PERMS.MANAGE_MESSAGES)

  return (
    <menu ref={menu.ref} class="message-menu" popover onToggle={(e) => e.newState === 'closed' && setQuery(null)}>
      <Show when={menu.target() && query() != null}>
        <input
          class="react-search"
          placeholder="Find an emoji"
          ref={(i) => queueMicrotask(() => i.focus())}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !emojis()[0]) return
            e.currentTarget.closest('menu')!.hidePopover()
            react(emojis()[0])
          }}
        />
        <Emojis each={emojis()} />
      </Show>
      <Show when={menu.target() && query() == null}>
        <Show when={can(PERMS.ADD_REACTIONS)}>
          <Emojis each={recent().slice(0, 4)} />
        </Show>
        <Items
          items={[
            can(PERMS.ADD_REACTIONS) && {
              name: 'menu-react',
              label: 'Add Reaction',
              keep: true,
              run: () => setQuery(''),
            },
            can(PERMS.ADD_REACTIONS) && '-',
            own() && {
              name: 'menu-edit',
              label: 'Edit Message',
              run: () => (A.messages.startEditMessageRecord(channel().id, target()), box()),
            },
            can(PERMS.SEND_MESSAGES) && {
              name: 'menu-reply',
              label: 'Reply',
              run: () => {
                A.replies.create({
                  message: target(),
                  channel: channel(),
                  shouldMention: !own(),
                  showMentionToggle: !own(),
                })
                box()
              },
            },
            '-',
            { name: 'menu-copy', label: 'Copy Text', run: () => navigator.clipboard.writeText(target().content) },
            pinnable() && { name: 'menu-pin', label: target().pinned ? 'Unpin Message' : 'Pin Message', run: pin },
            { name: 'menu-unread', label: 'Mark Unread', run: () => markUnread(channel().id, target().id) },
            { name: 'menu-link', label: 'Copy Message Link', run: () => navigator.clipboard.writeText(link()) },
            deletable() && '-',
            deletable() && {
              name: 'menu-delete',
              class: 'danger',
              label: sure() ? 'Click again to delete' : 'Delete Message',
              keep: !sure(),
              run: () => (sure() ? A.messages.deleteMessage(channel().id, target().id) : setSure(true)),
            },
          ]}
        />
      </Show>
    </menu>
  )
}
