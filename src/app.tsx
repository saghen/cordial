// The shell: one grid (app.css), one element per region and per list row; and the renderer's CSS.

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
import { ICONS } from './primitives/icons'
import { UserPanel } from './views/user_panel'

// Every .css file under src/ (app.css first, the rest by path), nested under #mincord-root once so Discord's own layers
// never see them, with the icons as custom properties on the root. @keyframes can't nest: they go after it
const files = import.meta.glob<string>('./**/*.css', { query: '?inline', import: 'default', eager: true })
const frames: string[] = []
const rules = [
  files['./app.css'],
  ...Object.keys(files)
    .filter((f) => f !== './app.css')
    .map((f) => files[f]),
]
  .join('\n')
  .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, (k) => (frames.push(k), ''))
export const CSS = `#mincord-root {\n${ICONS}\n${rules}}\n${frames.join('\n')}`

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
