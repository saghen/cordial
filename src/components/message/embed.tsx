// A message's link embed, as Discord's record keeps what its servers scraped (OpenGraph, oEmbed): a card with the
// text, a small thumbnail beside it or a large image under it; an image or GIF link is just the media. No players: a
// video is its thumbnail, opening the page.

import * as messages from '../../api/messages'
import type { Embed as EmbedRecord } from '../../api/types'
import { Markdown } from '../markdown'
import { Clip, Media } from '../media'

const TYPES = new Set(['link', 'article', 'video', 'rich', 'image', 'gifv'])

export function Embed(p: { embed: EmbedRecord }) {
  const embed = p.embed
  if (!TYPES.has(embed.type)) return null
  // media only, as stock: a GIF, or an image or video with no title or author
  if (
    (embed.image || embed.video) &&
    (embed.type === 'gifv' || (embed.type !== 'rich' && !embed.author && !embed.rawTitle))
  ) {
    if (embed.video?.proxyURL)
      return (
        <Clip
          src={embed.video.proxyURL}
          media={embed.video}
          poster={embed.thumbnail?.proxyURL}
          gif={embed.type === 'gifv'}
        />
      )
    const media = embed.image ?? embed.thumbnail
    return media ? <Media media={media} box="media" /> : null
  }
  const big = embed.image ?? (embed.video && embed.thumbnail)
  const small = !embed.video && embed.thumbnail
  // as stock: no description for YouTube (youtu.be, shorts, music. and m. included)
  const text =
    embed.provider?.name !== 'YouTube' &&
    !/\b(youtube(-nocookie)?\.com|youtu\.be)\//.test(embed.url ?? '') &&
    embed.rawDescription
  if (!embed.rawTitle && !text && !embed.author && !big && !small) return null
  return (
    <figure class="embed" style={embed.color ? { 'border-left-color': embed.color } : undefined}>
      {embed.provider && <small class="provider">{embed.provider.name}</small>}
      {embed.author && <b class="author">{embed.author.name}</b>}
      {embed.rawTitle && (
        <a class="title" href={embed.url} target="_blank" rel="noreferrer noopener">
          {embed.rawTitle}
        </a>
      )}
      {text && <Markdown ast={messages.embedAST(text)} />}
      {small && <Media media={small} box="thumb" />}
      {big && <Media media={big} box="media" href={embed.url} />}
    </figure>
  )
}
