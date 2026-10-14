// A message row: on a grid of the gutter (the avatar, the hover time, a reply's spine) and the message. Its parts in
// order: the date divider and the NEW line, a reply's preview or a command's line, the author line when it starts a
// group, the content, forwards, files, stickers, embeds, reactions, and Retry and Delete when it failed to send. The
// list works out which rows start groups, carry dividers or are collapsed (blocked and ignored runs).

import { For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as messages from '../../api/messages'
import { MessageType, type Channel, type Message as MessageRecord } from '../../api/types'
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
const Failed = (p: { message: MessageRecord }) => (
  <p class="failed">
    {text('NOT_SENT')}
    <Button variant="link" class="retry" onClick={() => messages.resend(p.message)}>
      {text('RETRY')}
    </Button>
    <Button variant="link" class="discard" onClick={() => messages.remove(p.message, true)}>
      {text('DELETE')}
    </Button>
  </p>
)

export function Message(p: {
  message: MessageRecord
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
  const message = p.message
  const guildId = () => p.channel?.guild_id
  const channelId = message.channel_id
  const hasText = !messages.linkOnly(message) && (Boolean(message.content) || !messages.isUser(message))
  return (
    <article
      data-id={message.id}
      class={{
        sending: message.state === 'SENDING',
        failed: message.state === 'SEND_FAILED',
        head: p.head,
        system: !messages.isUser(message),
        call: message.type === MessageType.Call,
        missed: message.type === MessageType.Call && messages.missed(message),
        new: p.isNew,
        mention: message.mentioned,
        replying: p.replying,
        editing: p.editing,
        collapsed: p.collapsed,
        gone: p.gone,
      }}
      // the hover time in the gutter: none on an author line, a call's line or a message without text (an image alone)
      data-t={p.head || message.type === MessageType.Call || !hasText ? undefined : clock(message.timestamp)}
    >
      <Show when={p.day || p.isNew}>
        <Divider day={p.day} isNew={p.isNew} />
      </Show>
      {p.run}
      <Show when={!p.collapsed}>
        <ReplyPreview message={message} guildId={guildId()} />
        <CommandLine message={message} guildId={guildId()} />
        <Show when={p.head}>
          <Head message={message} guildId={guildId()} />
        </Show>
        <Show when={hasText}>
          <Content message={message} channelId={channelId} cache />
        </Show>
        <For each={message.messageSnapshots}>
          {(snapshot) => <Forward message={snapshot.message} channelId={channelId} />}
        </For>
        <For each={message.attachments}>{(file) => <Attachment file={file} />}</For>
        <For each={message.stickerItems}>{(sticker) => <Sticker sticker={sticker} />}</For>
        <For each={message.embeds}>{(embed) => <Embed embed={embed} />}</For>
        <Show when={message.reactions?.length}>
          <Reactions message={message} onAdd={p.onReact} />
        </Show>
        <Show when={message.state === 'SEND_FAILED'}>
          <Failed message={message} />
        </Show>
      </Show>
    </article>
  )
}
