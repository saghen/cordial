// A message row: on a grid of the gutter (the avatar, the hover time, a reply's spine) and the message. Its parts in
// order: the date divider and the NEW line, a reply's preview or a command's line, the author line when it starts a
// group, the content, forwards, files, stickers, embeds, reactions, and Retry and Delete when it failed to send. The
// list works out which rows start groups, carry dividers or are collapsed (blocked and ignored runs).

import { For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as messages from '../../api/messages'
import { MessageType, type Channel, type Message as Record } from '../../api/types'
import { clock, text } from '../../api/strings'
import { Badge } from '../../primitives/badge'
import { Button } from '../../primitives/button'
import { Attachment, Sticker } from './attachment'
import { Content, Forward } from './content'
import { Embed } from './embed'
import { CommandLine, Head, ReplyPreview } from './head'
import { Reactions } from './reactions'

// the date divider (its label between two lines) and the first unread's red line with stock's NEW tag; on one row,
// the date sits on the red line
const Divider = (p: { day?: string; isNew: boolean }) => (
  <div class={['divider', { new: p.isNew }]}>
    <Show when={p.day}>
      <span>{p.day}</span>
    </Show>
    <Show when={p.isNew}>
      <Badge kind="new">{text('NEW')}</Badge>
    </Show>
  </div>
)

// sending, then failed: stock's Retry and Delete
const Failed = (p: { m: Record }) => (
  <p class="failed">
    {text('NOT_SENT')}
    <Button variant="link" class="retry" onClick={() => messages.resend(p.m)}>
      {text('RETRY')}
    </Button>
    <Button variant="link" class="discard" onClick={() => messages.remove(p.m, true)}>
      {text('DELETE')}
    </Button>
  </p>
)

export function Message(p: {
  m: Record
  channel?: Channel
  head: boolean
  day?: string
  isNew: boolean
  replying: boolean
  editing: boolean
  // a blocked or ignored run's first row carries its "N blocked messages" line; the run's rows are collapsed until
  // it's shown
  run?: JSX.Element
  collapsed: boolean
  gone: boolean
  onReact(e: MouseEvent): void
}) {
  const m = p.m
  const guildId = () => p.channel?.guild_id
  const channelId = m.channel_id
  const hasText = !messages.linkOnly(m) && (Boolean(m.content) || !messages.isUser(m))
  return (
    <article
      data-id={m.id}
      class={{
        sending: m.state === 'SENDING',
        failed: m.state === 'SEND_FAILED',
        head: p.head,
        system: !messages.isUser(m),
        call: m.type === MessageType.Call,
        missed: m.type === MessageType.Call && messages.missed(m),
        new: p.isNew,
        mention: m.mentioned,
        replying: p.replying,
        editing: p.editing,
        collapsed: p.collapsed,
        gone: p.gone,
      }}
      // the hover time in the gutter: none on an author line, a call's line or a message without text (an image alone)
      data-t={p.head || m.type === MessageType.Call || !hasText ? undefined : clock(m.timestamp)}
    >
      <Show when={p.day || p.isNew}>
        <Divider day={p.day} isNew={p.isNew} />
      </Show>
      {p.run}
      <Show when={!p.collapsed}>
        <ReplyPreview m={m} guildId={guildId()} />
        <CommandLine m={m} guildId={guildId()} />
        <Show when={p.head}>
          <Head m={m} guildId={guildId()} />
        </Show>
        <Show when={hasText}>
          <Content m={m} channelId={channelId} cache />
        </Show>
        <For each={m.messageSnapshots}>{(f) => <Forward m={f.message} channelId={channelId} />}</For>
        <For each={m.attachments}>{(f) => <Attachment file={f} />}</For>
        <For each={m.stickerItems}>{(s) => <Sticker sticker={s} />}</For>
        <For each={m.embeds}>{(e) => <Embed embed={e} />}</For>
        <Show when={m.reactions?.length}>
          <Reactions m={m} onAdd={p.onReact} />
        </Show>
        <Show when={m.state === 'SEND_FAILED'}>
          <Failed m={m} />
        </Show>
      </Show>
    </article>
  )
}
