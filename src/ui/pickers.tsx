// The composer's pickers, as buttons at the box's right edge: emoji (by section, or what a search matches; a click
// writes it into the box as its :name:, which the parser turns into the emoji on send, as autocomplete does) and GIFs

import { createSignal, For, Show } from 'solid-js'

import { A, S } from '../adapter/core'
import type { Rec } from '../adapter/discord'
import { emojiSrc } from './lib/model'
import { $ } from './lib/store'

const COUNT = 48

export function EmojiPicker(p: { box: () => HTMLTextAreaElement; channel: () => Rec | undefined }) {
  const [query, setQuery] = createSignal('')
  // without a query, one section at a time, as stock's tabs: the most used (chat's), this server's emoji, then each
  // unicode category
  const [tab, setTab] = createSignal('frequent')
  let menu!: HTMLMenuElement
  // read while it's open (the stores' frecency isn't a dependency)
  const [open, setOpen] = createSignal(false)
  const guild = () => p.channel()?.guild_id as string | undefined
  const section = (t: string): Rec[] =>
    t === 'frequent'
      ? S.Emoji.emojiFrecencyWithoutFetchingLatest.frequently.slice(0, COUNT)
      : t === 'server'
        ? guild()
          ? S.Emoji.getUsableGuildEmoji(guild()!)
          : []
        : A.unicodeEmoji.getByCategory(t)
  const tabs = () => ['frequent', ...(guild() ? ['server'] : []), ...A.unicodeEmoji.getCategories()]
  const emojis = () =>
    !open() || !p.channel()
      ? []
      : query()
        ? S.Emoji.searchWithoutFetchingLatest({ channel: p.channel()!, query: query(), count: COUNT, intention: 3 })
            .unlocked
        : section(tab())
  const pick = (e: Rec) => {
    const b = p.box()
    // a space before it when it would join a word
    const before = b.value.slice(0, b.selectionStart)
    b.setRangeText(`${before && !/\s$/.test(before) ? ' ' : ''}:${e.name}: `, b.selectionStart, b.selectionEnd, 'end')
    b.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return (
    <>
      <button data-mc="emoji" title="Select emoji" popovertarget="mc-emoji" hidden={!p.channel()} />
      <menu
        ref={menu}
        id="mc-emoji"
        data-mc="emoji-picker"
        popover
        onToggle={(e) => {
          setOpen(e.newState === 'open')
          if (e.newState === 'open') return menu.querySelector('input')!.focus()
          setQuery('')
          p.box().focus()
        }}
      >
        <input
          data-mc="emoji:search"
          placeholder="Find the perfect emoji"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !emojis()[0]) return
            pick(emojis()[0])
            menu.hidePopover()
          }}
        />
        <Show when={!query()}>
          <nav>
            <For each={open() ? tabs() : []}>
              {(t) => (
                <button data-mc={`emoji:tab:${t}`} class={{ on: tab() === t }} onClick={() => setTab(t)}>
                  <img alt={t} src={section(t)[0] ? emojiSrc(section(t)[0]) : undefined} />
                </button>
              )}
            </For>
          </nav>
        </Show>
        <p>
          <For each={emojis()}>
            {(e) => (
              <button
                data-mc={`emoji:${e.id ?? e.name}`}
                title={`:${e.name}:`}
                // shift keeps the picker open for more, as stock
                onClick={(ev) => (pick(e), ev.shiftKey || menu.hidePopover())}
              >
                <img alt={e.name} src={emojiSrc(e)} loading="lazy" />
              </button>
            )}
          </For>
        </p>
      </menu>
    </>
  )
}

// GIFs, as stock's picker: trending categories (and Trending GIFs) until a search; a category searches its name. A
// click sends the GIF's link at once, as stock (the box keeps its text), after stock's select request
export function GifPicker(p: { channel: () => Rec | undefined; send: (text: string) => void }) {
  const [query, setQuery] = createSignal('')
  // stock's kinds of result: Search, Category (a trending category's search), Trending (Trending GIFs)
  let menu!: HTMLMenuElement,
    kind = 'Search'
  const search = (q: string, type: string, now = false) => {
    setQuery(q)
    kind = type
    A.gifs.search(q, type, now)
  }
  const items = () => (query() ? $.GIFPickerView.getResultItems() : [])
  const pick = (g: Rec, index: number) => {
    const n = items().length
    A.gifs.select({
      type: kind,
      index,
      offset: 0,
      limit: null,
      results: n,
      totalResults: n,
      query: query(),
      gifId: g.id,
    })
    p.send(g.url)
    menu.hidePopover()
  }
  return (
    <>
      <button data-mc="gif" title="Open GIF picker" popovertarget="mc-gif" hidden={!p.channel()}>
        GIF
      </button>
      <menu
        ref={menu}
        id="mc-gif"
        data-mc="gif-picker"
        popover
        onToggle={(e) => {
          if (e.newState === 'open') {
            A.gifs.initialize()
            A.gifs.trendingCategories()
            return menu.querySelector('input')!.focus()
          }
          setQuery('')
          A.gifs.clear()
        }}
      >
        <input
          data-mc="gif:search"
          placeholder="Search Tenor"
          value={query()}
          onInput={(e) => search(e.currentTarget.value, 'Search')}
        />
        <p>
          <Show
            when={query()}
            fallback={
              <For each={$.GIFPickerView.getTrendingCategories()}>
                {(c) => (
                  <button
                    data-mc={`gif:category:${c.name}`}
                    style={{ 'background-image': `url(${c.src})` }}
                    onClick={() => {
                      if (c.type !== 'Trending') return search(c.name, 'Category', true)
                      setQuery(c.name)
                      kind = 'Trending'
                      A.gifs.trending(50)
                    }}
                  >
                    {c.name}
                  </button>
                )}
              </For>
            }
          >
            <For each={items()}>
              {(g, i) => (
                <button data-mc={`gif:${g.id}`} onClick={() => pick(g, i())}>
                  {/\.(mp4|webm)(\?|$)/.test(g.src) ? (
                    <video src={g.src} width={g.width} height={g.height} autoplay loop muted />
                  ) : (
                    <img alt="" src={g.src} width={g.width} height={g.height} loading="lazy" />
                  )}
                </button>
              )}
            </For>
          </Show>
        </p>
      </menu>
    </>
  )
}

// stickers, as stock's picker: the sendable ones (stock's rule: this server's, other servers' with Nitro and the
// permission, Discord's packs once fetched), a tab per server and pack, or what a search matches by name and tags. A
// click sends it at once
export function StickerPicker(p: { channel: () => Rec | undefined; send: (stickerId: string) => void }) {
  const [query, setQuery] = createSignal('')
  const [tab, setTab] = createSignal<string>()
  const [open, setOpen] = createSignal(false)
  let menu!: HTMLMenuElement
  const sendable = (st: Rec) => A.stickers.sendability(st, S.User.getCurrentUser(), p.channel()) === 0
  // [id, name, stickers] for each server, then each pack
  const sections = (): [string, string, Rec[]][] => {
    if (!open()) return []
    const guilds = [...S.Stickers.getAllGuildStickers()].map(([id, list]): [string, string, Rec[]] => [
      id,
      S.Guild.getGuild(id)?.name,
      list.filter(sendable),
    ])
    const packs = $.Stickers.getPremiumPacks().map((pk): [string, string, Rec[]] => [pk.id, pk.name, pk.stickers])
    return [...guilds, ...packs].filter(([, , list]) => list.length)
  }
  const stickers = () => {
    const q = query().toLowerCase()
    if (q)
      return sections()
        .flatMap(([, , list]) => list)
        .filter((st) => st.name.toLowerCase().includes(q) || st.tags?.toLowerCase().includes(q))
    const all = sections()
    return (all.find(([id]) => id === tab()) ?? all[0])?.[2] ?? []
  }
  const src = (st: Rec) =>
    `https://media.discordapp.net/stickers/${st.id}.${st.format_type === 4 ? 'gif' : 'png'}?size=160${st.format_type === 2 ? '&passthrough=true' : ''}`
  return (
    <>
      <button data-mc="sticker" title="Open sticker picker" popovertarget="mc-sticker" hidden={!p.channel()} />
      <menu
        ref={menu}
        id="mc-sticker"
        data-mc="sticker-picker"
        popover
        onToggle={(e) => {
          setOpen(e.newState === 'open')
          if (e.newState !== 'open') return setQuery('')
          A.stickers.fetchPacks()
          menu.querySelector('input')!.focus()
        }}
      >
        <input
          data-mc="sticker:search"
          placeholder="Find the perfect sticker"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Show when={!query()}>
          <nav>
            <For each={sections()}>
              {([id, name, list]) => (
                <button
                  data-mc={`sticker:tab:${id}`}
                  title={name}
                  class={{ on: (tab() ?? sections()[0][0]) === id }}
                  onClick={() => setTab(id)}
                >
                  {list[0].format_type === 3 ? (
                    name.replace(/\B\w+|\W/g, '').slice(0, 3)
                  ) : (
                    <img alt={name} src={src(list[0])} />
                  )}
                </button>
              )}
            </For>
          </nav>
        </Show>
        <p>
          <For each={stickers()}>
            {(st) => (
              <button data-mc={`sticker:${st.id}`} title={st.name} onClick={() => (p.send(st.id), menu.hidePopover())}>
                {st.format_type === 3 ? st.name : <img alt={st.name} src={src(st)} loading="lazy" />}
              </button>
            )}
          </For>
        </p>
      </menu>
    </>
  )
}
