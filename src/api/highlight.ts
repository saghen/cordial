// Code blocks' syntax highlighting (ours: stock's is highlight.js, loaded with its UI): Shiki in a worker
// (src/workers/highlight.ts), started at the first block from the source the shell reads. A block's lines come back as
// tokens, cached by language and code; null for a language it doesn't know, or when the worker fails.

import { highlighterSource } from '../adapter/native'
import type { Token } from '../workers/highlight'
import { language as known } from '../workers/languages'

export type { Token }

export type Lines = Token[][] | null

// the coloured stretches of a block's code, by offset in it (a colour: `token-keyword`, app.css's --code-token-*)
export function colours(code: string, lines: Token[][]) {
  const found: { from: number; to: number; colour: string }[] = []
  let start = 0
  code.split('\n').forEach((line, i) => {
    let at = start
    for (const [length, colour] of lines[i] ?? []) {
      if (colour) found.push({ from: at, to: Math.min(at + length, start + line.length), colour })
      at += length
    }
    start += line.length + 1
  })
  return found
}

// the blocks highlighted last, oldest first
const CACHE_SIZE = 200
const cache = new Map<string, Lines>()
// the blocks asked for and not answered yet, each with who waits for it
const waiting = new Map<string, ((lines: Lines) => void)[]>()
// the worker's requests by id, each its block's key
const requests = new Map<number, string>()
let next = 0
let worker: Promise<Worker | null> | undefined
let failed = false

function answer(key: string, lines: Lines) {
  const ready = waiting.get(key) ?? []
  waiting.delete(key)
  cache.set(key, lines)
  if (cache.size > CACHE_SIZE) {
    const [oldest] = cache.keys()
    cache.delete(oldest)
  }
  for (const callback of ready) callback(lines)
}

// on a failure, every block waiting and every one after shows plain
function fail(error: unknown) {
  console.error('cordial: the code highlighter failed', error)
  failed = true
  requests.clear()
  for (const key of waiting.keys()) answer(key, null)
}

async function start(source: () => Promise<string>) {
  try {
    const started = new Worker(URL.createObjectURL(new Blob([await source()], { type: 'text/javascript' })))
    started.addEventListener('message', (e: MessageEvent<{ id: number; lines: Lines }>) => {
      const key = requests.get(e.data.id)
      requests.delete(e.data.id)
      if (key !== undefined) answer(key, e.data.lines)
    })
    started.addEventListener('error', fail)
    return started
  } catch (error) {
    fail(error)
    return null
  }
}

// a block's lines: at once when highlighted before, else undefined and `ready` gets them
export function lines(name: string, code: string, ready: (lines: Lines) => void): Lines | undefined {
  const source = highlighterSource
  const language = known(name)
  if (!language || !source || failed) return null
  const key = `${language}\n${code}`
  if (cache.has(key)) return cache.get(key)
  const queued = waiting.get(key)
  if (queued) {
    queued.push(ready)
    return undefined
  }
  waiting.set(key, [ready])
  const id = next++
  requests.set(id, key)
  worker ??= start(source)
  void worker.then((started) => started?.postMessage({ id, language, code }))
  return undefined
}
