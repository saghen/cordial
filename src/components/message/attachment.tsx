// A message's files: images and videos inline (images in the larger box), anything else a link with its size; and its
// stickers, as their images from Discord's CDN at stock's 160 px (an APNG animates with passthrough), a Lottie one (an
// animated vector) as its name.

import { Show } from 'solid-js'

import * as pickers from '../../api/pickers'
import type { Attachment as File, Message } from '../../api/types'
import { Clip, Media } from '../media'

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

export function Attachment(p: { file: File }) {
  const f = p.file,
    type = f.content_type?.split('/')[0],
    media = { url: f.url, proxyURL: f.proxy_url, width: f.width!, height: f.height! }
  if (type === 'image' && f.width) return <Media media={media} box="sent" />
  if (type === 'video') return <Clip src={f.url} media={media} />
  return (
    <a class="file" href={f.url} target="_blank" rel="noreferrer noopener">
      {f.filename}
      <small>{size(f.size)}</small>
    </a>
  )
}

type StickerItem = NonNullable<Message['stickerItems']>[number]

export const Sticker = (p: { sticker: StickerItem }) => (
  <Show when={pickers.stickerSrc(p.sticker)} fallback={<i class="sticker">{p.sticker.name}</i>}>
    {(src) => <img class="sticker" alt={p.sticker.name} title={p.sticker.name} width={160} height={160} src={src()} />}
  </Show>
)
