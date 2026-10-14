// Discord's markdown AST (api/messages.ts contentAST) to plain DOM: content never changes, so it needs no reactivity.
// An unknown node type renders its text. Inline, as a reply preview shows it: one line, its blocks flattened.

import { openLink } from '../api/channels'
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

const text = (n: MarkdownNode): string =>
  typeof n.content === 'string' ? n.content : (n.content?.map(text).join('') ?? '')

function el<K extends keyof HTMLElementTagNameMap>(tag: K, content: unknown): HTMLElementTagNameMap[K]
function el(tag: string, content: unknown): HTMLElement
function el(tag: string, content: unknown) {
  const e = document.createElement(tag)
  if (typeof content === 'string') e.append(content)
  else if (Array.isArray(content)) renderAST(content, e)
  return e
}

function node(n: MarkdownNode): Node | string {
  switch (n.type) {
    case 'text':
      return text(n)
    case 'br':
    case 'newline':
      return '\n'
    case 'heading':
      return el(`h${Math.min(3, n.level ?? 1)}`, n.content)
    case 'codeBlock':
      return el('pre', n.content)
    case 'list': {
      const l = el(n.ordered ? 'ol' : 'ul', null)
      if (l instanceof HTMLOListElement && n.start != null) l.start = n.start
      for (const item of n.items ?? []) l.append(el('li', item))
      return l
    }
    case 'emoji':
    case 'customEmoji': {
      const img = el('img', null)
      img.alt = n.name ?? n.surrogate ?? ''
      img.src = n.src ?? emojiSrc({ id: n.emojiId, animated: n.animated })
      return img
    }
    case 'channelMention': {
      // as stock: the channel by its icon and name; a link to another server's channel or to a message, the server
      // (or the channel) first, then › and the channel or a message's icon. A click opens it
      const m = el('mark', null)
      m.className = 'channel-link'
      if (n.inContent) m.append(...n.inContent.map(part), ' › ')
      if (Array.isArray(n.content)) m.append(...n.content.map(part))
      const channelId = n.channelId
      if (channelId) m.onclick = () => openLink(n.guildId, channelId, n.messageId)
      return m
    }
    case 'mention':
    case 'roleMention': {
      const m = el('mark', text(n))
      if (n.roleColor) m.style.color = `#${n.roleColor.toString(16).padStart(6, '0')}`
      return m
    }
    case 'timestamp':
      return el('time', n.formatted ?? text(n))
  }
  const tag = TAGS[n.type]
  if (!tag) return text(n)
  const e = el(tag, n.content)
  if (tag === 'a') Object.assign(e, { href: n.target, target: '_blank', rel: 'noreferrer noopener' })
  // a spoiler shows on click
  if (tag === 'del') e.onclick = () => e.toggleAttribute('open', true)
  return e
}

// a channel link's part: a channel (its icon by kind, its name; a message's icon alone) or a server (its icon, its name)
const CHANNEL_ICONS: Record<string, IconName> = { voice: 'voice', message: 'chat', announcement: 'announce' }
function part(n: MarkdownNode): Node | string {
  if (n.type === 'guild') {
    const s = el('span', n.content)
    if (n.icon) s.prepend(Object.assign(el('img', null), { src: n.icon, alt: '' }))
    return s
  }
  if (n.type !== 'channel') return node(n)
  const s = el('span', n.content)
  s.prepend((<Icon name={CHANNEL_ICONS[n.iconType ?? ''] ?? 'hash'} />) as HTMLElement)
  return s
}

export function renderAST(nodes: MarkdownNode[], parent: HTMLElement | DocumentFragment) {
  for (const n of nodes) parent.append(node(n))
  return parent
}

export const Markdown = (p: { ast: MarkdownNode[]; inline?: boolean }) => (
  <span class={['markdown', { inline: Boolean(p.inline) }]} ref={(s) => renderAST(p.ast, s)} />
)
