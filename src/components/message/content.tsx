// A message's content: a user message's markdown, a system message's text (stock's, as in notifications), a DM call's
// line; and a forward, the message as it was. Message records are immutable (an edit replaces the record), so the
// chat's content is built once per record and cached (its nodes: a card elsewhere builds its own).

import { For, Show } from 'solid-js'

import * as messages from '../../api/messages'
import { MessageType, type Id, type Message } from '../../api/records'
import { text, textAround } from '../../api/strings'
import * as users from '../../api/users'
import { renderAST } from '../markdown'
import { Time } from '../time'
import { Attachment } from './attachment'
import { Embed } from './embed'

let built = new WeakMap<Message, Node[]>()

// ai/lab/budgets.py --cold: every row parses its content again
export function resetContent() {
  built = new WeakMap()
}

// a DM call: stock's line with the caller's name as an author's, then the time. The call record's duration is a
// moment duration (stock's "a few seconds", "15 minutes")
function callLine(m: Message): Node[] {
  const duration = m.call?.duration?.humanize(),
    who = (<b class="name">{users.nameOf(m.author)}</b>) as HTMLElement
  const name = messages.missed(m)
    ? duration
      ? 'SYSTEM_MESSAGE_CALL_MISSED_WITH_DURATION_HOOK'
      : 'SYSTEM_MESSAGE_CALL_MISSED_HOOK'
    : duration
      ? 'SYSTEM_MESSAGE_CALL_STARTED_WITH_DURATION_HOOK'
      : 'SYSTEM_MESSAGE_CALL_STARTED_HOOK'
  return [
    ...textAround(name, { username: '', callDuration: duration }, ['usernameHook']).map((n) =>
      typeof n === 'string' ? document.createTextNode(n) : who,
    ),
    (<Time at={m.timestamp} />) as HTMLElement,
  ]
}

function build(m: Message, channelId: Id): Node[] {
  if (m.type === MessageType.Call) return callLine(m)
  if (!messages.isUser(m)) return [document.createTextNode(messages.systemText(m))]
  const nodes = [...renderAST(messages.contentAST(m, channelId), document.createDocumentFragment()).childNodes]
  // as stock: emoji alone (up to 30) show large
  const shown = nodes.filter((n) => n.nodeType !== 3 || n.textContent!.trim())
  if (shown.length <= 30 && shown.every((n) => n.nodeName === 'IMG'))
    for (const n of shown) (n as Element).classList.add('jumbo')
  return nodes
}

export function Content(p: { m: Message; channelId: Id; cache?: boolean }) {
  let nodes = p.cache ? built.get(p.m) : undefined
  if (!nodes) {
    nodes = build(p.m, p.channelId)
    if (p.cache) built.set(p.m, nodes)
  }
  return (
    <div class="content">
      {nodes}
      <Show when={p.m.editedTimestamp}>
        <span class="edited">({text('MESSAGE_EDITED')})</span>
      </Show>
    </div>
  )
}

// a forward: the message as it was, under stock's "Forwarded" line
export const Forward = (p: { m: Message; channelId: Id }) => (
  <blockquote class="forward">
    <span class="forwarded">{text('MESSAGE_FORWARDED')}</span>
    <div class="content" ref={(d) => renderAST(messages.contentAST(p.m, p.channelId), d)} />
    <For each={p.m.attachments}>{(f) => <Attachment file={f} />}</For>
    <For each={p.m.embeds}>{(e) => <Embed embed={e} />}</For>
  </blockquote>
)
