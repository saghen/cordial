// Code blocks' syntax highlighting (ours: stock's is highlight.js, loaded with its UI): Shiki in a worker
// (src/workers/highlight.ts), started at the first block from the source the shell reads. A block's lines come back as
// HTML, cached by language and code; null for a language it doesn't know.

import { highlighterSource } from '../adapter/native'

export type Lines = string[] | null

// the blocks highlighted last, oldest first
const CACHE_SIZE = 200
const cache = new Map<string, Lines>()
const waiting = new Map<number, { key: string; ready(lines: Lines): void }>()
let worker: Promise<Worker> | undefined
let next = 0

async function start() {
  const source = await highlighterSource!()
  const started = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))
  started.addEventListener('message', (e: MessageEvent<{ id: number; lines: Lines }>) => {
    const request = waiting.get(e.data.id)
    if (!request) return
    waiting.delete(e.data.id)
    cache.set(request.key, e.data.lines)
    if (cache.size > CACHE_SIZE) {
      const [oldest] = cache.keys()
      cache.delete(oldest)
    }
    request.ready(e.data.lines)
  })
  return started
}

// a block's lines: at once when highlighted before, else undefined and `ready` gets them
export function lines(language: string, code: string, ready: (lines: Lines) => void): Lines | undefined {
  if (!language || !highlighterSource) return null
  const key = `${language}\n${code}`
  if (cache.has(key)) return cache.get(key)
  const id = next++
  waiting.set(id, { key, ready })
  worker ??= start()
  void worker.then((started) => started.postMessage({ id, language, code }))
  return undefined
}
