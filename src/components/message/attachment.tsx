// A message's files: images and videos inline (images in the larger box), anything else a link with its size; and its
// stickers, as their images from Discord's CDN at stock's 160 px (an APNG animates with passthrough), a Lottie one (an
// animated vector) as its name.

import { Show } from 'solid-js'

import * as pickers from '../../api/pickers'
import type { Attachment as AttachmentRecord, Message } from '../../api/types'
import { Clip, Media } from '../media'

const KB = 1024
// stock's sticker size, in px
const STICKER_SIZE = 160

function size(bytes: number) {
  if (bytes < KB) return `${bytes} B`
  if (bytes < KB ** 2) return `${(bytes / KB).toFixed(1)} KB`
  return `${(bytes / KB ** 2).toFixed(1)} MB`
}

export function Attachment(p: { file: AttachmentRecord }) {
  const file = p.file
  const type = file.content_type?.split('/')[0]
  const media = { url: file.url, proxyURL: file.proxy_url, width: file.width!, height: file.height! }
  if (type === 'image' && file.width) return <Media media={media} box="sent" />
  if (type === 'video') return <Clip src={file.url} media={media} />
  return (
    <a class="file" href={file.url} target="_blank" rel="noreferrer noopener">
      {file.filename}
      <small>{size(file.size)}</small>
    </a>
  )
}

type StickerItem = NonNullable<Message['stickerItems']>[number]

export function Sticker(p: { sticker: StickerItem }) {
  return (
    <Show when={pickers.stickerSrc(p.sticker)} fallback={<i class="sticker">{p.sticker.name}</i>}>
      {(src) => (
        <img
          class="sticker"
          alt={p.sticker.name}
          title={p.sticker.name}
          width={STICKER_SIZE}
          height={STICKER_SIZE}
          src={src()}
        />
      )}
    </Show>
  )
}
