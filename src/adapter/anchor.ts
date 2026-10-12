// The anchor. Discord's root App class stays mounted: its componentDidMount starts ~60 managers and its route
// listener starts the session and selects guilds and channels from the URL. Only its render changes: instead of
// Discord's routes it renders one host element, and our renderer mounts into that.
//
// Logged out, the App renders Discord's own tree: the login screen is one of its routes (/login). Our root renders only
// while AuthenticationStore says logged in, and the App re-renders when that changes (login, logout, a token expiring).
//
// If the patch stops matching Discord's code, it doesn't apply and Discord's own UI shows; mincord.status() says so.
// So does window.name containing "mincord:stock", in the same build (window.name survives a reload; Discord deletes
// localStorage and sessionStorage from the page). And so does a failed self-check (core.ts) at the App's first render:
// the console names each missing need.

import { A, checkOk, checkReport, S } from "./core";
import { patch } from "./webpack";

type Mount = (host: HTMLElement) => () => void;
type App = { handleHistoryChange(location: Location, ...rest: unknown[]): void; forceUpdate(): void; };

// the one global: the patched App calls into it, lab scripts read it
export const G: Record<string, any> = (window as any).mincord = {};

let mount: Mount | null = null;
let unmount: (() => void) | null = null;
let routed = false;
let failed: boolean | null = null;

const anchor = patch("addRouteRewriter(this.ensureChannelMatchesGuild)",
    // App.render: Discord's route switch, from "/channels" redirect on
    [/render\(\)\{(?=return.{0,120}?from:"\/channels",to:"\/")/, "render(){if(mincord.active())return mincord.root();"],
    // with no routes mounted, nothing fires the route handler for the URL we start on: run it once. Before the App
    // registers its route handler, ours wraps it (listen)
    [/(this\.historyUnlisten=[\w$]+\.[\w$]+\.addRouteChangeListener\(this\.handleHistoryChange\))/,
        "mincord.listen(this),$1,mincord.didMount(this)"]
);

const stock = () => window.name.includes("mincord:stock");
const active = () => !stock() && !adapterFailed() && S.Auth.isAuthenticated();

// once, at the App's first render: by then the modules the App imports (stores, action creators) are evaluated
function adapterFailed() {
    if (failed !== null) return failed;
    failed = !checkOk();
    if (failed) console.error("[mincord] off, Discord's UI is showing: adapter needs missing (Discord's code changed)",
        checkReport().missing.map(m => `${m.name} = ${m.what}: ${m.why}`));
    return failed;
}

// stable across renders, so React never detaches and reattaches the host
function hostRef(host: HTMLElement | null) {
    unmount?.();
    unmount = null;
    if (host && mount) unmount = mount(host);
}

export function setMount(fn: Mount) {
    mount = fn;
}

Object.assign(G, {
    active,

    root: () => A.react.createElement("div", { id: "mincord-root", ref: hostRef }),

    // Stock's routes redirect /app (where a start or a login lands) to DefaultRouteStore.defaultRoute; with ours showing
    // no route is mounted to do it, so the route handler does. Stock handles /app like any route (ROUTE_CHANGED), then
    // its route's Redirect replaces it once rendered: the replace waits for the other history listeners to see /app
    listen(app: App) {
        const handle = app.handleHistoryChange;
        app.handleHistoryChange = (location, ...rest) => {
            handle.call(app, location, ...rest);
            if (location.pathname === "/app" && active())
                queueMicrotask(() => location.pathname === window.location.pathname && A.nav.replaceWith(S.DefaultRoute.defaultRoute));
        };
    },

    didMount(app: App) {
        // the check runs in stock mode too: the lab reads stores through the adapter in both
        if (adapterFailed() || stock()) return;
        let was = active();
        if (was) {
            routed = true;
            app.handleHistoryChange(window.location);
        }
        // after a login, Discord navigates away from /login and the route listener runs on its own
        S.Auth.addChangeListener(() => {
            if (active() === was) return;
            was = !was;
            app.forceUpdate();
        });
    },

    status: () => ({
        applied: anchor.applied,
        // before the App's first render the check would run too early, and its result sticks
        mode: stock() ? "stock" : !anchor.applied ? "not applied" : failed === null ? "starting" : failed ? "fallback"
            : active() ? "mincord" : "logged out",
        adapter: failed === null ? null : checkReport(),
        routed,
        mounted: !!unmount
    })
});

window.addEventListener("load", () => setTimeout(() => {
    if (stock() || failed) return;
    if (!anchor.applied) console.error("[mincord] the anchor did not apply (Discord's code changed): Discord's own UI is showing");
    else if (!unmount && active()) console.error("[mincord] the anchor applied but our root never mounted");
}, 10_000));
