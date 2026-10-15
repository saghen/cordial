// The composer's box as text: a plain-text editable (`contenteditable="plaintext-only"`: the browser keeps it to text
// nodes, newlines as "\n"), read and edited by offsets in that text as a textarea's value would be. Edits from the
// code (a pick, an emoji) go through the browser's insertText where the box has the focus, so undo keeps them. Its
// preview is painted with the CSS Custom Highlight API: one highlight per style over ranges of its own text, which can
// colour and decorate glyphs but never move them.

import type { Mark } from './preview'

export const valueOf = (box: HTMLElement) => box.textContent ?? ''

// where offsets in the text are, as a node and an offset in it: its text nodes indexed once
function locate(box: HTMLElement) {
  const nodes: { node: Text; start: number }[] = []
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
  let start = 0
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    nodes.push({ node, start })
    start += node.length
  }
  return (offset: number): [Node, number] => {
    let low = 0
    let high = nodes.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (nodes[middle].start <= offset) low = middle
      else high = middle - 1
    }
    const found = nodes[low]
    return found ? [found.node, Math.min(offset - found.start, found.node.length)] : [box, 0]
  }
}
function range(at: (offset: number) => [Node, number], from: number, to: number) {
  const found = new Range()
  found.setStart(...at(from))
  found.setEnd(...at(to))
  return found
}
// the offset a node and an offset in it are at
function offsetOf(box: HTMLElement, node: Node, offset: number) {
  const before = new Range()
  before.setStart(box, 0)
  before.setEnd(node, offset)
  return before.toString().length
}

// the selection in the box, by offsets; none when it's elsewhere
export function selection(box: HTMLElement) {
  const current = getSelection()
  if (!current?.rangeCount || !current.anchorNode || !current.focusNode || !box.contains(current.focusNode)) return null
  const anchor = offsetOf(box, current.anchorNode, current.anchorOffset)
  const focus = offsetOf(box, current.focusNode, current.focusOffset)
  return { from: Math.min(anchor, focus), to: Math.max(anchor, focus) }
}

export function select(box: HTMLElement, from: number, to = from) {
  getSelection()?.removeAllRanges()
  getSelection()?.addRange(range(locate(box), from, to))
}

// text at the caret, line by line: the browser's insertText puts each later line of its text in a paragraph <div>, a
// line break puts "\n" (as Enter does)
function insertLines(text: string) {
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      if (i) document.execCommand('insertLineBreak')
      if (line) document.execCommand('insertText', false, line)
    })
}
// before a paste, drop or anything else that would put several lines in: the lines as above
export function keepLines(e: InputEvent) {
  const text = e.data ?? e.dataTransfer?.getData('text/plain')
  if (!text || !/[\r\n]/.test(text)) return
  e.preventDefault()
  insertLines(text)
}

// text in place of from..to, the caret after it, as the browser's own edit (undo takes it back); the focus stays where
// it was (a picker's search)
export function replace(box: HTMLElement, from: number, to: number, text: string) {
  const focused = document.activeElement
  box.focus({ preventScroll: true })
  select(box, from, to)
  insertLines(text)
  if (focused instanceof HTMLElement && focused !== box) focused.focus({ preventScroll: true })
}

// the marks as highlights: one per name (`composer-bold`), markers over the styles they open and close
const MARKER_PRIORITY = 1
let painted = new Set<string>()
export function paint(box: HTMLElement, marks: Mark[]) {
  const at = locate(box)
  const groups = new Map<string, Range[]>()
  for (const mark of marks) {
    const name = `composer-${mark.name}`
    const ranges = groups.get(name) ?? []
    ranges.push(range(at, mark.from, mark.to))
    groups.set(name, ranges)
  }
  for (const name of painted) if (!groups.has(name)) CSS.highlights.delete(name)
  for (const [name, ranges] of groups) {
    const highlight = new Highlight(...ranges)
    if (name === 'composer-marker') highlight.priority = MARKER_PRIORITY
    CSS.highlights.set(name, highlight)
  }
  painted = new Set(groups.keys())
}
