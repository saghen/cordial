// Discord's markdown AST (api/messages.ts contentAST) to plain DOM: content never changes, so it needs no reactivity.
// An unknown node type renders its text. Inline, as a reply preview shows it: one line, its blocks flattened. Code
// blocks are highlighted once the worker answers (api/highlight.ts).

import { openLink } from '../api/channels'
import { hex } from '../api/color'
import * as highlight from '../api/highlight'
import { emojiSrc } from '../api/pickers'
import type { MarkdownNode } from '../api/types'
import { Icon } from '../primitives/icon'
import type { IconName } from '../primitives/icons'

const TAGS: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  u: 'u',
  s: 's',
  subtext: 'small',
  inlineCode: 'code',
  blockQuote: 'blockquote',
  spoiler: 'del',
  link: 'a',
  url: 'a',
  autolink: 'a',
}

const text = (node: MarkdownNode): string =>
  typeof node.content === 'string' ? node.content : (node.content?.map(text).join('') ?? '')

function create<K extends keyof HTMLElementTagNameMap>(tag: K, content: unknown): HTMLElementTagNameMap[K]
function create(tag: string, content: unknown): HTMLElement
function create(tag: string, content: unknown) {
  const element = document.createElement(tag)
  if (typeof content === 'string') element.append(content)
  else if (Array.isArray(content)) renderAST(content, element)
  return element
}

// a code block, plain until the highlighter's lines arrive: then its coloured stretches as spans
function codeBlock(node: MarkdownNode) {
  const code = text(node)
  const pre = create('pre', node.content)
  function show(lines: highlight.Lines) {
    if (!lines) return
    const parts: (Node | string)[] = []
    let at = 0
    for (const { from, to, colour } of highlight.colours(code, lines)) {
      const span = create('span', code.slice(from, to))
      span.style.color = `var(--code-${colour})`
      parts.push(code.slice(at, from), span)
      at = to
    }
    pre.replaceChildren(...parts, code.slice(at))
  }
  const lines = highlight.lines(node.lang ?? '', code, show)
  if (lines !== undefined) show(lines)
  return pre
}

function renderNode(node: MarkdownNode): Node | string {
  switch (node.type) {
    case 'text':
      return text(node)
    case 'br':
    case 'newline':
      return '\n'
    case 'heading':
      return create(`h${Math.min(3, node.level ?? 1)}`, node.content)
    case 'codeBlock':
      return codeBlock(node)
    case 'list': {
      const list = create(node.ordered ? 'ol' : 'ul', null)
      if (list instanceof HTMLOListElement && node.start != null) list.start = node.start
      for (const item of node.items ?? []) list.append(create('li', item))
      return list
    }
    case 'emoji':
    case 'customEmoji': {
      const img = create('img', null)
      img.alt = node.name ?? node.surrogate ?? ''
      img.src = node.src ?? emojiSrc({ id: node.emojiId, animated: node.animated })
      return img
    }
    case 'channelMention': {
      // as stock: the channel by its icon and name; a link to another server's channel or to a message, the server
      // (or the channel) first, then › and the channel or a message's icon. A click opens it
      const mark = create('mark', null)
      mark.className = 'channel-link'
      if (node.inContent) mark.append(...node.inContent.map(part), ' › ')
      if (Array.isArray(node.content)) mark.append(...node.content.map(part))
      const channelId = node.channelId
      if (channelId) mark.onclick = () => openLink(node.guildId, channelId, node.messageId)
      return mark
    }
    case 'mention':
    case 'roleMention': {
      const mark = create('mark', text(node))
      if (node.roleColor) mark.style.color = hex(node.roleColor)
      return mark
    }
    case 'timestamp':
      return create('time', node.formatted ?? text(node))
  }
  const tag = TAGS[node.type]
  if (!tag) return text(node)
  const element = create(tag, node.content)
  if (tag === 'a') Object.assign(element, { href: node.target, target: '_blank', rel: 'noreferrer noopener' })
  // a spoiler shows on click
  if (tag === 'del') element.onclick = () => element.toggleAttribute('open', true)
  return element
}

// a channel link's part: a channel (its icon by kind, its name; a message's icon alone) or a server (its icon, its name)
const CHANNEL_ICONS: Record<string, IconName> = { voice: 'voice', message: 'chat', announcement: 'announce' }
function part(node: MarkdownNode): Node | string {
  if (node.type === 'guild') {
    const span = create('span', node.content)
    if (node.icon) span.prepend(Object.assign(create('img', null), { src: node.icon, alt: '' }))
    return span
  }
  if (node.type !== 'channel') return renderNode(node)
  const span = create('span', node.content)
  span.prepend((<Icon name={CHANNEL_ICONS[node.iconType ?? ''] ?? 'hash'} />) as HTMLElement)
  return span
}

export function renderAST(nodes: MarkdownNode[], parent: HTMLElement | DocumentFragment) {
  for (const node of nodes) parent.append(renderNode(node))
  return parent
}

export function Markdown(p: { ast: MarkdownNode[]; inline?: boolean }) {
  return <span class={['markdown', { inline: Boolean(p.inline) }]} ref={(span) => renderAST(p.ast, span)} />
}
