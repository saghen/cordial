// The channel list: a server's channels, categories and voice channels (with who's in them), or the DMs. Each is a Row;
// a right click on a channel or a category opens stock's channel menu.

import { For, Show } from 'solid-js'

import * as channels from '../api/channels'
import { useNow } from '../api/hooks'
import { onHover } from '../api/preload'
import { ChannelType, type Channel, type PrivateChannel, type VoiceState } from '../api/types'
import { selected, selectedGuild } from '../api/store'
import { text } from '../api/strings'
import * as users from '../api/users'
import * as voice from '../api/voice'
import { Avatar } from '../components/avatar'
import { ChannelIcon } from '../components/channel_icon'
import { DmIcon } from '../components/dm_icon'
import { Badge } from '../primitives/badge'
import { Icon } from '../primitives/icon'
import { contextMenu, Items } from '../primitives/menu'
import { Row } from '../primitives/row'

// a channel's mention count at its row's end (a DM row has none: the server bar counts it)
const count = (mentions: number) => mentions > 0 && <Badge kind="count">{mentions}</Badge>

function Dm(p: { channel: PrivateChannel }) {
  const channel = () => p.channel
  return (
    <Row
      name="dm"
      data-id={channel().id}
      title={channels.dmName(channel())}
      class={{ selected: selected() === channel().id, unread: channels.unread(channel()) }}
      icon={<DmIcon channel={channel()} size={32} status />}
      subtitle={channels.dmSubtitle(channel())}
      onClick={() => channels.open(channel())}
      {...onHover(() => channel().id)}
    >
      {channels.dmName(channel())}
    </Row>
  )
}

function TextChannel(p: { channel: Channel }) {
  const channel = () => p.channel
  const muted = () => channels.muted(channel())
  return (
    <Row
      name="channel"
      data-id={channel().id}
      class={{ selected: selected() === channel().id, unread: channels.unread(channel()) && !muted(), muted: muted() }}
      icon={<ChannelIcon channel={channel()} />}
      end={count(channels.mentions(channel()))}
      onClick={() => channels.open(channel())}
      {...onHover(() => channel().id)}
    >
      {channel().name}
    </Row>
  )
}

// a category: its name and a chevron; a click collapses or expands it
const Category = (p: { channel: Channel }) => (
  <Row
    name="category"
    data-id={p.channel.id}
    class={{ collapsed: channels.collapsed(p.channel) }}
    end={<Icon name="chevron" />}
    onClick={() => channels.toggleCollapsed(p.channel)}
  >
    {p.channel.name}
  </Row>
)

// a voice channel: its status under its name, how long the call has gone on at its end; who's in it under it
function VoiceChannel(p: { channel: Channel }) {
  const channel = () => p.channel
  const start = () => channels.callStart(channel())
  const now = useNow(() => (start() ? Infinity : 0))
  return (
    <>
      <Row
        name="voice"
        data-id={channel().id}
        class={{ live: voice.states(channel().id).length > 0, joined: voice.connected(channel()) }}
        icon={<ChannelIcon channel={channel()} />}
        subtitle={channels.voiceStatus(channel())}
        end={start() && <time>{channels.elapsed(now() - start()!)}</time>}
        onClick={() => voice.join(channel())}
      >
        {channel().name}
      </Row>
      <For each={voice.states(channel().id)}>{(state) => <VoiceUser state={state} channel={channel()} />}</For>
    </>
  )
}

// muted: the mic off; deafened: the mic and headphones off; by the server: in red
function VoiceUser(p: { state: VoiceState; channel: Channel }) {
  const state = () => p.state
  const user = () => users.get(state().userId)
  const deafened = () => voice.deafened(state())
  const muted = () => voice.muted(state()) || deafened()
  return (
    <Row
      name="voice-user"
      data-id={state().userId}
      class={{ forced: voice.forced(state()), elsewhere: voice.elsewhere(state(), p.channel) }}
      icon={
        <Show when={user()}>
          {(record) => (
            <Avatar user={record()} guildId={p.channel.guild_id} size={24} speaking={voice.speaking(state().userId)} />
          )}
        </Show>
      }
      end={
        (state().selfStream || muted()) && (
          <>
            <Show when={state().selfStream}>
              <Badge kind="live">LIVE</Badge>
            </Show>
            <Show when={muted()}>
              <Icon name="mic-off" />
            </Show>
            <Show when={deafened()}>
              <Icon name="deaf" />
            </Show>
          </>
        )
      }
    >
      {users.displayName(user(), p.channel.guild_id)}
    </Row>
  )
}

function ChannelRow(p: { channel: Channel }) {
  if (p.channel.type === ChannelType.Voice) return <VoiceChannel channel={p.channel} />
  if (p.channel.type === ChannelType.Category) return <Category channel={p.channel} />
  return <TextChannel channel={p.channel} />
}

export function Channels() {
  channels.useVoiceStatuses(selectedGuild)
  const menu = channelMenu()
  return (
    <nav onContextMenu={menu.open}>
      <Show
        when={selectedGuild()}
        keyed
        fallback={<For each={channels.dms()}>{(channel) => <Dm channel={channel} />}</For>}
      >
        {(guildId) => <For each={channels.rows(guildId)}>{(channel) => <ChannelRow channel={channel} />}</For>}
      </Show>
      {menu.view}
    </nav>
  )
}

// a right click on a channel or a category: stock's Mark As Read, Mute, Copy Link and Copy Channel ID
function channelMenu() {
  return contextMenu({
    class: 'channel-menu',
    find(e) {
      const row = (e.target as Element).closest<HTMLElement>('nav > .channel, nav > .category')
      return row && channels.get(row.dataset.id!)
    },
    children: (channel) => {
      const category = channel().type === ChannelType.Category
      const muted = () => channels.muted(channel())
      return (
        <Items
          items={[
            {
              name: 'menu-read',
              label: text('MARK_AS_READ'),
              disabled: !channels.canMarkRead(channel()),
              run: () => channels.markRead(channel()),
            },
            {
              name: 'menu-mute',
              label: text(muteLabel(category, muted())),
              run: () => channels.setMuted(channel(), !muted()),
            },
            {
              name: 'menu-copy-link',
              label: text('COPY_LINK'),
              run: () => navigator.clipboard.writeText(channels.link(channel())),
            },
            {
              name: 'menu-copy-id',
              label: text('COPY_ID_CHANNEL'),
              run: () => navigator.clipboard.writeText(channel().id),
            },
          ]}
        />
      )
    },
  })
}

function muteLabel(category: boolean, muted: boolean) {
  if (category) return muted ? 'UNMUTE_CATEGORY' : 'MUTE_CATEGORY'
  return muted ? 'UNMUTE_CHANNEL_GENERIC' : 'MUTE_CHANNEL_GENERIC'
}
