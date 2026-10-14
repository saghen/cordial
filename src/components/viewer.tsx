// Stock's media viewer, roughly: an image large over a dimmed window, with a link to the original. Escape or a click
// outside the image closes it. Mounted once (the chat view); open() from any image.

import { onCleanup } from 'solid-js'

import { text } from '../api/strings'
import { modal } from '../primitives/modal'

let show: ((v: { src: string; url: string }) => void) | undefined

export const open = (src: string, url: string) => show?.({ src, url })

export function Viewer() {
  const viewer = modal<{ src: string; url: string }>({
    class: 'viewer',
    children: (s) => (
      <>
        <img alt="" src={s().src} />
        <a href={s().url} target="_blank" rel="noreferrer noopener">
          {text('OPEN_IN_BROWSER')}
        </a>
      </>
    ),
  })
  show = viewer.open
  onCleanup(() => (show = undefined))
  return viewer.view
}
