/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The bundle's entry (vite.config.ts), injected by app/preload.js: mounts the shell (app.tsx) where the anchor puts
// our root.
//
// Lab conventions (ai/lab/budgets.py, conformance.py and the scenarios rely on them):
//   data-mc="guild:ID" | "channel:ID" | "dm:ID"   the element a click on navigates there
//   #mincord-root[data-view="channel:ID"]          set in the task that puts that channel's messages in the DOM
//   data-mc="messages"                              the message list's scroller
//   data-mc="author:ID"                             an author's name in the list

import { render } from "@solidjs/web";

import { G, setMount } from "../adapter/anchor";
import { A, checkReport, S, searchMismatches } from "../adapter/core";
import * as triggers from "../adapter/triggers";
import { byCode, byProps, find, findModuleId, inModule, localStorage, wreq } from "../adapter/webpack";
import { App } from "./app";
import { resetContent } from "./messages";
import * as model from "./model";

// for lab scripts over CDP
Object.assign(G, {
    adapter: {
        S, A, checkReport, searchMismatches, ...triggers, localStorage, find, findModuleId, inModule, byProps, byCode,
        get wreq() { return wreq; },
        store: (name: string) => A.flux.Store.getAll().find(s => s.getName() === name),
        findByProps: (...props: string[]) => find(byProps(...props))?.[0],
        get rest() { return find(byProps("getAPIBaseURL", "get", "post"))?.[0]; }
    },
    model,
    list: { reset: resetContent }
});

setMount(host => render(() => <App root={host} />, host));
