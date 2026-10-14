// What goes above a message's content: a reply's preview or a command's line (who used which), and the author line
// (avatar, name, time) that starts a group.

import { Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as messages from '../../api/messages'
import type { Id, Message, User } from '../../api/types'
import { text, textAround } from '../../api/strings'
import * as users from '../../api/users'
import { Avatar } from '../avatar'
import { Markdown } from '../markdown'
import { Name } from '../name'
import { Time } from '../time'

// the avatar in the gutter, the name and the time beside it (and what a card adds: a search result's channel)
export const Head = (p: { m: Message; guildId?: Id | null; children?: JSX.Element }) => (
  <>
    <Avatar user={p.m.author} guildId={p.guildId} size={40} />
    <header>
      <Name user={p.m.author} guildId={messages.authorGuild(p.m, p.guildId)} />
      <Time at={p.m.timestamp} />
      {p.children}
    </header>
  </>
)

// a jump's target flashed, as stock
export const flash = (row: Element) => row.animate([{ background: 'var(--mention-bg)' }, {}], { duration: 2000 })

// a click on a reply: the replied-to message flashed where it is when it's in view, else jumped to
function jump(e: MouseEvent, m: Message) {
  const list = (e.currentTarget as Element).closest('.messages'),
    row = list?.querySelector(`article[data-id="${m.messageReference!.message_id}"]`)
  const r = row?.getBoundingClientRect(),
    v = list?.getBoundingClientRect()
  if (row && r!.top >= v!.top && r!.bottom <= v!.bottom) flash(row)
  else messages.jumpToReplied(m)
}

// as stock: the replied-to message's author (with @ if the reply pings them) and its text on one line, the spine from
// the avatar's column to it; a click on them jumps to it
export function ReplyPreview(p: { m: Message; guildId?: Id | null }) {
  const ref = () => messages.replied(p.m)
  return (
    <Show when={ref()}>
      {(r) => (
        <q class="reply-to">
          <span onClick={(e) => jump(e, p.m)}>
            <Show
              when={r().message}
              fallback={text(r().state === 2 ? 'REPLY_QUOTE_MESSAGE_DELETED' : 'REPLY_QUOTE_MESSAGE_NOT_LOADED')}
            >
              {(rm) => {
                const author = rm().author as User
                return (
                  <>
                    <Avatar user={author} guildId={p.guildId} size={16} />
                    <Name
                      user={author}
                      guildId={messages.authorGuild(rm(), p.guildId)}
                      at={p.m.mentions.includes(author.id)}
                    />
                    {rm().content ? (
                      <Markdown ast={messages.contentAST(rm(), rm().channel_id)} inline />
                    ) : (
                      text('REPLY_QUOTE_NO_TEXT_CONTENT')
                    )}
                  </>
                )
              }}
            </Show>
          </span>
        </q>
      )}
    </Show>
  )
}

// an app's reply to a command: who used it, as stock's line above the message
export function CommandLine(p: { m: Message; guildId?: Id | null }) {
  const command = p.m.interaction ?? p.m.interactionMetadata
  if (!command) return null
  const user = (command.user && users.get(command.user.id)) ?? command.user
  return (
    <q class="command">
      <span>
        <Show when={users.get(command.user?.id)}>{(u) => <Avatar user={u()} guildId={p.guildId} size={16} />}</Show>
        {textAround('APPLICATION_COMMAND_USED_SHORT', {}, ['userHook', 'commandHook']).map((part) =>
          part === 0 ? (
            <Name user={user} />
          ) : part === 1 ? (
            <span class="command-name">/{command.displayName ?? command.name}</span>
          ) : (
            part
          ),
        )}
      </span>
    </q>
  )
}
