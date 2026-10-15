// The composer's live preview, as stock's editor shows markdown while typing: where each style goes in the box's text,
// its markers kept (dimmed), the text between them styled, code blocks in the highlighter's colours (api/highlight.ts;
// an edited block shows the lines it highlighted before, by their text, until it answers, so only the changed line
// shows plain for a moment). The box paints them as highlights over its own text (editable.ts), so no style can move a
// glyph: italic, which only a font can draw, shows as its markers alone.

import * as highlight from '../api/highlight'

export interface Mark {
  // a style (`bold`, `marker`), or a code colour (`code-token-keyword`)
  name: string
  from: number
  to: number
}

// lines highlighted before, by their text
const KNOWN_LINES = 1000
const known = new Map<string, highlight.Token[]>()

function code(language: string, body: string, at: number, rerender: () => void, marks: Mark[]) {
  const plain = body.split('\n')
  // what it highlighted, kept by line: shown for the same lines while a later version waits
  function remember(lines: highlight.Token[][]) {
    if (known.size > KNOWN_LINES) known.clear()
    plain.forEach((line, i) => known.set(line, lines[i] ?? []))
  }
  const lines = highlight.lines(language, body, (ready) => {
    if (ready) remember(ready)
    rerender()
  })
  if (lines === null) return
  if (lines) remember(lines)
  const shown = lines ?? plain.map((line) => known.get(line) ?? [])
  for (const { from, to, colour } of highlight.colours(body, shown))
    marks.push({ name: `code-${colour}`, from: at + from, to: at + to })
}

// the inline styles, each a marker on both sides of text that's styled in turn (italic: only its markers); inline
// code, links and mentions are styled as they are
const STYLES: { pattern: RegExp; name?: string }[] = [
  { pattern: /\|\|(.+?)\|\|/s, name: 'spoiler' },
  { pattern: /\*\*(.+?)\*\*/s, name: 'bold' },
  { pattern: /__(.+?)__/s, name: 'underline' },
  { pattern: /\*(?=\S)(.+?)(?<=\S)\*/s },
  { pattern: /\b_(?=\S)(.+?)(?<=\S)_\b/s },
  { pattern: /~~(.+?)~~/s, name: 'strike' },
]
const INLINE_CODE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/
const LINK = /https?:\/\/[^\s<]+[^\s<.,:;"')\]]/
const MENTION = /(?<![\w@#])[@#][\w.-]+/

// where a pattern first matches, and its marks when it's the one used (at: the match's offset in the box)
interface Found {
  index: number
  length: number
  mark(at: number, marks: Mark[]): void
}
function find(pattern: RegExp, text: string, mark: (match: RegExpExecArray, at: number, marks: Mark[]) => void) {
  const match = pattern.exec(text)
  return match ? { index: match.index, length: match[0].length, mark: mark.bind(null, match) } : undefined
}
const whole = (name: string) => (match: RegExpExecArray, at: number, marks: Mark[]) =>
  marks.push({ name, from: at, to: at + match[0].length })

// the marks of text that starts at `at` in the box
function inline(text: string, at: number, marks: Mark[]) {
  // the earliest of everything that matches, then the rest after it
  const first = [
    find(INLINE_CODE, text, ([all, fence], start, into) => {
      into.push({ name: 'code', from: start, to: start + all.length })
      into.push({ name: 'marker', from: start, to: start + fence.length })
      into.push({ name: 'marker', from: start + all.length - fence.length, to: start + all.length })
    }),
    find(LINK, text, whole('link')),
    find(MENTION, text, whole('mention')),
    ...STYLES.map((style) =>
      find(style.pattern, text, ([all, inner], start, into) => {
        const length = (all.length - inner.length) / 2
        into.push({ name: 'marker', from: start, to: start + length })
        if (style.name) into.push({ name: style.name, from: start + length, to: start + length + inner.length })
        inline(inner, start + length, into)
        into.push({ name: 'marker', from: start + all.length - length, to: start + all.length })
      }),
    ),
  ].reduce<Found | undefined>(
    (earliest, found) => (found && (!earliest || found.index < earliest.index) ? found : earliest),
    undefined,
  )
  if (!first) return
  first.mark(at + first.index, marks)
  inline(text.slice(first.index + first.length), at + first.index + first.length, marks)
}

// a block still being typed (no closing fence yet) runs to the end, so it's highlighted as it's written
const CODE_BLOCK = /```([\w+-]*\n)?([\s\S]*?)(```|$)/g
export const hasCode = (text: string) => text.search(CODE_BLOCK) >= 0

// the box's text's marks (`rerender` again once a code block's highlight arrives)
export function preview(text: string, rerender: () => void) {
  const marks: Mark[] = []
  let last = 0
  for (const match of text.matchAll(CODE_BLOCK)) {
    inline(text.slice(last, match.index), last, marks)
    const opening = 3 + (match[1]?.length ?? 0)
    marks.push({ name: 'marker', from: match.index, to: match.index + opening })
    code((match[1] ?? '').trim(), match[2], match.index + opening, rerender, marks)
    const end = match.index + match[0].length
    if (match[3]) marks.push({ name: 'marker', from: end - 3, to: end })
    last = end
  }
  inline(text.slice(last), last, marks)
  return marks
}
