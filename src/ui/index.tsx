// The bundle's entry, injected by shell/preload.js: mounts the shell (app.tsx), or logged out the login form
// (login.tsx), where the anchor puts our root.
//
// For the lab (ai/lab): data-mc marks what its scripts click and read; #mincord-root[data-view="channel:ID"] is set in
// the task that puts that channel's messages in the DOM.

import { render } from '@solidjs/web'
import { Show } from 'solid-js'

import { G, setMount } from '../adapter/anchor'
import '../adapter/native'
import '../adapter/screen'
import { A, check, S } from '../adapter/core'
import * as triggers from '../adapter/triggers'
import { byCode, byProps, find, findModuleId, inModule, wreq } from '../adapter/webpack'
import { App } from './app'
import { Login } from './login'
import { resetContent } from './chat'
import * as model from './lib/model'
import { $ } from './lib/store'

// for lab scripts over CDP
Object.assign(G, {
  adapter: {
    S,
    A,
    check,
    ...triggers,
    find,
    findModuleId,
    inModule,
    byProps,
    byCode,
    get wreq() {
      return wreq
    },
    store: (name: string) => A.flux.Store.getAll().find((s) => s.getName() === name),
    findByProps: (...props: string[]) => find(byProps(...props))?.[0],
    get rest() {
      return A.rest
    },
  },
  model,
  list: { reset: resetContent },
})

setMount((host) =>
  render(
    () => (
      <Show when={$.Auth.isAuthenticated()} fallback={<Login />}>
        <App root={host} />
      </Show>
    ),
    host,
  ),
)
