// An image or video scaled into its box, from the media proxy at that size (Discord's transform drops media without a
// size). As stock's default, GIFs play only while the window is focused: a GIF image swaps to a still from the media
// proxy (format=webp is its first frame), a GIF video pauses. An image that isn't a link to a page opens in the viewer,
// its full size fetched while hovered.

import { createEffect } from 'solid-js'

import { windowFocused } from '../api/hooks'
import type { EmbedMedia as Source } from '../api/types'
import * as viewer from './viewer'

// the box media fits: embeds' media, a thumbnail, a sent image (larger, but GIFs stay at embeds' size)
const BOX = { media: [400, 300], thumb: [80, 80], sent: [550, 350] } as const
type Box = keyof typeof BOX

const fit = (media: Source, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(1, maxWidth / media.width, maxHeight / media.height)
  return { width: Math.round(media.width * scale), height: Math.round(media.height * scale) }
}

export function Media(p: { media: Source; box: Box; href?: string }) {
  const isGif = Boolean(p.media.proxyURL) && /\.gif(\?|$)/i.test(p.media.url)
  const [maxWidth, maxHeight] = BOX[isGif && p.box === 'sent' ? 'media' : p.box]
  const { width, height } = fit(p.media, maxWidth, maxHeight)
  const src = p.media.proxyURL
    ? `${p.media.proxyURL}${p.media.proxyURL.includes('?') ? '&' : '?'}width=${width}&height=${height}`
    : p.media.url
  const href = p.href
  const full = p.media.proxyURL ?? p.media.url
  return (
    <img
      class={['media', { thumb: p.box === 'thumb', zoom: !href }]}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      src={isGif && !windowFocused() ? `${src}&format=webp` : src}
      onPointerEnter={() => {
        if (!href) new Image().src = full
      }}
      onClick={() => (href ? window.open(href) : viewer.open(full, p.media.url))}
    />
  )
}

// a video at its box's size (when it's known): with controls, or a GIF's (muted, looping, playing while the window is
// focused)
export function Clip(p: { src: string; media: Source; poster?: string; gif?: boolean }) {
  const { width, height } = p.media.width ? fit(p.media, ...BOX.media) : { width: undefined, height: undefined }
  let video!: HTMLVideoElement
  if (p.gif) createEffect(windowFocused, (focused) => void (focused ? video.play() : video.pause()))
  return p.gif ? (
    <video
      ref={video}
      class="media"
      muted
      loop
      playsinline
      width={width}
      height={height}
      poster={p.poster}
      src={p.src}
    />
  ) : (
    <video class="media" controls preload="metadata" width={width} height={height} src={p.src} />
  )
}
