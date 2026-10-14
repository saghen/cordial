// The composer's pickers, as buttons at the box's right edge, laid out as stock's: emoji and stickers on Sections, with
// the hovered one named below; GIFs as tiles. An emoji is written into the box as its :name:, which the parser turns
// into the emoji on send (as autocomplete does); a sticker or GIF is sent at once

import { createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import * as guilds from '../api/guilds'
import * as pickers from '../api/pickers'
import type { Channel, Emoji as EmojiRecord, Gif, Sticker } from '../api/types'
import { text } from '../api/strings'
import { IconButton } from '../primitives/button'
import { Icon } from '../primitives/icon'
import { Popout } from '../primitives/popout'
import { SearchInput } from '../primitives/search'
import { Sections } from '../primitives/sections'
import { Emoji } from './emoji'
import { GuildIcon } from './guild_icon'

// a section's rail button: the server's icon, favorites' and the most used's icons, else the picker's own (its first
// item)
const rail =
  <T,>(other: (s: pickers.Section<T>) => JSX.Element) =>
  (s: pickers.Section<T>) =>
    s.guild ? <GuildIcon guild={s.guild} size={24} /> : s.icon ? <Icon name={s.icon} /> : other(s)

// the footer: the item's image, its name, where it's from
const Named = (p: { img?: JSX.Element; name: string; from?: string }) => (
  <>
    {p.img}
    <b>{p.name}</b>
    <small>{p.from}</small>
  </>
)

export function EmojiPicker(p: { box: () => HTMLTextAreaElement; channel: () => Channel | undefined }) {
  const [query, setQuery] = createSignal('')
  let menu!: HTMLElement
  const all = () => (p.channel() ? pickers.emojiSections(p.channel()!) : [])
  const found = () => pickers.searchEmoji(p.channel()!, query())
  const pick = (e: EmojiRecord) => {
    const b = p.box()
    // a space before it when it would join a word
    const before = b.value.slice(0, b.selectionStart)
    b.setRangeText(`${before && !/\s$/.test(before) ? ' ' : ''}:${e.name}: `, b.selectionStart, b.selectionEnd, 'end')
    b.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return (
    <>
      <IconButton
        class="emoji-button"
        icon="reaction"
        title={text('SELECT_EMOJI')}
        popovertarget="mc-emoji"
        hidden={!p.channel()}
      />
      <Popout
        ref={menu}
        name="emoji"
        class="emoji-picker"
        onClose={() => {
          setQuery('')
          p.box().focus()
        }}
      >
        <Sections
          search={
            <SearchInput
              class="emoji-search"
              placeholder={text('SEARCH_FOR_EMOJI')}
              autofocus
              value={query()}
              onInput={setQuery}
              onEnter={() => {
                if (!found()[0]) return
                pick(found()[0])
                menu.hidePopover()
              }}
            />
          }
          all={all()}
          shown={query() ? [{ id: 'results', name: '', items: found() }] : all()}
          rail={rail((s) => (
            <Emoji emoji={s.items[0]} />
          ))}
          item={(e) => (
            <button
              data-id={e.id ?? e.name}
              // shift keeps the picker open for more, as stock
              onClick={(ev) => (pick(e), ev.shiftKey || menu.hidePopover())}
            >
              <img alt={e.name} src={pickers.emojiSrc(e)} loading="lazy" />
            </button>
          )}
          footer={(e) => <Named img={<Emoji emoji={e} />} name={`:${e.name}:`} from={pickers.emojiFrom(e)} />}
        />
      </Popout>
    </>
  )
}

// GIFs, as stock's picker: Favorites, Trending GIFs and the trending categories as tiles until a search; a tile opens
// under its name with a way back (a category searches its name). A click sends the GIF's link at once, as stock (the
// box keeps its text), after stock's select request
export function GifPicker(p: { channel: () => Channel | undefined; send: (text: string) => void }) {
  const [query, setQuery] = createSignal('')
  // the open tile's name and stock's kind of result: Search, Category (a trending category's search), Trending
  const [view, setView] = createSignal<{ name: string; kind: string }>()
  let menu!: HTMLMenuElement
  const items = () =>
    view()?.kind === 'Favorites' ? pickers.favoriteGifs() : query() || view() ? pickers.gifResults() : []
  const pick = (g: Gif, index: number) => {
    pickers.selectGif(g, index, items(), view()?.kind ?? 'Search', query() || view()?.name)
    p.send(g.url)
    menu.hidePopover()
  }
  const back = () => {
    setView(undefined)
    setQuery('')
    pickers.clearGifs()
  }
  const tile = (name: string, img: string | undefined, run: () => void) => (
    <button class="gif-category" data-id={name} style={img ? { '--img': `url(${img})` } : undefined} onClick={run}>
      {name}
    </button>
  )
  return (
    <>
      <IconButton
        class="gif-button"
        icon="gif"
        title={text('GIF_BUTTON_LABEL')}
        popovertarget="mc-gif"
        hidden={!p.channel()}
      />
      <Popout ref={menu} name="gif" class="gif-picker" onOpen={pickers.openGifs} onClose={back}>
        <Show
          when={view()}
          fallback={
            <SearchInput
              class="gif-search"
              placeholder={text('SEARCH_KLIPY')}
              autofocus
              value={query()}
              onInput={(q) => {
                setQuery(q)
                pickers.searchGifs(q, 'Search')
              }}
            />
          }
        >
          {(v) => (
            <h3>
              <IconButton class="gif-back" icon="back" title={text('BACK')} onClick={back} />
              {v().name}
            </h3>
          )}
        </Show>
        <Show
          when={query() || view()}
          fallback={
            <div class="gif-categories">
              <Show when={pickers.favoriteGifs()[0]}>
                {(f) =>
                  tile(text('FAVORITES'), pickers.isVideo(f().src) ? undefined : f().src, () =>
                    setView({ name: text('FAVORITES'), kind: 'Favorites' }),
                  )
                }
              </Show>
              <For each={pickers.gifCategories()}>
                {(c) =>
                  tile(c.name, c.src, () => {
                    if (c.type !== 'Trending') {
                      setView({ name: c.name, kind: 'Category' })
                      return pickers.searchGifs(c.name, 'Category', true)
                    }
                    setView({ name: c.name, kind: 'Trending' })
                    pickers.trendingGifs()
                  })
                }
              </For>
            </div>
          }
        >
          <div class="gif-results">
            <div class="gif-columns">
              <For each={items()}>
                {(g, i) => (
                  <button class="gif" data-id={g.id ?? g.url} onClick={() => pick(g, i())}>
                    {pickers.isVideo(g.src) ? (
                      <video src={g.src} width={g.width} height={g.height} autoplay loop muted />
                    ) : (
                      <img alt="" src={g.src} width={g.width} height={g.height} loading="lazy" />
                    )}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </Popout>
    </>
  )
}

// stickers, as stock's picker: the sendable ones, in sections or what a search matches by name and tags. A click
// sends it at once
export function StickerPicker(p: { channel: () => Channel | undefined; send: (stickerId: string) => void }) {
  const [query, setQuery] = createSignal('')
  let menu!: HTMLElement
  const all = () => (p.channel() ? pickers.stickerSections(p.channel()!) : [])
  // a Lottie sticker by its name, as the chat shows one
  const image = (st: Sticker) => {
    const src = pickers.stickerSrc(st)
    return src ? <img alt={st.name} src={src} loading="lazy" /> : st.name
  }
  return (
    <>
      <IconButton
        class="sticker-button"
        icon="sticker"
        title={text('STICKER_BUTTON_LABEL')}
        popovertarget="mc-sticker"
        hidden={!p.channel()}
      />
      <Popout
        ref={menu}
        name="sticker"
        class="sticker-picker"
        onOpen={pickers.fetchStickerPacks}
        onClose={() => setQuery('')}
      >
        <Sections
          search={
            <SearchInput
              class="sticker-search"
              placeholder={text('SEARCH_FOR_STICKER')}
              autofocus
              value={query()}
              onInput={setQuery}
            />
          }
          all={all()}
          shown={query() ? [{ id: 'results', name: '', items: pickers.searchStickers(p.channel()!, query()) }] : all()}
          // a pack's first sticker, else its initials (a Lottie sticker has no image)
          rail={rail((s) => {
            const src = pickers.stickerSrc(s.items[0])
            return src ? <img alt="" src={src} /> : guilds.acronym(s)
          })}
          item={(st) => (
            <button data-id={st.id} onClick={() => (p.send(st.id), menu.hidePopover())}>
              {image(st)}
            </button>
          )}
          footer={(st) => (
            <Named
              img={pickers.stickerSrc(st) && <img alt="" src={pickers.stickerSrc(st)} />}
              name={st.name}
              from={pickers.stickerFrom(st)}
            />
          )}
        />
      </Popout>
    </>
  )
}
