// The bundle's entry, injected by shell/preload.js: mounts the shell (app.tsx), or logged out the login form
// (views/login.tsx), where the anchor puts our root.

import { render } from '@solidjs/web'
import { Show } from 'solid-js'

import { setMount } from './adapter/anchor'
import './adapter/native'
import './adapter/screen'
import { expose } from './api/lab'
import { loggedIn } from './api/session'
import { App, CSS } from './app'
import { resetContent } from './views/chat'
import { Login } from './views/login'

expose({ list: { reset: resetContent } })

setMount((host) =>
  render(
    () => (
      <>
        <style>{CSS}</style>
        <Show when={loggedIn()} fallback={<Login />}>
          <App root={host} />
        </Show>
      </>
    ),
    host,
  ),
)
