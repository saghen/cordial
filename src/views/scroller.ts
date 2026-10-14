// The message list's scroll container (chat.tsx). column-reverse keeps the view at the bottom (scrollTop 0 is the
// bottom). Like stock's list, it reports its position, turns automatic acks on for its channel and loads more history
// near either end: without a UI nothing else does. Scrolled up, it keeps the reader's place by the row at the view's
// top: in column-reverse, rows coming and going below it (a fetch of older messages truncates the newest, new ones
// arrive, rows settle to their heights) would move everything above them.

import * as messages from '../api/messages'
import type { Id } from '../api/records'

export function createScroller(scroller: HTMLElement, channel: () => Id | null) {
  // only toward where the reader is heading (api/messages.ts loadMore)
  const more = (channelId: Id) =>
    messages.loadMore(
      channelId,
      scroller.scrollHeight - scroller.clientHeight + scroller.scrollTop,
      -scroller.scrollTop,
      down,
    )

  // column-reverse: scrollTop runs from 0 at the bottom to -(height - view) at the top
  function report(channelId: Id) {
    const height = scroller.scrollHeight,
      view = scroller.clientHeight
    messages.reportPosition(
      channelId,
      scroller.scrollTop > -1 ? height - view : Math.round(height - view + scroller.scrollTop),
      height,
      view,
    )
  }

  // the row at the view's top (by message: a row is built again when its record is replaced) and where it was, while
  // scrolled up
  let anchor: { id: string; top: number } | null = null
  const rowOf = (id: string) => scroller.querySelector(`article[data-id="${id}"]`)
  function pin() {
    anchor = null
    if (scroller.scrollTop > -1) return
    const top = scroller.getBoundingClientRect().top,
      rows = scroller.firstElementChild!.children
    // the first row reaching below the view's top
    let lo = 0,
      hi = rows.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (rows[mid].getBoundingClientRect().bottom > top) hi = mid
      else lo = mid + 1
    }
    const row = rows[lo] as HTMLElement | undefined
    if (row?.dataset.id) anchor = { id: row.dataset.id, top: row.getBoundingClientRect().top }
  }
  function keepPlace() {
    const row = anchor && rowOf(anchor.id)
    if (row) {
      const moved = row.getBoundingClientRect().top - anchor!.top
      if (Math.abs(moved) >= 1) scroller.scrollTop += moved
    }
    pin()
  }

  // once per frame, never inside a dispatch (lists render from store listeners). The position is reported after a
  // render or resize, and while scrolling 200 ms after the last scroll event, as stock debounces it
  let queued = false,
    toBottom = false,
    dims = false,
    acking: Id | null = null,
    timer = 0
  function update() {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      if (toBottom) scroller.scrollTop = 0
      toBottom = false
      const channelId = channel()
      // stock's order on a switch: acks off for the old channel, the new one's position, then acks on
      if (acking && acking !== channelId) {
        messages.automaticAck(acking, false)
        acking = null
      }
      if (!channelId) return
      if (dims) report(channelId)
      dims = false
      if (!acking && messages.ready(channelId)) {
        acking = channelId
        messages.automaticAck(channelId, true)
      }
      more(channelId)
    })
  }

  // which way the reader is going, from the wheel, keys and the scrollbar (scroll events also come from anchoring and
  // truncation). A wheel at either end doesn't scroll, but may still need more history
  let down = false,
    dragging = false,
    last = 0
  scroller.addEventListener(
    'wheel',
    (e) => {
      down = e.deltaY > 0
      update()
    },
    { passive: true },
  )
  scroller.addEventListener('pointerdown', () => (dragging = true))
  addEventListener('pointerup', () => (dragging = false))
  addEventListener('keydown', (e) => {
    if (/^(PageDown|ArrowDown|End| )$/.test(e.key)) down = true
    else if (/^(PageUp|ArrowUp|Home)$/.test(e.key)) down = false
  })

  scroller.addEventListener(
    'scroll',
    () => {
      pin()
      if (dragging) down = scroller.scrollTop > last
      last = scroller.scrollTop
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const channelId = channel()
        if (channelId) report(channelId)
      }, 200)
      update()
    },
    { passive: true },
  )

  // rows settle to their real heights after rendering (content-visibility), and the window resizes: neither scrolls
  const resized = new ResizeObserver(() => {
    keepPlace()
    dims = true
    update()
  })
  resized.observe(scroller)
  resized.observe(scroller.firstElementChild!)

  // after each render; a switch to another channel starts at the bottom
  return (switched: boolean) => {
    toBottom ||= switched
    if (switched) {
      down = false
      anchor = null
    } else keepPlace()
    dims = true
    update()
  }
}
