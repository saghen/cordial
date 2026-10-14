// A message's link embed, as Discord's record keeps what its servers scraped (OpenGraph, oEmbed): a card with the
// text, a small thumbnail beside it or a large image under it; an image or GIF link is just the media. No players: a
// video is its thumbnail, opening the page.

import * as messages from '../../api/messages'
import type { Embed as Record } from '../../api/types'
import { Markdown } from '../markdown'
import { Clip, Media } from '../media'

const TYPES = new Set(['link', 'article', 'video', 'rich', 'image', 'gifv'])

export function Embed(p: { embed: Record }) {
  const e = p.embed
  if (!TYPES.has(e.type)) return null
  // media only, as stock: a GIF, or an image or video with no title or author
  if ((e.image || e.video) && (e.type === 'gifv' || (e.type !== 'rich' && !e.author && !e.rawTitle))) {
    if (e.video?.proxyURL)
      return <Clip src={e.video.proxyURL} media={e.video} poster={e.thumbnail?.proxyURL} gif={e.type === 'gifv'} />
    const m = e.image ?? e.thumbnail
    return m ? <Media media={m} box="media" /> : null
  }
  const big = e.image ?? (e.video && e.thumbnail)
  const small = !e.video && e.thumbnail
  // as stock: no description for YouTube (youtu.be, shorts, music. and m. included)
  const text =
    e.provider?.name !== 'YouTube' && !/\b(youtube(-nocookie)?\.com|youtu\.be)\//.test(e.url ?? '') && e.rawDescription
  if (!e.rawTitle && !text && !e.author && !big && !small) return null
  return (
    <figure class="embed" style={e.color ? { 'border-left-color': e.color } : undefined}>
      {e.provider && <small class="provider">{e.provider.name}</small>}
      {e.author && <b class="author">{e.author.name}</b>}
      {e.rawTitle && (
        <a class="title" href={e.url} target="_blank" rel="noreferrer noopener">
          {e.rawTitle}
        </a>
      )}
      {text && <Markdown ast={messages.embedAST(text)} />}
      {small && <Media media={small} box="thumb" />}
      {big && <Media media={big} box="media" href={e.url} />}
    </figure>
  )
}
