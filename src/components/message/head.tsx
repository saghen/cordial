// What goes above a message's content: a reply's preview or a command's line (who used which), and the author line
// (avatar, name, time) that starts a group.

import { Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as messages from '../../api/messages'
import type { Id, Message, User } from '../../api/types'
import { ReferencedMessageState } from '../../api/types'
import { text, textAround } from '../../api/strings'
import * as users from '../../api/users'
import { Avatar } from '../avatar'
import { Markdown } from '../markdown'
import { Name } from '../name'
import { open as openProfile } from '../profile'
import { Time } from '../time'

// the avatar in the gutter, the name and the time beside it (and what a card adds: a search result's channel)
export function Head(p: { message: Message; guildId?: Id | null; children?: JSX.Element }) {
  // a click on the avatar or the name: their profile card
  const profile = (e: MouseEvent) =>
    openProfile(e.currentTarget as Element, p.message.author, messages.authorGuild(p.message, p.guildId))
  return (
    <>
      <Avatar user={p.message.author} guildId={p.guildId} size={40} decorated onClick={profile} />
      <header>
        <Name user={p.message.author} guildId={messages.authorGuild(p.message, p.guildId)} onClick={profile} />
        <Time at={p.message.timestamp} />
        {p.children}
      </header>
    </>
  )
}

// a jump's target flashed, as stock
export const flash = (row: Element) => row.animate([{ background: 'var(--mention-bg)' }, {}], { duration: 2000 })

// a click on a reply: the replied-to message flashed where it is when it's in view, else jumped to
function jump(e: MouseEvent, message: Message) {
  const list = (e.currentTarget as Element).closest('.messages')
  const row = list?.querySelector(`article[data-id="${message.messageReference!.message_id}"]`)
  if (list && row) {
    const rowRect = row.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) {
      flash(row)
      return
    }
  }
  messages.jumpToReplied(message)
}

// as stock: the replied-to message's author (with @ if the reply pings them) and its text on one line, the spine from
// the avatar's column to it; a click on them jumps to it
export function ReplyPreview(p: { message: Message; guildId?: Id | null }) {
  const replied = () => messages.replied(p.message)
  // both read the store, never the outer Show's value: a reference dropped from the store would make an inner read of
  // it stale, which halts Solid
  return (
    <Show when={replied()}>
      <q class="reply-to">
        <span onClick={(e) => jump(e, p.message)}>
          <Show
            when={replied()?.message}
            keyed
            fallback={text(
              replied()?.state === ReferencedMessageState.Deleted
                ? 'REPLY_QUOTE_MESSAGE_DELETED'
                : 'REPLY_QUOTE_MESSAGE_NOT_LOADED',
            )}
          >
            {(repliedMessage) => {
              const author = repliedMessage.author as User
              return (
                <>
                  <Avatar user={author} guildId={p.guildId} size={16} />
                  <Name
                    user={author}
                    guildId={messages.authorGuild(repliedMessage, p.guildId)}
                    at={p.message.mentions.includes(author.id)}
                  />
                  {repliedMessage.content ? (
                    <Markdown ast={messages.contentAST(repliedMessage, repliedMessage.channel_id)} inline />
                  ) : (
                    text('REPLY_QUOTE_NO_TEXT_CONTENT')
                  )}
                </>
              )
            }}
          </Show>
        </span>
      </q>
    </Show>
  )
}

// an app's reply to a command: who used it, as stock's line above the message
export function CommandLine(p: { message: Message; guildId?: Id | null }) {
  const command = p.message.interaction ?? p.message.interactionMetadata
  if (!command) return null
  const user = (command.user && users.get(command.user.id)) ?? command.user
  const slots = [<Name user={user} />, <span class="command-name">/{command.displayName ?? command.name}</span>]
  return (
    <q class="command">
      <span>
        <Show when={users.get(command.user?.id)}>
          {(stored) => <Avatar user={stored()} guildId={p.guildId} size={16} />}
        </Show>
        {textAround('APPLICATION_COMMAND_USED_SHORT', {}, ['userHook', 'commandHook']).map((part) =>
          typeof part === 'number' ? slots[part] : part,
        )}
      </span>
    </q>
  )
}
