// The shell: one grid (style.ts), one element per region and per list row.

import { createEffect, createMemo, createSignal, Show } from 'solid-js'

import { A, S } from './adapter/needs'
import { Channels, dmIcon, dmName, dmStatus, kindOf, url } from './views/channels'
import { CallButtons, CallView, IncomingCalls, voiceSounds } from './views/call'
import { NotificationBell, Pins, Search } from './views/header'
import { Chat } from './views/chat'
import { warm } from './api/preload'
import { $, selectedChannel, selectedGuild } from './api/store'
import { MembersList, MembersToggle } from './views/members'
import { MessageInput } from './views/composer'
import { ServerBar } from './views/server_bar'
import { CSS } from './style'
import { UserPanel } from './views/user_panel'

// GatewayConnectionStore reads the socket and doesn't emit when it drops or comes back, so follow the actions (the
// socket's own state changes only after CONNECTION_INTERRUPTED)
function Connection() {
  const [connected, setConnected] = createSignal(S.Gateway.isConnected())
  let once = connected()
  const on = (type: string, now: boolean) =>
    A.dispatcher.subscribe(type, () => {
      once ||= now
      setConnected(now)
    })
  on('CONNECTION_OPEN', true)
  on('CONNECTION_RESUMED', true)
  on('CONNECTION_INTERRUPTED', false)
  on('CONNECTION_CLOSED', false)
  return (
    <Show when={!connected()}>
      <p class="notice">{!S.Gateway.isTryingToConnect() ? 'Disconnected' : once ? 'Reconnecting…' : 'Connecting…'}</p>
    </Show>
  )
}

// stock's badge, in the window title as on the web: mentions and friend requests as "(N)", a dot for anything else
// unread; the shell turns it into the app badge (src/shell/main.js)
function badge() {
  const n = $.GuildReadState.getTotalMentionCount() + $.Relationship.getPendingCount()
  if (n) return `(${n}) `
  return $.GuildReadState.hasAnyUnread() && !$.NotificationSettings.getDisableUnreadBadge() ? '• ' : ''
}

export function App(p: { root: HTMLElement }) {
  const channel = selectedChannel
  const dm = () => channel() && !channel()!.guild_id
  createEffect(createMemo(badge), (b) => {
    document.title = `${b}Discord`
  })
  warm()
  voiceSounds()
  return (
    <>
      <style>{CSS}</style>
      <Connection />
      <ServerBar />
      <h1>{selectedGuild() ? $.Guild.getGuild(selectedGuild()!)?.name : 'Direct Messages'}</h1>
      <section class="side">
        <Channels />
        <UserPanel />
      </section>
      <header
        style={dm() ? url(dmIcon(channel())) : undefined}
        data-status={dm() ? dmStatus(channel()) : undefined}
        class={channel() && !dm() ? ['channel', kindOf(channel()!)] : undefined}
      >
        <Show when={channel()}>
          {(c) => (
            <>
              {c().guild_id ? c().name : dmName(c())}
              <small>{c().topic}</small>
            </>
          )}
        </Show>
        <Show when={dm()}>
          <CallButtons channel={channel()!} />
        </Show>
        <Show when={channel()?.guild_id && channel()}>{(c) => <NotificationBell channel={c()} />}</Show>
        <Show when={channel()}>{(c) => <Pins channel={c()} />}</Show>
        <MembersToggle />
        <Show when={channel()}>{(c) => <Search channel={c()} />}</Show>
      </header>
      <CallView />
      <Chat root={p.root} />
      <IncomingCalls />
      <MessageInput />
      <MembersList />
    </>
  )
}
