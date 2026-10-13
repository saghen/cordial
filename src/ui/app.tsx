// The shell: one grid (style.ts), one element per region and per list row.

import { createSignal, Show } from 'solid-js'

import { A, S } from '../adapter/core'
import { Channels, dmIcon, dmName, dmStatus, kindOf, url } from './channels'
import { Chat } from './chat'
import { warm } from './lib/preload'
import { $, selectedChannel, selectedGuild } from './lib/store'
import { MembersList, MembersToggle } from './members'
import { MessageInput } from './message_input'
import { ServerBar } from './server_bar'
import { CSS } from './style'
import { UserPanel } from './user_panel'

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
      <p data-mc="notice">{!S.Gateway.isTryingToConnect() ? 'Disconnected' : once ? 'Reconnecting…' : 'Connecting…'}</p>
    </Show>
  )
}

export function App(p: { root: HTMLElement }) {
  const channel = selectedChannel
  const dm = () => channel() && !channel()!.guild_id
  warm()
  return (
    <>
      <style>{CSS}</style>
      <Connection />
      <ServerBar />
      <h1>{selectedGuild() ? $.Guild.getGuild(selectedGuild()!)?.name : 'Direct Messages'}</h1>
      <Channels />
      <UserPanel />
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
        <MembersToggle />
      </header>
      <Chat root={p.root} />
      <MessageInput />
      <MembersList />
    </>
  )
}
