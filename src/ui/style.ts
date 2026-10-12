/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// All of the renderer's CSS (design/phase1.md: palette in section 3, sizes in section 2). The root is one grid; list
// rows are subgrids of their list (icon, label, badge), so every row's columns line up without wrappers. Elements are
// styled by tag, nested under the root (Discord's own layers, which are outside it, never see these rules): each
// tag has one use.

export const CSS = `
#mincord-root {
  --bg: #1e1e2e; --bg-raised: #2c2c3f; --bg-floating: #313244; --bg-deep: #11111b; --accent: #5f8cfb; --link: #89b4fa;
  --text: #efeff1; --text-strong: #fbfbfb; --text-muted: #96979e; --text-faint: #4f505a;
  --mention-bg: #5f8cfb3d; --mention-fg: #a9bbff; --danger: #da3e44; --positive: #3d9e60; --warning: #fdb833;
  position: fixed; inset: 0; z-index: 1; display: grid;
  grid: "notice notice notice" auto "servers side head" 48px "servers nav main" 1fr "servers me main" 52px / 72px 240px minmax(0, 1fr);
  background: var(--bg); color: var(--text); font: 16px/1.375 "gg sans", "Noto Sans", sans-serif;

  & * { margin: 0; box-sizing: border-box; }
  & > p { grid-area: notice; padding: 8px; text-align: center; background: var(--accent); color: var(--text-strong); }
  & > h1, & > header {
    display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--bg-raised);
    font-size: 16px; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden;
  }
  & > h1 { grid-area: side; }
  & > header { grid-area: head; }
  small { font-size: 14px; font-weight: 400; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }

  /* rows: server icons, channels, categories, DMs */
  a { cursor: pointer; color: inherit; text-decoration: none; }
  aside, nav { display: grid; align-content: start; overflow-y: auto; scrollbar-width: none; }
  aside { grid-area: servers; justify-items: center; gap: 8px; padding: 12px 0; }
  aside > a {
    width: 48px; height: 48px; border-radius: 16px; display: grid; place-items: center; position: relative;
    background: var(--icon, none) center / cover, var(--bg-raised); font-size: 14px; color: var(--text-strong);
  }
  aside > a.sel { outline: 2px solid var(--accent); }
  aside > a.unread::before { content: ""; position: absolute; left: -16px; width: 8px; height: 8px; border-radius: 0 4px 4px 0; background: var(--text-strong); }
  aside > hr { width: 32px; border: 0; border-top: 2px solid var(--bg-raised); }
  nav { grid-area: nav; grid-template-columns: auto 1fr auto; padding: 8px; }
  nav > a {
    grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; gap: 8px;
    min-height: 32px; padding: 0 8px; border-radius: 4px; color: var(--text-muted); white-space: nowrap; overflow: hidden;
  }
  nav > a::before { content: "#"; width: 20px; text-align: center; font-size: 20px; }
  nav > a:hover, nav > a.sel { background: var(--bg-raised); color: var(--text-strong); }
  nav > a.unread { color: var(--text-strong); font-weight: 600; }
  nav > a.muted { color: var(--text-faint); }
  nav > a.cat { margin-top: 16px; min-height: 24px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
  nav > a.cat::before { content: "⌄"; font-size: 12px; }
  nav > a.cat.collapsed::before { content: "›"; }
  /* an icon instead of #: avatars (DMs, the user panel) are round, with the status as a ring */
  nav > a[style]::before, footer::before {
    content: ""; width: 32px; height: 32px; border-radius: 50%; background: var(--icon) center / cover;
  }
  [data-status=online]::before { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--positive); }
  [data-status=idle]::before { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--warning); }
  [data-status=dnd]::before { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--danger); }
  a[data-n]::after {
    content: attr(data-n); min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--danger);
    font: 700 12px/16px "gg sans", sans-serif; color: #fff; text-align: center;
  }
  aside > a[data-n]::after { position: absolute; right: -4px; bottom: -4px; box-shadow: 0 0 0 3px var(--bg); }
  footer {
    grid-area: me; display: grid; grid: auto auto / auto 1fr; column-gap: 8px; align-content: center; padding: 0 8px;
    border-top: 1px solid var(--bg-raised); font-weight: 500; color: var(--text-strong);
  }
  footer::before { grid-row: span 2; align-self: center; }
  footer > small { font-size: 12px; }

  /* messages: column-reverse keeps the view at the bottom (scroller.ts) */
  .messages { grid-area: main; overflow-y: auto; display: flex; flex-direction: column-reverse; overflow-anchor: none; }
  .messages > div { padding: 16px 0 24px; }
  article {
    position: relative; padding: 2px 16px 2px 72px; white-space: pre-wrap; overflow-wrap: anywhere;
    /* offscreen rows skip style and layout until scrolled to (ai/LOG.md, 0.7) */
    content-visibility: auto; contain-intrinsic-size: auto 26px;
  }
  article:hover { background: #0000001a; }
  article.head { margin-top: 16px; min-height: 48px; contain-intrinsic-size: auto 48px; }
  article.head::before {
    content: ""; position: absolute; left: 16px; top: 4px; width: 40px; height: 40px; border-radius: 50%;
    background: var(--av) center / cover, var(--bg-raised);
  }
  article.system { color: var(--text-muted); font-style: italic; }
  article.new { border-top: 1px solid var(--danger); }
  article.edited::after { content: " (edited)"; font-size: 10px; color: var(--text-muted); }
  article > b { display: block; font-weight: 500; color: var(--text-strong); white-space: normal; cursor: pointer; }
  article > b::after { content: attr(data-ts); margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--text-muted); }

  /* content (content.ts) */
  article h1, article h2, article h3 { margin: 8px 0 0; line-height: 1.25; color: var(--text-strong); }
  article h1 { font-size: 24px; } article h2 { font-size: 20px; } article h3 { font-size: 16px; }
  article small { display: block; font-size: 12px; }
  article code, article pre { font: 14px/1.3 "gg mono", ui-monospace, monospace; background: var(--bg-raised); border-radius: 4px; }
  article code { padding: 0 3px; }
  article pre { display: block; padding: 8px; margin: 4px 0; }
  article blockquote { padding-left: 12px; border-left: 4px solid var(--bg-raised); }
  article ul, article ol { padding-left: 24px; white-space: normal; }
  article ul { list-style: disc; } article ol { list-style: decimal; }
  /* Discord's reset (its stylesheet stays loaded for the fonts) */
  article em { font-style: italic; } article strong { font-weight: 700; }
  article a { color: var(--link); } article a:hover { text-decoration: underline; }
  article img { width: 22px; height: 22px; vertical-align: bottom; object-fit: contain; }
  article mark { background: var(--mention-bg); color: var(--mention-fg); border-radius: 3px; padding: 0 2px; }
  article del { text-decoration: none; background: var(--bg-deep); color: transparent; border-radius: 4px; cursor: pointer; }
  article del[open] { background: var(--bg-raised); color: inherit; }
  article time { background: var(--bg-raised); border-radius: 3px; padding: 0 2px; }
}
`;
