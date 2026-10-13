// The composer's pickers, as buttons at the box's right edge, laid out as stock's: emoji and stickers as sections in
// one list (favorites, the most used, each server's, then unicode's categories or Discord's packs) with a rail of
// them on the left and the hovered one named below; GIFs as tiles. An emoji is written into the box as its :name:,
// which the parser turns into the emoji on send (as autocomplete does); a sticker or GIF is sent at once

import { createEffect, createSignal, For, Show } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { A, S } from '../adapter/core'
import type { Id, Rec } from '../adapter/discord'
import { emojiSrc } from './lib/model'
import { $ } from './lib/store'
import { guildIcon } from './server_bar'

const COUNT = 48

// the frecency settings (stock's second settings proto): favorite GIFs, emoji and stickers
const favorites = () => S.UserSettingsProto.frecencyWithoutFetchingLatest

// a section: its rail button (an icon's name, else its image or its first item's, else its initials) and its items
type Section = { id: string; name: string; icon?: string; img?: string; items: Rec[] }
// an item as the footer names it
type Info = { src?: string; name: string; from?: string }

// 36: four rows of emoji, nine of stickers
const chunks = (items: Rec[]) =>
  Array.from({ length: Math.ceil(items.length / 36) }, (_, i) => items.slice(i * 36, i * 36 + 36))

const guildSection = (id: Id, items: Rec[]): Section => ({
  id,
  name: S.Guild.getGuild(id)?.name ?? '',
  img: guildIcon(id) || undefined,
  items,
})

// a picker's search, rail, sections and footer: the footer names the hovered item, else the first shown; a rail
// button scrolls to its section
function Sections(p: {
  search: JSX.Element
  all: Section[]
  shown: Section[]
  info: (r: Rec) => Info
  item: (r: Rec) => JSX.Element
}) {
  const [hovered, setHovered] = createSignal<Rec>()
  createEffect(
    () => p.shown,
    () => setHovered(undefined),
  )
  const named = () => {
    const r = hovered() ?? p.shown[0]?.items[0]
    return r && p.info(r)
  }
  let list!: HTMLDivElement
  // items are built in chunks, each once it comes near the view; until then it's empty, as tall as its rows
  // (thousands of emoji would otherwise be styled again on every open)
  const near = new Map<Element, () => void>()
  let seeing: IntersectionObserver | undefined
  const watch = (el: Element, show: () => void) => {
    seeing ??= new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (near.get(e.target)?.(), seeing!.unobserve(e.target))),
      { root: list, rootMargin: '200px 0px' },
    )
    near.set(el, show)
    seeing.observe(el)
  }
  return (
    <>
      {p.search}
      <nav>
        <For each={p.all}>
          {(s) => (
            <button
              data-id={s.id}
              title={s.name}
              style={s.icon ? { '--i': `var(--i-${s.icon})` } : undefined}
              onClick={() => list.querySelector(`[data-section="${s.id}"]`)?.scrollIntoView()}
            >
              <Show when={!s.icon}>
                <Show
                  when={s.img ?? p.info(s.items[0]).src}
                  fallback={s.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 3)}
                >
                  {(src) => <img alt="" src={src()} />}
                </Show>
              </Show>
            </button>
          )}
        </For>
      </nav>
      <div ref={list}>
        {/* by id: the sections are new each open, their items the same records */}
        <For each={p.shown} keyed={(s) => s.id}>
          {(s) => (
            <>
              <Show when={s().name}>
                <h3 data-section={s().id}>{s().name}</h3>
              </Show>
              <For each={chunks(s().items)} keyed={false}>
                {(chunk) => {
                  const [seen, setSeen] = createSignal(false)
                  return (
                    <p ref={(el) => watch(el, () => setSeen(true))} style={{ '--n': chunk().length }}>
                      <Show when={seen()}>
                        <For each={chunk()}>
                          {(r) => {
                            const el = p.item(r) as HTMLElement
                            el.addEventListener('pointerenter', () => setHovered(r))
                            return el
                          }}
                        </For>
                      </Show>
                    </p>
                  )
                }}
              </For>
            </>
          )}
        </For>
      </div>
      <footer>
        <Show when={named()}>
          {(n) => (
            <>
              <Show when={n().src}>{(src) => <img alt="" src={src()} />}</Show>
              <b>{n().name}</b>
              <small>{n().from}</small>
            </>
          )}
        </Show>
      </footer>
    </>
  )
}

const searchInput = (
  name: string,
  placeholder: string,
  query: () => string,
  set: (q: string) => void,
  enter?: () => void,
) => (
  <input
    class={`${name}-search`}
    type="search"
    placeholder={placeholder}
    value={query()}
    onInput={(e) => set(e.currentTarget.value)}
    onKeyDown={(e) => e.key === 'Enter' && enter?.()}
  />
)

export function EmojiPicker(p: { box: () => HTMLTextAreaElement; channel: () => Rec | undefined }) {
  const [query, setQuery] = createSignal('')
  let menu!: HTMLMenuElement
  // read again on each open (the stores' frecency isn't a dependency); kept while closed, so opening again reuses the
  // rows
  const [opened, setOpened] = createSignal(0)
  const guild = () => p.channel()?.guild_id as string | undefined
  // as stock without Nitro: custom emoji only this server's, and not animated
  const usable = (e: Rec) => !e.id || !!S.User.getCurrentUser()?.premiumType || (e.guildId === guild() && !e.animated)
  const all = (): Section[] => {
    if (!opened() || !p.channel()) return []
    const ctx = S.Emoji.getDisambiguatedEmojiContext(guild())
    const guilds = [...ctx.getGroupedCustomEmoji()]
      .sort(([a]) => (a === guild() ? -1 : 0))
      .map(([id, list]) => guildSection(id, list.filter(usable)))
    return [
      {
        id: 'favorites',
        name: 'Favorites',
        icon: 'star',
        items: ctx.favoriteEmojisWithoutFetchingLatest.filter(usable),
      },
      {
        id: 'frequent',
        name: 'Frequently Used',
        icon: 'clock',
        items: ctx.getFrequentlyUsedEmojisWithoutFetchingLatest().filter(usable).slice(0, COUNT),
      },
      ...guilds,
      ...A.unicodeEmoji.getCategories().map((c) => ({
        id: c,
        name: c[0].toUpperCase() + c.slice(1),
        items: A.unicodeEmoji.getByCategory(c),
      })),
    ].filter((s) => s.items.length)
  }
  const found = () =>
    S.Emoji.searchWithoutFetchingLatest({ channel: p.channel()!, query: query(), count: COUNT, intention: 3 }).unlocked
  const pick = (e: Rec) => {
    const b = p.box()
    // a space before it when it would join a word
    const before = b.value.slice(0, b.selectionStart)
    b.setRangeText(`${before && !/\s$/.test(before) ? ' ' : ''}:${e.name}: `, b.selectionStart, b.selectionEnd, 'end')
    b.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return (
    <>
      <button class="emoji-button" title="Select emoji" popovertarget="mc-emoji" hidden={!p.channel()} />
      <menu
        ref={menu}
        id="mc-emoji"
        class="emoji-picker"
        popover
        onToggle={(e) => {
          if (e.newState === 'open') {
            setOpened((n) => n + 1)
            return menu.querySelector('input')!.focus()
          }
          setQuery('')
          p.box().focus()
        }}
      >
        <Sections
          search={searchInput('emoji', 'Find the perfect emoji', query, setQuery, () => {
            if (!found()[0]) return
            pick(found()[0])
            menu.hidePopover()
          })}
          all={all()}
          shown={query() ? [{ id: 'results', name: '', items: found() }] : all()}
          info={(e) => ({
            src: emojiSrc(e),
            name: `:${e.name}:`,
            from: e.guildId && `from ${S.Guild.getGuild(e.guildId)?.name ?? ''}`,
          })}
          item={(e) => (
            <button
              data-id={e.id ?? e.name}
              // shift keeps the picker open for more, as stock
              onClick={(ev) => (pick(e), ev.shiftKey || menu.hidePopover())}
            >
              <img alt={e.name} src={emojiSrc(e)} loading="lazy" />
            </button>
          )}
        />
      </menu>
    </>
  )
}

// GIFs, as stock's picker: Favorites, Trending GIFs and the trending categories as tiles until a search; a tile opens
// under its name with a way back (a category searches its name). A click sends the GIF's link at once, as stock (the
// box keeps its text), after stock's select request (not for a favorite, which has no id)
export function GifPicker(p: { channel: () => Rec | undefined; send: (text: string) => void }) {
  const [query, setQuery] = createSignal('')
  // the open tile's name and stock's kind of result: Search, Category (a trending category's search), Trending
  const [view, setView] = createSignal<{ name: string; kind: string }>()
  let menu!: HTMLMenuElement
  const search = (q: string, kind: string, now = false) => {
    setQuery(q)
    A.gifs.search(q, kind, now)
  }
  // favorites newest first, as { url, src, width, height }
  const saved = (): Rec[] =>
    Object.entries(($.UserSettingsProto.frecencyWithoutFetchingLatest.favoriteGifs?.gifs ?? {}) as Record<string, Rec>)
      .sort(([, a], [, b]) => b.order - a.order)
      .map(([url, g]) => ({ ...g, url }))
  const items = () =>
    view()?.kind === 'Favorites' ? saved() : query() || view() ? $.GIFPickerView.getResultItems() : []
  const pick = (g: Rec, index: number) => {
    const n = items().length
    if (g.id)
      A.gifs.select({
        type: view()?.kind ?? 'Search',
        index,
        offset: 0,
        limit: null,
        results: n,
        totalResults: n,
        query: query() || view()?.name,
        gifId: g.id,
      })
    p.send(g.url)
    menu.hidePopover()
  }
  const back = () => {
    setView(undefined)
    setQuery('')
    A.gifs.clear()
  }
  const tile = (name: string, img: string | undefined, run: () => void) => (
    <button class="gif-category" data-id={name} style={img ? { '--img': `url(${img})` } : undefined} onClick={run}>
      {name}
    </button>
  )
  return (
    <>
      <button class="gif-button" title="Open GIF picker" popovertarget="mc-gif" hidden={!p.channel()} />
      <menu
        ref={menu}
        id="mc-gif"
        class="gif-picker"
        popover
        onToggle={(e) => {
          if (e.newState === 'open') {
            A.gifs.initialize()
            A.gifs.trendingCategories()
            return menu.querySelector('input')?.focus()
          }
          back()
        }}
      >
        <Show when={view()} fallback={searchInput('gif', 'Search Klipy', query, (q) => search(q, 'Search'))}>
          {(v) => (
            <h3>
              <button class="gif-back" title="Back" onClick={back} />
              {v().name}
            </h3>
          )}
        </Show>
        <Show
          when={query() || view()}
          fallback={
            <p>
              <Show when={saved()[0]}>
                {(f) =>
                  tile('Favorites', /\.(mp4|webm)(\?|$)/.test(f().src) ? undefined : f().src, () =>
                    setView({ name: 'Favorites', kind: 'Favorites' }),
                  )
                }
              </Show>
              <For each={$.GIFPickerView.getTrendingCategories()}>
                {(c) =>
                  tile(c.name, c.src, () => {
                    if (c.type !== 'Trending') {
                      setView({ name: c.name, kind: 'Category' })
                      return A.gifs.search(c.name, 'Category', true)
                    }
                    setView({ name: c.name, kind: 'Trending' })
                    A.gifs.trending(50)
                  })
                }
              </For>
            </p>
          }
        >
          <div>
            <div>
              <For each={items()}>
                {(g, i) => (
                  <button data-id={g.id ?? g.url} onClick={() => pick(g, i())}>
                    {/\.(mp4|webm)(\?|$)/.test(g.src) ? (
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
      </menu>
    </>
  )
}

// stickers, as stock's picker: the sendable ones (stock's rule: this server's, other servers' with Nitro and the
// permission, Discord's packs once fetched): favorites, the most used, each server's and pack's, or what a search
// matches by name and tags. A click sends it at once
export function StickerPicker(p: { channel: () => Rec | undefined; send: (stickerId: string) => void }) {
  const [query, setQuery] = createSignal('')
  const [opened, setOpened] = createSignal(0)
  let menu!: HTMLMenuElement
  const sendable = (st: Rec | undefined): st is Rec =>
    !!st && A.stickers.sendability(st, S.User.getCurrentUser(), p.channel()) === 0
  const all = (): Section[] => {
    if (!opened()) return []
    const byId = (ids: Id[] = []) => ids.map((id) => S.Stickers.getStickerById(id)).filter(sendable)
    const guilds = [...$.Stickers.getAllGuildStickers()].map(([id, list]) => guildSection(id, list.filter(sendable)))
    const packs = $.Stickers.getPremiumPacks().map((pk) => ({ id: pk.id, name: pk.name, items: pk.stickers }))
    return [
      { id: 'favorites', name: 'Favorites', icon: 'star', items: byId(favorites().favoriteStickers?.stickerIds) },
      {
        id: 'frequent',
        name: 'Frequently Used',
        icon: 'clock',
        items: S.StickersPersisted.stickerFrecencyWithoutFetchingLatest.frequently.filter(sendable).slice(0, 16),
      },
      ...guilds,
      ...packs,
    ].filter((s) => s.items.length)
  }
  const found = () => {
    const q = query().toLowerCase()
    const seen = new Set<Rec>()
    for (const s of all())
      for (const st of s.items)
        if (st.name.toLowerCase().includes(q) || st.tags?.toLowerCase().includes(q)) seen.add(st)
    return [...seen]
  }
  const src = (st: Rec) =>
    `https://media.discordapp.net/stickers/${st.id}.${st.format_type === 4 ? 'gif' : 'png'}?size=160${st.format_type === 2 ? '&passthrough=true' : ''}`
  const from = (st: Rec) =>
    st.guild_id ? S.Guild.getGuild(st.guild_id)?.name : S.Stickers.getStickerPack(st.pack_id)?.name
  return (
    <>
      <button class="sticker-button" title="Open sticker picker" popovertarget="mc-sticker" hidden={!p.channel()} />
      <menu
        ref={menu}
        id="mc-sticker"
        class="sticker-picker"
        popover
        onToggle={(e) => {
          if (e.newState !== 'open') return setQuery('')
          setOpened((n) => n + 1)
          A.stickers.fetchPacks()
          menu.querySelector('input')!.focus()
        }}
      >
        <Sections
          search={searchInput('sticker', 'Find the perfect sticker', query, setQuery)}
          all={all()}
          shown={query() ? [{ id: 'results', name: '', items: found() }] : all()}
          info={(st) => ({
            src: st.format_type === 3 ? undefined : src(st),
            name: st.name,
            from: from(st) && `from ${from(st)}`,
          })}
          item={(st) => (
            <button data-id={st.id} onClick={() => (p.send(st.id), menu.hidePopover())}>
              {/* a Lottie sticker by its name, as the chat shows one */}
              {st.format_type === 3 ? st.name : <img alt={st.name} src={src(st)} loading="lazy" />}
            </button>
          )}
        />
      </menu>
    </>
  )
}
