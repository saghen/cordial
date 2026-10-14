// A message's content: a user message's markdown, a system message's text (stock's, as in notifications), a DM call's
// line; and a forward, the message as it was. Message records are immutable (an edit replaces the record), so the
// chat's content is built once per record and cached (its nodes: a card elsewhere builds its own).

import { For, Show } from 'solid-js'

import * as messages from '../../api/messages'
import { MessageType, type Id, type Message } from '../../api/types'
import { text, textAround } from '../../api/strings'
import * as users from '../../api/users'
import { renderAST } from '../markdown'
import { Time } from '../time'
import { Attachment } from './attachment'
import { Embed } from './embed'

let built = new WeakMap<Message, Node[]>()
const JUMBO_MAX = 30

// a cold measurement: every row parses its content again
export function resetContent() {
  built = new WeakMap()
}

// a DM call: stock's line with the caller's name as an author's, then the time. The call record's duration is a
// moment duration (stock's "a few seconds", "15 minutes")
function callLine(message: Message): Node[] {
  const duration = message.call?.duration?.humanize()
  const who = (<b class="name">{users.nameOf(message.author)}</b>) as HTMLElement
  const name = callText(messages.missed(message), Boolean(duration))
  return [
    ...textAround(name, { username: '', callDuration: duration }, ['usernameHook']).map((part) =>
      typeof part === 'string' ? document.createTextNode(part) : who,
    ),
    (<Time at={message.timestamp} />) as HTMLElement,
  ]
}

function callText(missed: boolean, timed: boolean) {
  if (missed) return timed ? 'SYSTEM_MESSAGE_CALL_MISSED_WITH_DURATION_HOOK' : 'SYSTEM_MESSAGE_CALL_MISSED_HOOK'
  return timed ? 'SYSTEM_MESSAGE_CALL_STARTED_WITH_DURATION_HOOK' : 'SYSTEM_MESSAGE_CALL_STARTED_HOOK'
}

function build(message: Message, channelId: Id): Node[] {
  if (message.type === MessageType.Call) return callLine(message)
  if (!messages.isUser(message)) return [document.createTextNode(messages.systemText(message))]
  const nodes = [...renderAST(messages.contentAST(message, channelId), document.createDocumentFragment()).childNodes]
  // as stock: emoji alone (up to JUMBO_MAX) show large
  const shown = nodes.filter((node) => node.nodeType !== Node.TEXT_NODE || node.textContent!.trim())
  if (shown.length <= JUMBO_MAX && shown.every((node) => node.nodeName === 'IMG'))
    for (const node of shown) (node as Element).classList.add('jumbo')
  return nodes
}

export function Content(p: { message: Message; channelId: Id; cache?: boolean }) {
  let nodes = p.cache ? built.get(p.message) : undefined
  if (!nodes) {
    nodes = build(p.message, p.channelId)
    if (p.cache) built.set(p.message, nodes)
  }
  return (
    <div class="content">
      {nodes}
      <Show when={p.message.editedTimestamp}>
        <span class="edited">({text('MESSAGE_EDITED')})</span>
      </Show>
    </div>
  )
}

// a forward: the message as it was, under stock's "Forwarded" line
export function Forward(p: { message: Message; channelId: Id }) {
  return (
    <blockquote class="forward">
      <span class="forwarded">{text('MESSAGE_FORWARDED')}</span>
      <div class="content" ref={(div) => renderAST(messages.contentAST(p.message, p.channelId), div)} />
      <For each={p.message.attachments}>{(file) => <Attachment file={file} />}</For>
      <For each={p.message.embeds}>{(embed) => <Embed embed={embed} />}</For>
    </blockquote>
  )
}
