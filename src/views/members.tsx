// The member list, shown when stock's section state says MEMBERS: a server's (stock's ChannelMemberStore: groups by
// hoisted role, online, offline) or a group DM's (as stock's: its recipients and you by name, one "Members" group).
// Discord fills a server's list only for the ranges a client subscribes to: as stock's list, ours asks for the rows
// in view (stock's own range helper) when it opens and as it scrolls.

import { createEffect, createMemo, For, Show } from 'solid-js'

import { A, S } from '../adapter/needs'
import type { Id, Rec } from '../adapter/discord'
import { nameOf } from '../api/users'
import { $, selectedChannel } from '../api/store'
import { Toggle } from '../primitives/button'
import { Badge } from '../primitives/badge'

const ROW = 44
const GROUP_DM = 3

const listed = () => !!$.SelectedGuild.getGuildId() || selectedChannel()?.type === GROUP_DM
const membersOpen = () =>
  listed() && $.ChannelSection.getSection($.SelectedChannel.getChannelId()!, false) === 'MEMBERS'

// a group DM's rows, in the shape of ChannelMemberStore's
function groupRows(c: Rec) {
  const users = [...c.recipients, S.Auth.getId()]
    .map((id: Id) => $.User.getUser(id))
    .filter((u): u is Rec => !!u)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  return [
    { type: 'GROUP', label: `Members—${users.length}` },
    ...users.map((user) => ({ type: 'MEMBER', userId: user.id, user, status: $.Presence.getStatus(user.id) })),
  ]
}

export function MembersList() {
  let list!: HTMLElement
  const ids = () => [$.SelectedGuild.getGuildId(), $.SelectedChannel.getChannelId()] as [Id, Id]
  const props = () => $.ChannelMember.getProps(...ids())
  const rows = (): (Rec | undefined)[] => (ids()[0] ? props().rows : groupRows(selectedChannel()!))
  // a server's group rows carry no count: it's in groups
  const count = (id: string) => props().groups.find((g: Rec) => g.id === id)?.count
  let frame = 0
  const subscribe = () =>
    ids()[0] &&
    (frame ||= requestAnimationFrame(() => {
      frame = 0
      const [guildId, channelId] = ids()
      A.memberSubscriptions.range({ guildId, channelId, y: list.scrollTop, height: list.clientHeight, rowHeight: ROW })
    }))
  // a memo: the effect alone runs again on every store change, even with the same value
  const shown = createMemo(() => membersOpen() && ids().join())
  createEffect(shown, (on) => {
    if (on) subscribe()
  })

  return (
    <Show when={membersOpen()}>
      <section ref={list} class="members" onScroll={subscribe}>
        <For each={rows()}>
          {(r) =>
            r?.type === 'GROUP' ? (
              <h3>{r.label ?? `${r.title} — ${count(r.id)}`}</h3>
            ) : (
              <a
                class={r && 'member'}
                data-id={r?.userId}
                data-status={r?.status}
                style={
                  r && {
                    '--icon': `url(${r.user.getAvatarURL(r.guildId, 64)})`,
                    color: r.colorString ?? undefined,
                  }
                }
              >
                {r && nameOf(r.user, r.nick)}
                <Show when={r?.user.bot}>
                  <Badge kind="app">APP</Badge>
                </Show>
              </a>
            )
          }
        </For>
      </section>
    </Show>
  )
}

export const MembersToggle = () => (
  <Show when={listed()}>
    <Toggle
      class="members-toggle"
      on={membersOpen()}
      icon="members"
      title="Member list"
      onClick={() => A.channelSections.toggleMembersSection()}
    />
  </Show>
)
