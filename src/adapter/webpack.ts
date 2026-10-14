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
  const p = { find, replace, applied: false }
  patches.push(p)
  return p
}

const toString = Function.prototype.toString

// webpack's runtime does `__webpack_require__.m = modules` once per runtime: Discord's main one, and a few small ones
Object.defineProperty(Function.prototype, 'm', {
  configurable: true,
  set(this: any, modules: Record<string, Function>) {
    Object.defineProperty(this, 'm', { value: modules, configurable: true, writable: true, enumerable: true })
    if (!toString.call(this).includes('exports:{}')) return
    // Discord's is the biggest when set: the small ones grow later, through the chunk array they share with it
    const n = Object.keys(modules).length
    if (n > size) [wreq, size] = [this, n]
    for (const p of patches.filter((p) => !p.applied)) {
      const id = Object.keys(modules).find((id) => toString.call(modules[id]).includes(p.find))
      if (id === undefined) continue
      let out = toString.call(modules[id])
      p.applied = p.replace.every(([re, to]) => {
        const next = out.replace(re, to)
        const changed = next !== out
        out = next
        return changed
      })
      // oxlint-disable-next-line no-eval -- the patched factory's source, evaluated in global scope as webpack's own
      if (p.applied) modules[id] = globalThis.eval(`0,${out.replace(/^\d+/, 'function')}\n//# sourceURL=cordial-${id}`)
    }
  },
})

export const byProps =
  (...props: string[]) =>
  (m: any) =>
    props.every((p) => m[p] !== undefined)
export const byCode =
  (...code: string[]) =>
  (m: any) =>
    typeof m === 'function' && code.every((c) => toString.call(m).includes(c))

// some exports are proxies (Discord's i18n messages) that answer any key
const real = (m: any) => m != null && m['cordial:probe'] === undefined

// a module's exports, or one of their members, that the filter accepts
export function inModule(id: string, filter: (m: any) => boolean) {
  const exports = wreq.c[id]?.exports
  try {
    if (!real(exports)) return null
    if (filter(exports)) return exports
    if (typeof exports !== 'object') return null
    for (const k in exports) if (real(exports[k]) && filter(exports[k])) return exports[k]
  } catch {}
  return null
}

export function find(filter: (m: any) => boolean): [any, string] | null {
  for (const id in wreq.c) {
    const m = inModule(id, filter)
    if (m != null) return [m, id]
  }
  return null
}

export function findModuleId(code: string) {
  for (const id in wreq.m) if (toString.call(wreq.m[id]).includes(code)) return id
  return null
}
