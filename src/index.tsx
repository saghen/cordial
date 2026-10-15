import { render } from '@solidjs/web'
import { Show } from 'solid-js'

import { setMount } from './adapter/anchor'
import './adapter/fields'
import './adapter/native'
import './adapter/screen'
import { expose } from './api/lab'
import { loggedIn } from './api/session'
import * as users from './api/users'
import { App, CSS } from './app'
import { resetContent } from './components/message/content'
import { open as openProfile } from './components/profile'
import { Login } from './views/login'

expose({
  list: { reset: resetContent },
  // a user's profile card, beside the top bar
  profile(userId: string, guildId?: string) {
    const user = users.get(userId)
    if (user) openProfile(document.querySelector('#cordial-root > header')!, user, guildId)
    return Boolean(user)
  },
})

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
