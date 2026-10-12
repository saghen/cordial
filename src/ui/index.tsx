// The bundle's entry, injected by shell/preload.js: mounts the shell (app.tsx) where the anchor puts our root.
//
// Lab conventions (ai/lab/budgets.py, conformance.py and the scenarios rely on them):
//   data-mc="guild:ID" | "channel:ID" | "dm:ID"   the element a click on navigates there
//   #mincord-root[data-view="channel:ID"]          set in the task that puts that channel's messages in the DOM
//   data-mc="messages"                              the message list's scroller
//   data-mc="author:ID"                             an author's name in the list
//   data-mc="category:ID"                           a category row; a click collapses or expands it
//   data-mc="composer"                              the composer's textarea
//   data-mc="me" | "account" | "status:NAME"      the user panel, its popout, a status in it (online, idle, dnd, invisible)
//   data-mc="notice"                                the notice bar, shown while the gateway is down

import { render } from "@solidjs/web";

import { G, setMount } from "../adapter/anchor";
import { A, check, S } from "../adapter/core";
import * as triggers from "../adapter/triggers";
import { byCode, byProps, find, findModuleId, inModule, wreq } from "../adapter/webpack";
import { App } from "./app";
import { resetContent } from "./messages";
import * as model from "./model";

// for lab scripts over CDP
Object.assign(G, {
    adapter: {
        S, A, check, ...triggers, find, findModuleId, inModule, byProps, byCode,
        get wreq() { return wreq; },
        store: (name: string) => A.flux.Store.getAll().find(s => s.getName() === name),
        findByProps: (...props: string[]) => find(byProps(...props))?.[0],
        get rest() { return find(byProps("getAPIBaseURL", "get", "post"))?.[0]; }
    },
    model,
    list: { reset: resetContent }
});

setMount(host => render(() => <App root={host} />, host));
