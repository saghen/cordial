// Discord's webpack: its require (wreq), module search, and source patches. Runs before Discord's scripts (the
// preload injects us), so it sees webpack set its module factories and can patch them before any runs.

export let wreq: any = null
let size = 0

interface Patch {
  find: string
  replace: [RegExp, string][]
  applied: boolean
}
const patches: Patch[] = []

// registered at module top level; all replacements apply, or none do
export function patch(find: string, ...replace: [RegExp, string][]) {
  const entry = { find, replace, applied: false }
  patches.push(entry)
  return entry
}

const toString = Function.prototype.toString

// webpack's runtime does `__webpack_require__.m = modules` once per runtime: Discord's main one, and a few small ones
Object.defineProperty(Function.prototype, 'm', {
  configurable: true,
  set(this: any, modules: Record<string, Function>) {
    Object.defineProperty(this, 'm', { value: modules, configurable: true, writable: true, enumerable: true })
    if (!toString.call(this).includes('exports:{}')) return
    // Discord's is the biggest when set: the small ones grow later, through the chunk array they share with it
    const count = Object.keys(modules).length
    if (count > size) [wreq, size] = [this, count]
    for (const pending of patches.filter((entry) => !entry.applied)) {
      const id = Object.keys(modules).find((id) => toString.call(modules[id]).includes(pending.find))
      if (id === undefined) continue
      let out = toString.call(modules[id])
      pending.applied = pending.replace.every(([pattern, replacement]) => {
        const next = out.replace(pattern, replacement)
        const changed = next !== out
        out = next
        return changed
      })
      if (pending.applied)
        // oxlint-disable-next-line no-eval -- the patched factory's source, evaluated in global scope as webpack's own
        modules[id] = globalThis.eval(`0,${out.replace(/^\d+/, 'function')}\n//# sourceURL=cordial-${id}`)
    }
  },
})

export const byProps =
  (...props: string[]) =>
  (candidate: any) =>
    props.every((prop) => candidate[prop] !== undefined)
export const byCode =
  (...code: string[]) =>
  (candidate: any) =>
    typeof candidate === 'function' && code.every((snippet) => toString.call(candidate).includes(snippet))

// some exports are proxies (Discord's i18n messages) that answer any key
const real = (candidate: any) => candidate != null && candidate['cordial:probe'] === undefined

// a module's exports, or one of their members, that the filter accepts
export function inModule(id: string, filter: (candidate: any) => boolean) {
  const exports = wreq.c[id]?.exports
  try {
    if (!real(exports)) return null
    if (filter(exports)) return exports
    if (typeof exports !== 'object') return null
    for (const key in exports) if (real(exports[key]) && filter(exports[key])) return exports[key]
  } catch {}
  return null
}

export function find(filter: (candidate: any) => boolean): [any, string] | null {
  for (const id in wreq.c) {
    const found = inModule(id, filter)
    if (found != null) return [found, id]
  }
  return null
}

export function findModuleId(code: string) {
  for (const id in wreq.m) if (toString.call(wreq.m[id]).includes(code)) return id
  return null
}
