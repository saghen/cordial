// Stock's media viewer, roughly: an image large over a dimmed window, with a link to the original. Escape or a click
// outside the image closes it; a right click on it is stock's image menu (Copy Image, Save Image, Copy Link), Ctrl+C
// copies it. Mounted once (the chat view); open() from any image.

import { onCleanup } from 'solid-js'

import * as media from '../api/media'
import { text } from '../api/strings'
import { contextMenu, Items } from '../primitives/menu'
import { modal } from '../primitives/modal'

type Shown = { src: string; url: string }
let show: ((v: Shown) => void) | undefined

export const open = (src: string, url: string) => show?.({ src, url })

export function Viewer() {
  const menu = contextMenu<Shown>({
    class: 'image-menu',
    find: () => null,
    children: (s) => (
      <Items
        items={[
          { name: 'menu-copy-image', label: text('COPY_IMAGE_MENU_ITEM'), run: () => media.copyImage(s().src) },
          { name: 'menu-save-image', label: text('SAVE_IMAGE_MENU_ITEM'), run: () => media.saveImage(s().url) },
          { name: 'menu-copy-link', label: text('COPY_LINK'), run: () => media.copyLink(s().url) },
        ]}
      />
    ),
  })
  const viewer = modal<Shown>({
    class: 'viewer',
    children: (s) => {
      const copy = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !getSelection()?.toString()) media.copyImage(s().src)
      }
      document.addEventListener('keydown', copy)
      onCleanup(() => document.removeEventListener('keydown', copy))
      return (
        <>
          <img alt="" src={s().src} onContextMenu={(e) => menu.show(e, s())} />
          <a href={s().url} target="_blank" rel="noreferrer noopener">
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
