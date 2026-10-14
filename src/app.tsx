import { createEffect, createMemo, Show } from 'solid-js'

import { preloadChannels } from './api/preload'
import * as session from './api/session'
import { useVoiceSounds } from './api/sounds'
import { ICONS } from './primitives/icons'
import { CallView, IncomingCalls } from './views/call'
import { Channels } from './views/channels'
import { Chat } from './views/chat'
import { Composer } from './views/composer'
import { Header } from './views/header'
import { MembersList } from './views/members'
import { ServerBar } from './views/server_bar'
import { UserPanel } from './views/user_panel'

// Load every css file under #cordial-root
const files = import.meta.glob<string>('./**/*.css', { query: '?inline', import: 'default', eager: true })
const LAYERS = ['./app.css', './primitives/', './components/', './views/'] // order the loads
const layer = (f: string) => LAYERS.findIndex((l) => f.startsWith(l))
const frames: string[] = [] // keyframes cant nest, put them after
const rules = Object.keys(files)
  .sort((a, b) => layer(a) - layer(b) || a.localeCompare(b))
  .map((f) => files[f])
  .join('\n')
  .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, (k) => (frames.push(k), ''))
export const CSS = `#cordial-root {\n${ICONS}\n${rules}}\n${frames.join('\n')}`

// the gateway's state while it's not connected
function ConnectionWarning() {
  const notice = session.useConnection()
  return <Show when={notice()}>{(n) => <p class="notice">{n()}</p>}</Show>
}

export function App(p: { root: HTMLElement }) {
  // window title
  createEffect(createMemo(session.badge), (b) => {
    document.title = `${b}Discord`
  })
  preloadChannels()
  useVoiceSounds()
  return (
    <>
      <ConnectionWarning />
      <ServerBar />
      <section class="side">
        <Channels />
        <UserPanel />
      </section>
      <Header />
      <CallView />
      <Chat />
      <IncomingCalls />
      <Composer />
      <MembersList />
    </>
  )
}
