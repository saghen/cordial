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
const STYLESHEETS = import.meta.glob<string>('./**/*.css', { query: '?inline', import: 'default', eager: true })
const LAYERS = ['./app.css', './primitives/', './components/', './views/'] // order the loads
const layer = (path: string) => LAYERS.findIndex((prefix) => path.startsWith(prefix))
const KEYFRAMES: string[] = [] // keyframes cant nest, put them after
const RULES = Object.keys(STYLESHEETS)
  .sort((left, right) => layer(left) - layer(right) || left.localeCompare(right))
  .map((path) => STYLESHEETS[path])
  .join('\n')
  .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, (keyframe) => {
    KEYFRAMES.push(keyframe)
    return ''
  })
export const CSS = `#cordial-root {\n${ICONS}\n${RULES}}\n${KEYFRAMES.join('\n')}`

// the gateway's state while it's not connected
function ConnectionWarning() {
  const notice = session.useConnection()
  return <Show when={notice()}>{(warning) => <p class="notice">{warning()}</p>}</Show>
}

export function App() {
  // window title
  createEffect(createMemo(session.badge), (badge) => {
    document.title = `${badge}Discord`
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
