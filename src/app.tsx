// The shell: one grid (app.css), one element per region and per list row; and the renderer's CSS.

import { createEffect, createMemo, Show } from 'solid-js'

import { Channels } from './views/channels'
import { CallButtons, CallView, IncomingCalls, voiceSounds } from './views/call'
import { NotificationBell, Pins, Search } from './views/header'
import { Chat } from './views/chat'
import * as channels from './api/channels'
import { warm } from './api/preload'
import type { PrivateChannel } from './api/records'
import * as session from './api/session'
import { $, selectedChannel, selectedGuild } from './api/store'
import { text } from './api/strings'
import { ChannelIcon } from './components/channel_icon'
import { DmIcon } from './components/dm_icon'
import { MembersList, MembersToggle } from './views/members'
import { Composer } from './views/composer'
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

// the gateway's state while it's not connected
function Connection() {
  const notice = session.useConnection()
  return <Show when={notice()}>{(n) => <p class="notice">{n()}</p>}</Show>
}

export function App(p: { root: HTMLElement }) {
  const channel = selectedChannel
  const dm = () => channel() && !channel()!.guild_id
  // the badge in the window title, as on the web; the shell turns it into the app badge (src/shell/main.js)
  createEffect(createMemo(session.badge), (b) => {
    document.title = `${b}Discord`
  })
  warm()
  voiceSounds()
  return (
    <>
      <Connection />
      <ServerBar />
      <h1>{selectedGuild() ? $.Guild.getGuild(selectedGuild()!)?.name : text('DIRECT_MESSAGES')}</h1>
      <section class="side">
        <Channels />
        <UserPanel />
      </section>
      <header>
        <Show when={channel()}>
          {(c) => (
            <>
              {c().guild_id ? (
                <ChannelIcon channel={c()} />
              ) : (
                <DmIcon channel={c() as PrivateChannel} size={24} status />
              )}
              {c().guild_id ? c().name : channels.dmName(c() as PrivateChannel)}
              <small>{c().topic}</small>
            </>
          )}
        </Show>
        <Show when={dm()}>
          <CallButtons channel={channel()!} />
        </Show>
        <Show when={channel()?.guild_id ? channel() : undefined}>{(c) => <NotificationBell channel={c()} />}</Show>
        <Show when={channel()}>{(c) => <Pins channel={c()} />}</Show>
        <MembersToggle />
        <Show when={channel()}>{(c) => <Search channel={c()} />}</Show>
      </header>
      <CallView />
      <Chat root={p.root} />
      <IncomingCalls />
      <Composer />
      <MembersList />
    </>
  )
}
