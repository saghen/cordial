// The member list (api/members.ts): each group's name and count, then its members, offline ones dimmed; a server's
// rows not loaded yet keep their place. The header's toggle opens and closes it.

import { createEffect, createMemo, For, Show } from 'solid-js'

import * as members from '../api/members'
import { selected, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import { Avatar } from '../components/avatar'
import { Name } from '../components/name'
import { Toggle } from '../primitives/button'
import { Row } from '../primitives/row'

export function MembersList() {
  let list!: HTMLElement
  let frame = 0
  const subscribe = () =>
    (frame ||= requestAnimationFrame(() => {
      frame = 0
      members.subscribe(list.scrollTop, list.clientHeight)
    }))
  // a memo: the effect alone runs again on every store change, even with the same value
  const shown = createMemo(() => members.open() && `${selectedGuild()},${selected()}`)
  createEffect(shown, (on) => {
    if (on) subscribe()
  })
  return (
    <Show when={members.open()}>
      <section ref={list} class="members" onScroll={subscribe}>
        <For each={members.rows()}>
          {(r) =>
            !r ? (
              <div class="placeholder" />
            ) : r.type === 'GROUP' ? (
              <h3>{r.label}</h3>
            ) : (
              <Row
                name="member"
                class={{ offline: r.status === 'offline' }}
                data-id={r.user.id}
                icon={<Avatar user={r.user} guildId={selectedGuild()} size={32} status={r.status} />}
              >
                <Name user={r.user} guildId={selectedGuild()} />
              </Row>
            )
          }
        </For>
      </section>
    </Show>
  )
}

export const MembersToggle = () => (
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
