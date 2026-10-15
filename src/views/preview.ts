// The composer's live preview: its text as HTML for the layer under the box, with the markers kept (dimmed) and the
// text between them styled, as stock's editor shows markdown while typing. Only styles that keep each glyph's width
// (colour, backgrounds, lines, a stroke for bold; italic is within a fraction of a pixel), so the layer stays under the
// box's own text. Code blocks get a generic highlight (comments, strings, numbers, keywords): Discord's highlighter
// loads only with its own UI.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escape = (text: string) => text.replace(/[&<>]/g, (character) => ESCAPES[character])
const span = (name: string, html: string) => `<span class="${name}">${html}</span>`
const marker = (text: string) => span('marker', escape(text))

// a code block's words that light up in most languages
const KEYWORDS = new Set(
  (
    'if else for while do return function fn func def class struct enum interface type impl trait const let var mut ' +
    'pub use import from export as in of new this self super null nil None true false True False async await try ' +
    'catch finally throw match case switch break continue static void int string bool float double char public ' +
    'private protected package module where with yield lambda and or not is'
  ).split(' '),
)
const CODE_TOKEN =
  /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|--.*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\w.]*\b)|([A-Za-z_]\w*)/g

function highlight(code: string) {
  let html = ''
  let last = 0
  for (const match of code.matchAll(CODE_TOKEN)) {
    const [whole, comment, string, number, word] = match
    if (word && !KEYWORDS.has(word)) continue
    html += escape(code.slice(last, match.index))
    const name = (comment && 'comment') || (string && 'string') || (number && 'number') || 'keyword'
    html += span(name, escape(whole))
    last = match.index + whole.length
  }
  return html + escape(code.slice(last))
}

// the inline styles, each a marker on both sides of text that's styled in turn; inline code, links and mentions are
// styled as they are
const STYLES: { pattern: RegExp; name: string }[] = [
  { pattern: /\|\|(.+?)\|\|/s, name: 'spoiler' },
  { pattern: /\*\*(.+?)\*\*/s, name: 'bold' },
  { pattern: /__(.+?)__/s, name: 'underline' },
  { pattern: /\*(?=\S)(.+?)(?<=\S)\*/s, name: 'italic' },
  { pattern: /\b_(?=\S)(.+?)(?<=\S)_\b/s, name: 'italic' },
  { pattern: /~~(.+?)~~/s, name: 'strike' },
]
const INLINE_CODE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/
const LINK = /https?:\/\/[^\s<]+[^\s<.,:;"')\]]/
const MENTION = /(?<![\w@#])[@#][\w.-]+/

// where a pattern first matches, and its HTML when it's the one used
interface Found {
  index: number
  length: number
  html(): string
}
function find(pattern: RegExp, text: string, html: (match: RegExpExecArray) => string): Found | undefined {
  const match = pattern.exec(text)
  return match ? { index: match.index, length: match[0].length, html: () => html(match) } : undefined
}

function inline(text: string): string {
  // the earliest of everything that matches, then the rest after it
  const first = [
    find(INLINE_CODE, text, ([, fence, code]) => span('code', marker(fence) + escape(code) + marker(fence))),
    find(LINK, text, ([link]) => span('link', escape(link))),
    find(MENTION, text, ([mention]) => span('mention', escape(mention))),
    ...STYLES.map((style) =>
      find(style.pattern, text, ([whole, inner]) => {
        const mark = whole.slice(0, (whole.length - inner.length) / 2)
        return span(style.name, marker(mark) + inline(inner) + marker(mark))
      }),
    ),
  ].reduce<Found | undefined>(
    (earliest, found) => (found && (!earliest || found.index < earliest.index) ? found : earliest),
    undefined,
  )
  if (!first) return escape(text)
  return escape(text.slice(0, first.index)) + first.html() + inline(text.slice(first.index + first.length))
}

const CODE_BLOCK = /```([\w+-]*\n)?([\s\S]*?)```/g

// the box's text as the preview's HTML; a trailing newline gets a space after it, or the layer's last line collapses
export function preview(text: string) {
  let html = ''
  let last = 0
  for (const match of text.matchAll(CODE_BLOCK)) {
    html += inline(text.slice(last, match.index))
    const language = match[1] ?? ''
    html += span('code-block', marker('```' + language) + highlight(match[2]) + marker('```'))
    last = match.index + match[0].length
  }
  html += inline(text.slice(last))
  return text.endsWith('\n') ? `${html} ` : html
}
