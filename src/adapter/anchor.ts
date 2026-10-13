// The anchor. Discord's root App class stays mounted: its componentDidMount starts its managers and its route
// listener starts the session and selects guilds and channels from the URL. Only its render changes: it renders one
// host element, and our renderer mounts into that. Logged out, our login form shows (views/login.tsx), or Discord's own
// tree (its login screen) once the form hands over to it.
//
// Discord's own UI shows instead when the patch doesn't match, when the self-check (needs.ts) fails, or when
// window.name contains "mincord:stock" (it survives a reload). mincord.status() says which.

import { A, check, S } from './needs'
import { patch } from './webpack'

type Mount = (host: HTMLElement) => () => void
type App = { handleHistoryChange(location: Location, ...rest: unknown[]): void; forceUpdate(): void }

// the one global: the patched App calls into it, lab scripts read it
export const G: Record<string, any> = ((window as any).mincord = {})

let mount: Mount | null = null
let unmount: (() => void) | null = null
let checked = false
// logged out, Discord's login screen instead of ours (until the next login)
let discords = false
let app: App | null = null

const anchor = patch(
  'addRouteRewriter(this.ensureChannelMatchesGuild)',
  // App.render: Discord's route switch, from "/channels" redirect on
  [/render\(\)\{(?=return.{0,120}?from:"\/channels",to:"\/")/, 'render(){if(mincord.own())return mincord.root();'],
  // with no routes mounted, nothing runs the route handler for the URL we start on: didMount does. listen wraps the
  // handler before the App registers it
  [
    /(this\.historyUnlisten=[\w$]+\.[\w$]+\.addRouteChangeListener\(this\.handleHistoryChange\))/,
    'mincord.listen(this),$1,mincord.didMount(this)',
  ],
)

// above the App, a route switch sends /login (where a logout or a start logged out lands) to Discord's login pages, and
// the App never mounts: while our form is on, its path lists (built by one function, next to a set that starts with
// LOGIN) leave /login out, and it stays with the App. Its own patch, so the anchor still applies without it (a start on
// /login then shows Discord's screen)
const login = patch('.wasAuthenticated=', [
  /(new Set\(\[([\w$]+\.[\w$]+\.LOGIN),.{0,300}?function [\w$]+\(([\w$]+),[\w$]+\)\{)/,
  '$1$3=mincord.ownLogin()?$3.filter(p=>p!==$2):$3;',
])

const stock = () => window.name.includes('mincord:stock')
const active = () => !stock() && !adapterFailed() && S.Auth.isAuthenticated()
// our root renders: logged in, or our login form
const own = () => !stock() && !adapterFailed() && (S.Auth.isAuthenticated() || !discords)

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
  own,
  // read by the route switch before the App's first render, so without the self-check
  ownLogin: () => !stock() && !discords,

  discordLogin() {
    discords = true
    app?.forceUpdate()
  },

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

  didMount(a: App) {
    // the check runs in stock mode too: the lab reads stores through the adapter in both
    if (adapterFailed() || stock()) return
    app = a
    let was = active()
    if (was) a.handleHistoryChange(window.location)
    S.Auth.addChangeListener(() => {
      if (active() === was) return
      was = !was
      if (!was) return a.forceUpdate()
      // logged in. Through Discord's screen, it navigates away from /login and the route listener runs on its own; through
      // our form, nothing navigates: /app, where stock's login lands, which the listener redirects to the default route
      discords ? (discords = false) : A.nav.replaceWith('/app')
      a.forceUpdate()
    })
  },

  status: () => ({
    applied: anchor.applied,
    login: login.applied,
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
              : own()
                ? 'login'
                : 'logged out',
    adapter: checked ? check() : null,
    mounted: !!unmount,
    native: G.nativeApplied?.() ?? null,
    screen: G.screenApplied?.() ?? null,
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
