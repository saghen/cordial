// The generic hooks; a domain's own hooks live in its file. A use* function creates effects or cleanup, so it runs in
// a component.

import { createEffect, createSignal, getOwner, onCleanup } from 'solid-js'

import { A } from '../adapter/needs'
import type { AnyRecord } from '../adapter/discord'

// listener on every dispatch of an action type: in a component until it unmounts, elsewhere for good
export function onAction(type: string, listener: (action: AnyRecord) => void) {
  A.dispatcher.subscribe(type, listener)
  if (getOwner()) onCleanup(() => A.dispatcher.unsubscribe(type, listener))
}

// the time, updated every second until `until` (a time in ms: Infinity for good, 0 not at all)
export function useNow(until: () => number) {
  const [now, setNow] = createSignal(Date.now())
  createEffect(until, (end) => {
    setNow(Date.now())
    if (end <= Date.now()) return
    const timer = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= end) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  })
  return now
}

// files dropped anywhere on the window (left to the browser, a drop would navigate to the file)
export function useFileDrop(onDrop: (files: File[]) => void) {
  const over = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault()
  function drop(e: DragEvent) {
    if (!e.dataTransfer?.files.length) return
    e.preventDefault()
    onDrop([...e.dataTransfer.files])
  }
  addEventListener('dragover', over)
  addEventListener('drop', drop)
  onCleanup(() => {
    removeEventListener('dragover', over)
    removeEventListener('drop', drop)
  })
}

// whether the window has focus (GIFs play only while it does), for the app's lifetime
const [focused, setFocused] = createSignal(document.hasFocus())
addEventListener('focus', () => setFocused(true))
addEventListener('blur', () => setFocused(false))
export const windowFocused = focused
