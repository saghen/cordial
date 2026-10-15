// The member list (api/members.ts): each group's name and count, then its members, offline ones dimmed; a server's
// rows not loaded yet keep their place. The header's toggle opens and closes it.

import { createEffect, createMemo, For, Show } from 'solid-js'

import * as members from '../api/members'
import { selected, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import { Avatar } from '../components/avatar'
import { Name } from '../components/name'
import { open as openProfile } from '../components/profile'
import { Toggle } from '../primitives/button'
import { Row } from '../primitives/row'

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
  createEffect(shown, (on) => {
    if (on) subscribe()
  })
  return (
    <Show when={members.open()}>
      <section ref={list} class="members" onScroll={subscribe}>
        <For each={members.rows()}>{(row) => <MemberRow row={row} />}</For>
      </section>
    </Show>
  )
}

function MemberRow(p: { row: members.Group | members.Member | undefined }) {
  const row = p.row
  if (!row) return <div class="placeholder" />
  if (row.type === 'GROUP') return <h3>{row.label}</h3>
  return (
    <Row
      name="member"
      class={{ offline: row.status === 'offline' }}
      data-id={row.user.id}
      onClick={(e: MouseEvent) => openProfile(e.currentTarget as Element, row.user, selectedGuild())}
      icon={<Avatar user={row.user} guildId={selectedGuild()} size={32} status={row.status} decorated />}
    >
      <Name user={row.user} guildId={selectedGuild()} />
    </Row>
  )
}

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
