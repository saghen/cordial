// The anchor. Discord's root App class stays mounted: its componentDidMount starts its managers and its route
// listener starts the session and selects guilds and channels from the URL. Only its render changes: it renders one
// host element, and our renderer mounts into that. Logged out, it renders Discord's own tree (the login screen).
//
// Discord's own UI shows instead when the patch doesn't match, when the self-check (core.ts) fails, or when
// window.name contains "mincord:stock" (it survives a reload). mincord.status() says which.

import { A, check, S } from './core'
import { patch } from './webpack'

type Mount = (host: HTMLElement) => () => void
type App = { handleHistoryChange(location: Location, ...rest: unknown[]): void; forceUpdate(): void }

// the one global: the patched App calls into it, lab scripts read it
export const G: Record<string, any> = ((window as any).mincord = {})

let mount: Mount | null = null
let unmount: (() => void) | null = null
let checked = false

const anchor = patch(
  'addRouteRewriter(this.ensureChannelMatchesGuild)',
  // App.render: Discord's route switch, from "/channels" redirect on
  [/render\(\)\{(?=return.{0,120}?from:"\/channels",to:"\/")/, 'render(){if(mincord.active())return mincord.root();'],
  // with no routes mounted, nothing runs the route handler for the URL we start on: didMount does. listen wraps the
  // handler before the App registers it
  [
    /(this\.historyUnlisten=[\w$]+\.[\w$]+\.addRouteChangeListener\(this\.handleHistoryChange\))/,
    'mincord.listen(this),$1,mincord.didMount(this)',
  ],
)

const stock = () => window.name.includes('mincord:stock')
const active = () => !stock() && !adapterFailed() && S.Auth.isAuthenticated()

// at the App's first render, once the modules it imports are evaluated
function adapterFailed() {
  const r = check()
  if (!checked && !r.ok)
    console.error(
      "[mincord] off, Discord's UI is showing: adapter needs missing (Discord's code changed)",
      r.missing.map((m) => `${m.name} = ${m.what}: ${m.why}`),
    )
  checked = true
  return !r.ok
}

// stable across renders, so React never detaches and reattaches the host
function hostRef(host: HTMLElement | null) {
  unmount?.()
  unmount = host && mount ? mount(host) : null
}

export function setMount(fn: Mount) {
  mount = fn
}

Object.assign(G, {
  active,

  root: () => A.react.createElement('div', { id: 'mincord-root', ref: hostRef }),

  // stock's routes redirect /app (where a start or a login lands) to the default route; with no route mounted, the
  // route handler does, after the other history listeners have seen /app (as stock's Redirect waits for its render)
  listen(app: App) {
    const handle = app.handleHistoryChange
    app.handleHistoryChange = (location, ...rest) => {
      handle.call(app, location, ...rest)
      if (location.pathname === '/app' && active())
        queueMicrotask(
          () => location.pathname === window.location.pathname && A.nav.replaceWith(S.DefaultRoute.defaultRoute),
        )
    }
  },

  didMount(app: App) {
    // the check runs in stock mode too: the lab reads stores through the adapter in both
    if (adapterFailed() || stock()) return
    let was = active()
    if (was) app.handleHistoryChange(window.location)
    // after a login, Discord navigates away from /login and the route listener runs on its own
    S.Auth.addChangeListener(() => {
      if (active() === was) return
      was = !was
      app.forceUpdate()
    })
  },

  status: () => ({
    applied: anchor.applied,
    // before the App's first render the check would run too early
    mode: stock()
      ? 'stock'
      : !anchor.applied
        ? 'not applied'
        : !checked
          ? 'starting'
          : !check().ok
            ? 'fallback'
            : active()
              ? 'mincord'
              : 'logged out',
    adapter: checked ? check() : null,
    mounted: !!unmount,
  }),
})

window.addEventListener('load', () =>
  setTimeout(() => {
    if (stock() || (checked && !check().ok)) return
    if (!anchor.applied)
      console.error("[mincord] the anchor did not apply (Discord's code changed): Discord's own UI is showing")
    else if (!unmount && active()) console.error('[mincord] the anchor applied but our root never mounted')
  }, 10_000),
)
