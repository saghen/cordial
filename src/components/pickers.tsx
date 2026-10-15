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
  <T,>(other: (section: pickers.Section<T>) => JSX.Element) =>
  (section: pickers.Section<T>) => {
    if (section.guild) return <GuildIcon guild={section.guild} size={24} />
    if (section.icon) return <Icon name={section.icon} />
    return other(section)
  }

// the footer: the item's image, its name, where it's from
function Named(p: { image?: JSX.Element; name: string; from?: string }) {
  return (
    <>
      {p.image}
      <b>{p.name}</b>
      <small>{p.from}</small>
    </>
  )
}

export function EmojiPicker(p: { box: () => HTMLTextAreaElement; channel: () => Channel | undefined }) {
  const [query, setQuery] = createSignal('')
  let menu!: HTMLElement
  function all() {
    const channel = p.channel()
    return channel ? pickers.emojiSections(channel) : []
  }
  const found = () => pickers.searchEmoji(p.channel()!, query())
  function pick(emoji: EmojiRecord) {
    const box = p.box()
    // a space before it when it would join a word
    const before = box.value.slice(0, box.selectionStart)
    box.setRangeText(
      `${before && !/\s$/.test(before) ? ' ' : ''}:${emoji.name}: `,
      box.selectionStart,
      box.selectionEnd,
      'end',
    )
    box.dispatchEvent(new Event('input', { bubbles: true }))
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
              class="picker-search"
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
          rail={rail((section) => (
            <Emoji emoji={section.items[0]} />
          ))}
          item={(emoji) => (
            <button
              data-id={emoji.id ?? emoji.name}
              // shift keeps the picker open for more, as stock
              onClick={(e) => {
                pick(emoji)
                if (!e.shiftKey) menu.hidePopover()
              }}
            >
              <img alt={emoji.name} src={pickers.emojiSrc(emoji)} loading="lazy" />
            </button>
          )}
          footer={(emoji) => (
            <Named image={<Emoji emoji={emoji} />} name={`:${emoji.name}:`} from={pickers.emojiFrom(emoji)} />
          )}
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
  function items() {
    if (view()?.kind === 'Favorites') return pickers.favoriteGifs()
    return query() || view() ? pickers.gifResults() : []
  }
  function pick(gif: Gif, index: number) {
    pickers.selectGif(gif, index, items(), view()?.kind ?? 'Search', query() || view()?.name)
    p.send(gif.url)
    menu.hidePopover()
  }
  function back() {
    setView(undefined)
    setQuery('')
    pickers.clearGifs()
  }
  const tile = (name: string, image: string | undefined, run: () => void) => (
    <button
      class="gif-category"
      data-id={name}
      style={image ? { '--image': `url(${image})` } : undefined}
      onClick={run}
    >
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
              class="picker-search"
              placeholder={text('SEARCH_KLIPY')}
              autofocus
              value={query()}
              onInput={(value) => {
                setQuery(value)
                pickers.searchGifs(value, 'Search')
              }}
            />
          }
        >
          {(opened) => (
            <h3>
              <IconButton class="gif-back" icon="back" title={text('BACK')} onClick={back} />
              {opened().name}
            </h3>
          )}
        </Show>
        <Show
          when={query() || view()}
          fallback={
            <div class="gif-categories">
              <Show when={pickers.favoriteGifs()[0]}>
                {(favorite) =>
                  tile(text('FAVORITES'), pickers.isVideo(favorite().src) ? undefined : favorite().src, () =>
                    setView({ name: text('FAVORITES'), kind: 'Favorites' }),
                  )
                }
              </Show>
              <For each={pickers.gifCategories()}>
                {(category) =>
                  tile(category.name, category.src, () => {
                    if (category.type !== 'Trending') {
                      setView({ name: category.name, kind: 'Category' })
                      return pickers.searchGifs(category.name, 'Category', true)
                    }
                    setView({ name: category.name, kind: 'Trending' })
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
                {(gif, i) => (
                  <button class="gif" data-id={gif.id ?? gif.url} onClick={() => pick(gif, i())}>
                    {pickers.isVideo(gif.src) ? (
                      <video src={gif.src} width={gif.width} height={gif.height} autoplay loop muted />
                    ) : (
                      <img alt="" src={gif.src} width={gif.width} height={gif.height} loading="lazy" />
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
  function all() {
    const channel = p.channel()
    return channel ? pickers.stickerSections(channel) : []
  }
  // a Lottie sticker by its name, as the chat shows one
  function image(sticker: Sticker) {
    const src = pickers.stickerSrc(sticker)
    return src ? <img alt={sticker.name} src={src} loading="lazy" /> : sticker.name
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
              class="picker-search"
              placeholder={text('SEARCH_FOR_STICKER')}
              autofocus
              value={query()}
              onInput={setQuery}
            />
          }
          all={all()}
          shown={query() ? [{ id: 'results', name: '', items: pickers.searchStickers(p.channel()!, query()) }] : all()}
          // a pack's first sticker, else its initials (a Lottie sticker has no image)
          rail={rail((section) => {
            const src = pickers.stickerSrc(section.items[0])
            return src ? <img alt="" src={src} /> : guilds.acronym(section)
          })}
          item={(sticker) => (
            <button
              data-id={sticker.id}
              onClick={() => {
                p.send(sticker.id)
                menu.hidePopover()
              }}
            >
              {image(sticker)}
            </button>
          )}
          footer={(sticker) => (
            <Named
              image={pickers.stickerSrc(sticker) && <img alt="" src={pickers.stickerSrc(sticker)} />}
              name={sticker.name}
              from={pickers.stickerFrom(sticker)}
            />
          )}
        />
      </Popout>
    </>
  )
}
