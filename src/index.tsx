import { render } from '@solidjs/web'
import { Show } from 'solid-js'

import { setMount } from './adapter/anchor'
import './adapter/native'
import './adapter/screen'
import { expose } from './api/lab'
import { loggedIn } from './api/session'
import { App, CSS } from './app'
import { resetContent } from './components/message/content'
import { Login } from './views/login'

expose({ list: { reset: resetContent } })

setMount((host) =>
  render(
    () => (
      <>
        <style>{CSS}</style>
        <Show when={loggedIn()} fallback={<Login />}>
          <App />
        </Show>
      </>
    ),
    host,
  ),
)
