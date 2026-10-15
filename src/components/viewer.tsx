// Stock's media viewer, roughly: an image (or a GIF's video) large over a dimmed window, with a link to the original. Escape or a click
// outside the image closes it; a right click on it is stock's image menu (Copy Image, Save Image, Copy Link), Ctrl+C
// copies it. Mounted once (the chat view); open() from any image.

import { onCleanup } from 'solid-js'

import * as media from '../api/media'
import { text } from '../api/strings'
import { contextMenu, Items } from '../primitives/menu'
import { modal } from '../primitives/modal'

type Shown = { src: string; url: string; video?: boolean }
let show: ((shown: Shown) => void) | undefined

// a GIF that's a video (Tenor's, Giphy's) plays in it, looping and muted
export const open = (src: string, url: string, video = false) => show?.({ src, url, video })

export function Viewer() {
  const menu = contextMenu<Shown>({
    class: 'image-menu',
    find: () => null,
    children: (shown) => (
      <Items
        items={[
          !shown().video && {
            name: 'menu-copy-image',
            label: text('COPY_IMAGE_MENU_ITEM'),
            run: () => media.copyImage(shown().src),
          },
          { name: 'menu-save-image', label: text('SAVE_IMAGE_MENU_ITEM'), run: () => media.saveImage(shown().url) },
          { name: 'menu-copy-link', label: text('COPY_LINK'), run: () => media.copyLink(shown().url) },
        ]}
      />
    ),
  })
  const viewer = modal<Shown>({
    class: 'viewer',
    children(shown) {
      function copy(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !getSelection()?.toString() && !shown().video)
          media.copyImage(shown().src)
      }
      document.addEventListener('keydown', copy)
      onCleanup(() => document.removeEventListener('keydown', copy))
      return (
        <>
          {shown().video ? (
            <video autoplay loop muted playsinline src={shown().src} onContextMenu={(e) => menu.show(e, shown())} />
          ) : (
            <img alt="" src={shown().src} onContextMenu={(e) => menu.show(e, shown())} />
          )}
          <a href={shown().url} target="_blank" rel="noreferrer noopener">
            {text('OPEN_IN_BROWSER')}
          </a>
          {/* in the dialog: a modal dialog leaves the page outside it inert */}
          {menu.view}
        </>
      )
    },
  })
  show = viewer.open
  onCleanup(() => {
    show = undefined
  })
  return viewer.view
}
