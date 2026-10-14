// window.mincord for lab scripts over CDP (ai/lab): Discord's pieces (`adapter`) and ours (`messages`, and whatever the
// entry adds). As for the stylesheet, scripts find elements by class (what an element is), data-id (which one: a
// channel, a user, a message) and id (the few looked up by it: popovers, the composer); #mincord-root[data-view=
// "channel:ID"] is set in the task that puts that channel's messages in the DOM.

import { G } from '../adapter/anchor'
import { A, check, S } from '../adapter/needs'
import { byCode, byProps, find, findModuleId, inModule, wreq } from '../adapter/webpack'
import * as messages from './messages'
import * as triggers from './triggers'

export function expose(more: Record<string, unknown>) {
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
    messages,
    ...more,
  })
}
