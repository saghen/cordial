// The generic hooks; a domain's own hooks live in its file. A use* function creates effects or cleanup, so it runs in
// a component.

import { createEffect, createSignal, getOwner, onCleanup } from 'solid-js'

import { A } from '../adapter/needs'
import type { Rec } from '../adapter/discord'

// fn on every dispatch of an action type: in a component until it unmounts, elsewhere for good
export function onAction(type: string, fn: (action: Rec) => void) {
  A.dispatcher.subscribe(type, fn)
  if (getOwner()) onCleanup(() => A.dispatcher.unsubscribe(type, fn))
}

// the time, updated every second while `ticking` is true
export function useNow(ticking: () => boolean) {
  const [now, setNow] = createSignal(Date.now())
  createEffect(ticking, (on) => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  })
  return now
}

// files dropped anywhere on the window (left to the browser, a drop would navigate to the file)
export function useFileDrop(fn: (files: File[]) => void) {
  const over = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault()
  const drop = (e: DragEvent) => {
    if (!e.dataTransfer?.files.length) return
    e.preventDefault()
    fn([...e.dataTransfer.files])
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
