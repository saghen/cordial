// The member list (api/members.ts): each group's name and count, then its members, offline ones dimmed; a server's
// rows not loaded yet keep their place. The header's toggle opens and closes it. A right click on a member: stock's
// Profile, Mention, Message and Copy User ID; a double right click on their avatar, their DM (ours).

import { createEffect, createMemo, For, Show, untrack } from 'solid-js'

import * as channels from '../api/channels'
import * as members from '../api/members'
import { selected, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import * as users from '../api/users'
import { Avatar, avatarDoubleRight } from '../components/avatar'
import { Name } from '../components/name'
import { open as openProfile } from '../components/profile'
import { useStatusLine } from '../components/status_line'
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
  menu.onDoubleRight(
    (target) => target.closest('.member > .avatar')?.closest<HTMLElement>('.member')?.dataset.id,
    (id) => {
      const user = users.get(id)
      if (user) avatarDoubleRight(user)
    },
  )
  createEffect(shown, (on) => {
    if (on) subscribe()
  })
  return (
    <Show when={members.open()}>
      <section ref={list} class="members" onScroll={subscribe} onContextMenu={menu.open}>
        <For each={members.rows()} keyed={members.key}>
          {(row) => {
            // its key keeps its kind; the record changes (a status, a name, a count)
            const type = untrack(() => row().type)
            if (type === 'GROUP') return <h3>{(row() as members.Group).label}</h3>
            if (type === 'MEMBER') return <MemberRow member={row() as members.Member} />
            return <div class="placeholder" />
          }}
        </For>
      </section>
      {menu.view}
    </Show>
  )
}

function MemberRow(p: { member: members.Member }) {
  const member = () => p.member
  const plate = () => users.nameplate(member().user)
  const status = useStatusLine(() => member().user.id)
  return (
    <Row
      name="member"
      class={{ offline: member().status === 'offline', plated: Boolean(plate()) }}
      style={plate()}
      data-id={member().user.id}
      onClick={(e: MouseEvent) => openProfile(e.currentTarget as Element, member().user, selectedGuild())}
      icon={<Avatar user={member().user} guildId={selectedGuild()} size={32} status={member().status} decorated />}
      subtitle={status()}
      end={
        members.isOwner(member().user.id) && (
          <Icon name="crown" title={text(selectedGuild() ? 'GUILD_OWNER' : 'GROUP_OWNER')} />
        )
      }
    >
      <Name user={member().user} guildId={selectedGuild()} />
    </Row>
  )
}

// stock's Message is left out for yourself, and Mention while the box can't take it
const memberMenu = () =>
  contextMenu({
    class: 'member-menu',
    find(e) {
      const row = (e.target as Element).closest<HTMLElement>('.member')
      const id = row?.dataset.id
      const user = id ? users.get(id) : undefined
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
