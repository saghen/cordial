// The channel list: a server's channels, categories and voice channels (with who's in them), or the DMs. Each is a Row;
// a right click on a channel or a category opens stock's channel menu.

import { For, Show } from 'solid-js'

import * as channels from '../api/channels'
import { useNow } from '../api/hooks'
import { onHover } from '../api/preload'
import { ChannelType, type Channel, type PrivateChannel, type VoiceState } from '../api/records'
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

// the mention count at a row's end
const count = (n: number) => n > 0 && <Badge kind="count">{n}</Badge>

function Dm(p: { channel: PrivateChannel }) {
  const c = () => p.channel
  return (
    <Row
      name="dm"
      data-id={c().id}
      title={channels.dmName(c())}
      class={{ sel: selected() === c().id, unread: channels.unread(c()) }}
      icon={<DmIcon channel={c()} size={32} status />}
      sub={channels.dmSub(c())}
      end={count(channels.mentions(c()))}
      onClick={() => channels.open(c())}
      {...onHover(() => c().id)}
    >
      {channels.dmName(c())}
    </Row>
  )
}

function TextChannel(p: { channel: Channel }) {
  const c = () => p.channel
  const muted = () => channels.muted(c())
  return (
    <Row
      name="channel"
      data-id={c().id}
      class={{ sel: selected() === c().id, unread: channels.unread(c()) && !muted(), muted: muted() }}
      icon={<ChannelIcon channel={c()} />}
      end={count(channels.mentions(c()))}
      onClick={() => channels.open(c())}
      {...onHover(() => c().id)}
    >
      {c().name}
    </Row>
  )
}

// a category: its name and a chevron; a click collapses or expands it
const Category = (p: { channel: Channel }) => (
  <Row
    name="cat"
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
  const c = () => p.channel
  const start = () => channels.callStart(c())
  const now = useNow(() => (start() ? Infinity : 0))
  return (
    <>
      <Row
        name="voice"
        data-id={c().id}
        class={{ live: voice.states(c().id).length > 0, sel: voice.connected(c()) }}
        icon={<ChannelIcon channel={c()} />}
        sub={channels.voiceStatus(c())}
        end={start() && <time>{channels.elapsed(now() - start()!)}</time>}
        onClick={() => voice.join(c())}
      >
        {c().name}
      </Row>
      <For each={voice.states(c().id)}>{(v) => <VoiceUser state={v} channel={c()} />}</For>
    </>
  )
}

// muted: the mic off; deafened: the mic and headphones off; by the server: in red
function VoiceUser(p: { state: VoiceState; channel: Channel }) {
  const v = () => p.state
  const user = () => users.get(v().userId)
  const mute = () => v().selfMute || v().mute || deaf(),
    deaf = () => v().selfDeaf || v().deaf
  return (
    <Row
      name="voice-user"
      data-id={v().userId}
      class={{ forced: voice.forced(v()), elsewhere: voice.elsewhere(v(), p.channel) }}
      icon={
        <Show when={user()}>
          {(u) => <Avatar user={u()} guildId={p.channel.guild_id} size={24} speaking={voice.speaking(v().userId)} />}
        </Show>
      }
      end={
        (v().selfStream || mute()) && (
          <>
            <Show when={v().selfStream}>
              <Badge kind="live">LIVE</Badge>
            </Show>
            <Show when={mute()}>
              <Icon name="mic-off" />
            </Show>
            <Show when={deaf()}>
              <Icon name="deaf" />
            </Show>
          </>
        )
      }
    >
      {users.nameOf(user(), user() && users.member(user()!, p.channel.guild_id)?.nick)}
    </Row>
  )
}

export function Channels() {
  channels.useVoiceStatuses(selectedGuild)
  const menu = channelMenu()
  return (
    <nav onContextMenu={menu.open}>
      <Show when={selectedGuild()} keyed fallback={<For each={channels.dms()}>{(c) => <Dm channel={c} />}</For>}>
        {(guildId) => (
          <For each={channels.rows(guildId)}>
            {(c) =>
              c.type === ChannelType.Voice ? (
                <VoiceChannel channel={c} />
              ) : c.type === ChannelType.Category ? (
                <Category channel={c} />
              ) : (
                <TextChannel channel={c} />
              )
            }
          </For>
        )}
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
      const row = (e.target as Element).closest<HTMLElement>('nav > .channel, nav > .cat')
      return row && channels.get(row.dataset.id!)
    },
    children: (c) => {
      const cat = c().type === ChannelType.Category,
        muted = () => channels.muted(c())
      return (
        <Items
          items={[
            {
              name: 'menu-read',
              label: text('MARK_AS_READ'),
              disabled: !channels.canMarkRead(c()),
              run: () => channels.markRead(c()),
            },
            {
              name: 'menu-mute',
              label: text(
                cat
                  ? muted()
                    ? 'UNMUTE_CATEGORY'
                    : 'MUTE_CATEGORY'
                  : muted()
                    ? 'UNMUTE_CHANNEL_GENERIC'
                    : 'MUTE_CHANNEL_GENERIC',
              ),
              run: () => channels.setMuted(c(), !muted()),
            },
            {
              name: 'menu-copy-link',
              label: text('COPY_LINK'),
              run: () => navigator.clipboard.writeText(`https://discord.com/channels/${c().guild_id}/${c().id}`),
            },
            { name: 'menu-copy-id', label: text('COPY_ID_CHANNEL'), run: () => navigator.clipboard.writeText(c().id) },
          ]}
        />
      )
    },
  })
}
