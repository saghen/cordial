// The message list's scroll container (chat.tsx), its rows oldest first. The browser's scroll anchoring keeps the
// reader's place as rows come and go above or below the view and settle to their heights: during layout, before
// paint, moving a scroll in flight with it. After each render and resize the place is checked here too, for what it
// leaves: at the bottom the list follows what it gains; elsewhere the row at the view's top goes back where it was
// (the browser doesn't anchor at the very top, and loses its anchor when a page comes in above as one goes below).
// Like stock's list, it reports its position, turns automatic acks on for its channel and loads more history near
// either end: without a UI nothing else does.

import { onCleanup } from 'solid-js'

import * as messages from '../api/messages'
import type { Id } from '../api/types'

const REPORT_DEBOUNCE_MS = 200
// how long a scroll counts as the reader's after their wheel, key or touch (a wheel's smooth scroll runs on after it)
const INPUT_MS = 500

export function createScroller(scroller: HTMLElement, channel: () => Id | null) {
  const list = scroller.firstElementChild as HTMLElement
  const fromBottom = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop

  // only toward where the reader is heading (api/messages.ts loadMore)
  function more(channelId: Id) {
    messages.loadMore(channelId, down, () => {
      const rows = list.children
      const box = list.getBoundingClientRect()
      const kept = Math.min(messages.KEPT_ROWS, rows.length)
      return {
        fromTop: scroller.scrollTop,
        fromBottom: fromBottom(),
        view: scroller.clientHeight,
        keptTop: kept ? rows[kept - 1].getBoundingClientRect().bottom - box.top : 0,
        keptBottom: kept ? box.bottom - rows[rows.length - kept].getBoundingClientRect().top : 0,
      }
    })
  }

  const report = (channelId: Id) =>
    messages.reportPosition(channelId, Math.round(scroller.scrollTop), scroller.scrollHeight, scroller.clientHeight)

  // where the reader left the list: at the bottom (within a pixel), or a row and how far below the view's top it was
  // (the one at the top, or a jump's target)
  let atBottom = true
  let place: { id: string; offset: number } | null = null
  function note(row = topRow()) {
    atBottom = fromBottom() < 1
    place = row?.dataset.id
      ? { id: row.dataset.id, offset: row.getBoundingClientRect().top - scroller.getBoundingClientRect().top }
      : null
  }
  const byId = (id: string) => list.querySelector<HTMLElement>(`:scope > [data-id="${id}"]`)
  // the first row reaching below the view's top
  function topRow() {
    const top = scroller.getBoundingClientRect().top
    const rows = list.children
    let low = 0
    let high = rows.length - 1
    while (low < high) {
      const middle = (low + high) >> 1
      if (rows[middle].getBoundingClientRect().bottom > top) high = middle
      else low = middle + 1
    }
    return rows[low] as HTMLElement | undefined
  }
  // after the rows change or settle: the bottom followed, or the noted row kept where it was (another, once it's gone)
  function hold() {
    if (atBottom) {
      scroller.scrollTop = scroller.scrollHeight
      return
    }
    const row = place && byId(place.id)
    if (!place || !row) {
      note()
      return
    }
    const moved = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - place.offset
    if (Math.abs(moved) >= 1) scroller.scrollTop += moved
  }

  // once per frame, never inside a dispatch (lists render from store listeners). The position is reported after a
  // render or resize, and while scrolling 200 ms after the last scroll event, as stock debounces it
  let queued = false
  let dimensionsChanged = false
  let acking: Id | null = null
  let timer = 0
  function update() {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      const channelId = channel()
      // stock's order on a switch: acks off for the old channel, the new one's position, then acks on
      if (acking && acking !== channelId) {
        messages.automaticAck(acking, false)
        acking = null
      }
      if (!channelId) return
      if (dimensionsChanged) report(channelId)
      dimensionsChanged = false
      if (!acking && messages.ready(channelId)) {
        acking = channelId
        messages.automaticAck(channelId, true)
      }
      more(channelId)
    })
  }

  // which way the reader is going, and when they last moved the list, from the wheel, keys, touch and the scrollbar:
  // scroll events also come from anchoring, the list changing and jumps, which leave the noted place as it is, but a
  // smooth scroll to the bottom is followed to its end. A wheel at either end doesn't scroll, but may still need more
  // history
  let down = false
  let dragging = false
  let smooth = false
  let last = 0
  let input = -Infinity
  scroller.addEventListener(
    'wheel',
    (e) => {
      down = e.deltaY > 0
      input = e.timeStamp
      smooth = false
      update()
    },
    { passive: true },
  )
  scroller.addEventListener('pointerdown', () => {
    dragging = true
    smooth = false
  })
  const released = () => {
    dragging = false
  }
  addEventListener('pointerup', released)
  scroller.addEventListener(
    'touchmove',
    (e) => {
      input = e.timeStamp
    },
    { passive: true },
  )
  // keys in a field are the field's
  function key(e: KeyboardEvent) {
    if ((e.target as Element).closest('input, textarea, [contenteditable=true]')) return
    if (/^(PageDown|ArrowDown|End| )$/.test(e.key)) down = true
    else if (/^(PageUp|ArrowUp|Home)$/.test(e.key)) down = false
    else return
    input = e.timeStamp
    smooth = false
  }
  addEventListener('keydown', key)
  scroller.addEventListener(
    'scroll',
    (e) => {
      if (smooth || dragging || e.timeStamp - input < INPUT_MS) note()
      if (dragging) down = scroller.scrollTop > last
      last = scroller.scrollTop
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const channelId = channel()
        if (channelId) report(channelId)
      }, REPORT_DEBOUNCE_MS)
      update()
    },
    { passive: true },
  )

  // rows settle to their real heights after rendering (content-visibility), and the window resizes: after layout,
  // before paint
  const resized = new ResizeObserver(() => {
    hold()
    dimensionsChanged = true
    update()
  })
  resized.observe(scroller)
  resized.observe(list)
  // rows below can settle taller while a smooth scroll runs: the rest of the way at its end, if it ended near
  scroller.addEventListener('scrollend', () => {
    if (!smooth) return
    smooth = false
    if (fromBottom() < scroller.clientHeight) toBottom()
  })

  function toBottom() {
    scroller.scrollTop = scroller.scrollHeight
    note()
  }

  onCleanup(() => {
    removeEventListener('pointerup', released)
    removeEventListener('keydown', key)
    resized.disconnect()
    clearTimeout(timer)
    if (acking) messages.automaticAck(acking, false)
  })

  return {
    // after each render; a switch to another channel starts at the bottom, as does a render asked to go there
    rendered(switched: boolean, bottom = false) {
      if (switched) down = false
      if (switched || bottom) {
        atBottom = true
        place = null
      }
      hold()
      dimensionsChanged = true
      update()
    },
    // after the view scrolls the list itself: where it stands now (a jump: its target held as rows around it settle)
    moved: note,
    // a message's row, if it's rendered
    row: byId,
    fromBottom,
    // the newest message in view: at once, or smoothly, followed as rows settle on the way
    toBottom(smoothly = false) {
      if (smoothly && fromBottom() >= 1) {
        smooth = true
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
      } else toBottom()
    },
  }
}
