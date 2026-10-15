// The member list (api/members.ts): each group's name and count, then its members, offline ones dimmed; a server's
// rows not loaded yet keep their place. The header's toggle opens and closes it. A right click on a member: stock's
// Profile, Mention, Message and Copy User ID.

import { createEffect, createMemo, For, Show } from 'solid-js'

import * as channels from '../api/channels'
import * as members from '../api/members'
import * as profiles from '../api/profiles'
import { selected, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import * as users from '../api/users'
import { Avatar } from '../components/avatar'
import { Name } from '../components/name'
import { open as openProfile, openDm } from '../components/profile'
import { StatusLine } from '../components/status_line'
import { Toggle } from '../primitives/button'
import { Icon } from '../primitives/icon'
import { contextMenu, Items } from '../primitives/menu'
import { Row } from '../primitives/row'
import { canInsert, insert } from './composer'

export function MembersList() {
  let list!: HTMLElement
  let frame = 0
  function subscribe() {
    frame ||= requestAnimationFrame(() => {
      frame = 0
      members.subscribe(list.scrollTop, list.clientHeight)
    })
  }
  // a memo: the effect alone runs again on every store change, even with the same value
  const shown = createMemo(() => members.open() && `${selectedGuild()},${selected()}`)
  const menu = memberMenu()
  createEffect(shown, (on) => {
    if (on) subscribe()
  })
  return (
    <Show when={members.open()}>
      <section ref={list} class="members" onScroll={subscribe} onContextMenu={menu.open}>
        <For each={members.rows()}>{(row) => <MemberRow row={row} />}</For>
      </section>
      {menu.view}
    </Show>
  )
}

function MemberRow(p: { row: members.Group | members.Member | undefined }) {
  const row = p.row
  if (!row) return <div class="placeholder" />
  if (row.type === 'GROUP') return <h3>{row.label}</h3>
  const user = row.user
  function subtitle() {
    const line = profiles.statusLine(user.id)
    return line && <StatusLine line={line} />
  }
  return (
    <Row
      name="member"
      class={{ offline: row.status === 'offline', plated: Boolean(users.nameplate(row.user)) }}
      style={users.nameplate(row.user)}
      data-id={row.user.id}
      onClick={(e: MouseEvent) => openProfile(e.currentTarget as Element, row.user, selectedGuild())}
      icon={
        <Avatar
          user={row.user}
          guildId={selectedGuild()}
          size={32}
          status={row.status}
          decorated
          onDblClick={() => openDm(row.user)}
        />
      }
      subtitle={subtitle()}
      end={
        members.isOwner(row.user.id) && (
          <Icon name="crown" title={text(selectedGuild() ? 'GUILD_OWNER' : 'GROUP_OWNER')} />
        )
      }
    >
      <Name user={row.user} guildId={selectedGuild()} />
    </Row>
  )
}

// stock's Message is left out for yourself, and Mention while the box can't take it
const memberMenu = () =>
  contextMenu({
    class: 'member-menu',
    find(e) {
      const row = (e.target as Element).closest<HTMLElement>('.member')
      const user = row && users.get(row.dataset.id!)
      return row && user && { row, user }
    },
    children: (target) => (
      <Items
        items={[
          {
            name: 'menu-profile',
            label: text('PROFILE'),
            run: () => openProfile(target().row, target().user, selectedGuild()),
          },
          canInsert() && {
            name: 'menu-mention',
            label: text('MENTION'),
            run: () => insert(`@${target().user.username} `),
          },
          target().user.id !== users.me()?.id && {
            name: 'menu-message',
            label: text('USER_POPOUT_MESSAGE'),
            run: () => void channels.openDm(target().user.id),
          },
          '-',
          {
            name: 'menu-copy-id',
            label: text('COPY_ID_USER'),
            run: () => navigator.clipboard.writeText(target().user.id),
          },
        ]}
      />
    ),
  })

export function MembersToggle() {
  return (
    <Show when={members.listed()}>
      <Toggle
        class="members-toggle"
        on={members.open()}
        icon="members"
        title={text('SHOW_MEMBER_LIST')}
        onTitle={text('HIDE_MEMBER_LIST')}
        onClick={members.toggle}
      />
    </Show>
  )
}
