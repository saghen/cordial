/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The anchor. Discord's root App class stays mounted: its componentDidMount starts ~60 managers and its route
// listener starts the session and selects guilds and channels from the URL. Only its render changes: instead of
// Discord's routes it renders one host element, and our renderer mounts into that.
//
// Discord's login screen is not part of the App class (the outer router shows it while logged out), so it keeps
// working untouched.
//
// If the patch stops matching Discord's code, Equicord undoes the whole group and Discord's own UI shows: the console
// then says so ("mincord anchor did not apply"), and VesktopPatchGlobals.mincordStatus() reports it.
//
// window.name containing "mincord:stock" renders Discord's own tree instead, in the same build (window.name is the
// one place that survives a reload: Discord deletes localStorage and sessionStorage from the page).

import { React } from "@equicord/types/webpack/common";

import { VesktopLogger } from "../../logger";
import { addPatch } from "../../patches/shared";

type Mount = (host: HTMLElement) => () => void;

const applied = [false, false];
let mount: Mount | null = null;
let unmount: (() => void) | null = null;
let routed = false;

function stock() {
    return window.name.includes("mincord:stock");
}

// stable across renders, so React never detaches and reattaches the host
function hostRef(host: HTMLElement | null) {
    unmount?.();
    unmount = null;
    if (host && mount) unmount = mount(host);
}

function mark<T extends any[]>(i: number, replace: string) {
    return (...args: T) => {
        applied[i] = true;
        // the template's $n groups, as String.prototype.replace would expand them
        return replace.replace(/\$(\d)/g, (_, k) => args[+k] ?? "");
    };
}

export function setMount(fn: Mount) {
    mount = fn;
}

addPatch({
    patches: [
        {
            find: "addRouteRewriter(this.ensureChannelMatchesGuild)",
            group: true,
            replacement: [
                {
                    // App.render: Discord's route switch, from "/channels" redirect on
                    match: /render\(\)\{(?=return.{0,120}?from:"\/channels",to:"\/")/,
                    replace: mark(0, "render(){if($self.mincordActive())return $self.mincordRoot();")
                },
                {
                    // with no routes mounted, nothing fires the route handler for the URL we start on: run it once
                    match: /(this\.historyUnlisten=\i\.\i\.addRouteChangeListener\(this\.handleHistoryChange\))/,
                    replace: mark(1, "$1,$self.mincordDidMount(this)")
                }
            ]
        }
    ],

    mincordActive() {
        return !stock();
    },

    mincordRoot() {
        return React.createElement("div", { id: "mincord-root", ref: hostRef });
    },

    mincordDidMount(app: { handleHistoryChange(location: Location): void }) {
        if (stock()) return;
        routed = true;
        app.handleHistoryChange(window.location);
    },

    mincordStatus() {
        return {
            applied: applied.every(Boolean),
            replacements: [...applied],
            mode: stock() ? "stock" : "mincord",
            routed,
            mounted: !!unmount
        };
    }
});

Vencord.Webpack.onceReady.then(() =>
    setTimeout(() => {
        if (stock()) return;
        if (!applied.every(Boolean))
            VesktopLogger.error("mincord anchor did not apply (Discord's code changed): Discord's own UI is showing", applied);
        else if (!unmount) VesktopLogger.error("mincord anchor applied but our root never mounted");
    }, 10_000)
);
