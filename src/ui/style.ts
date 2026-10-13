// All of the renderer's CSS. The root is one grid; list rows are subgrids of their list (icon, label, badge). Elements
// are styled by tag, nested under the root so Discord's own layers never see these rules.

export const CSS = `
#mincord-root {
  --bg: #1e1e2e; --bg-raised: #2c2c3f; --bg-floating: #313244; --bg-deep: #11111b; --accent: #5f8cfb; --link: #89b4fa;
  --text: #efeff1; --text-strong: #fbfbfb; --text-muted: #96979e; --text-faint: #4f505a;
  --mention-bg: #5f8cfb3d; --mention-fg: #a9bbff; --danger: #da3e44; --positive: #3d9e60; --warning: #fdb833;
  position: fixed; inset: 0; z-index: 1; display: grid;
  grid: "notice notice notice notice" auto "servers side head head" 48px "servers nav main members" 1fr
    "servers nav uploads members" auto "servers nav reply members" auto "servers nav compose members" auto
    "servers me compose members" 52px / 72px 240px minmax(0, 1fr) auto;
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
  aside > a.folder {
    background: var(--icon, none) no-repeat, color-mix(in srgb, var(--folder) 30%, var(--bg-raised));
    background-size: 18px; background-position: 5px 5px, 25px 5px, 5px 25px, 25px 25px, 0 0;
  }
  aside > a.folder.open { background: var(--folder); }
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
  nav > a.voice::before { content: "🔊"; font-size: 14px; }
  nav > a.voice > small { grid-column: 2; font-size: 12px; }
  nav > a[data-mc^=voice-user] { min-height: 28px; padding-left: 36px; font-size: 14px; }
  nav > a[data-mc^=voice-user]::before { width: 24px; height: 24px; }
  nav > a.speaking::before { box-shadow: 0 0 0 2px var(--positive); }
  nav > a.muted[data-mc^=voice-user]::after { content: "muted"; font-size: 11px; color: var(--text-faint); }
  nav > a.deaf[data-mc^=voice-user]::after { content: "deafened"; }
  /* the voice panel: over the channel list's end, which makes room for it, so the chat keeps its size */
  &:has(> footer) > nav { padding-bottom: 64px; }
  & > footer {
    grid-area: nav; align-self: end; display: grid; background: var(--bg); grid-template-columns: 1fr auto; padding: 8px; border-top: 1px solid var(--bg-raised);
    font-size: 14px; font-weight: 600; color: var(--warning);
  }
  & > footer[data-state=RTC_CONNECTED] { color: var(--positive); }
  & > footer > small { grid-column: 1; font-weight: 400; font-size: 12px; color: var(--text-muted); }
  & > footer > button {
    grid-area: 1 / 2 / 3; width: 32px; height: 32px; border: 0; border-radius: 4px; background: none; cursor: pointer;
    color: var(--text-muted); font-size: 18px;
  }
  & > footer > button::before { content: "✆"; }
  & > footer > button:hover { background: var(--bg-raised); color: var(--danger); }
  nav > a.cat { margin-top: 16px; min-height: 24px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
  nav > a.cat::before { content: "⌄"; font-size: 12px; }
  nav > a.cat.collapsed::before { content: "›"; }
  /* an icon instead of #: avatars (DMs, the user panel) are round, with the status as a ring */
  nav > a[style]::before, & > header[style]::before, & > button::before, menu > b::before {
    content: ""; width: 32px; height: 32px; border-radius: 50%; background: var(--icon) center / cover;
  }
  & > header[style]::before { width: 24px; height: 24px; }
  [data-status=online]::before { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--positive); }
  [data-status=idle]::before { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--warning); }
  [data-status=dnd]::before { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--danger); }
  a[data-n]::after {
    content: attr(data-n); min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--danger);
    font: 700 12px/16px "gg sans", sans-serif; color: #fff; text-align: center;
  }
  aside > a[data-n]::after { position: absolute; right: -4px; bottom: -4px; box-shadow: 0 0 0 3px var(--bg); }
  /* the user panel (a button: it opens the account popout) */
  & > button, menu > b {
    display: grid; grid: auto auto / auto 1fr; column-gap: 8px; align-content: center; text-align: left;
    font: inherit; font-weight: 500; color: var(--text-strong);
  }
  & > button {
    grid-area: me; padding: 0 8px; border: 0; border-top: 1px solid var(--bg-raised); background: none; cursor: pointer;
  }
  & > button::before, menu > b::before { grid-row: span 2; align-self: center; }
  & > button > small, menu > b > small { font-size: 12px; }
  /* mute and deafen over the panel's end (voice.tsx) */
  & > button[data-mc=me] { padding-right: 88px; }
  & > button:is([data-mc=mute], [data-mc=deafen]) {
    justify-self: end; align-self: center; width: 32px; height: 32px; margin-right: 8px; padding: 0; border: 0; border-radius: 4px;
    place-content: center;
  }
  & > button[data-mc=mute] { margin-right: 44px; }
  & > button:is([data-mc=mute], [data-mc=deafen]):hover { background: var(--bg-raised); }
  & > button:is([data-mc=mute], [data-mc=deafen]).on { background: color-mix(in srgb, var(--danger) 35%, transparent); }
  & > button:is([data-mc=mute], [data-mc=deafen])::before { content: "🎙"; width: auto; height: auto; grid-row: auto; font-size: 16px; }
  & > button[data-mc=deafen]::before { content: "🔊"; }

  /* the account popout, above the panel (popovertarget makes the panel its anchor) */
  menu {
    inset: auto; margin: 0 0 8px; position-area: top span-right; width: 224px; padding: 8px; border: 0;
    border-radius: 8px; background: var(--bg-floating); color: var(--text); box-shadow: 0 8px 16px #0006;
  }
  menu:popover-open { display: grid; gap: 2px; }
  menu > b { padding: 4px 8px 12px; margin-bottom: 4px; border-bottom: 1px solid var(--bg-raised); }
  menu > button {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; background: none;
    color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer;
  }
  menu > button:hover, menu > button.sel { background: var(--bg-raised); color: var(--text-strong); }
  menu > button[value]::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--text-muted); }
  menu > button[value=online]::before { background: var(--positive); }
  menu > button[value=idle]::before { background: var(--warning); }
  menu > button[value=dnd]::before { background: var(--danger); }

  /* messages: column-reverse keeps the view at the bottom (scroller.ts); scroll anchoring keeps it still when rows
     arrive while scrolled up */
  .messages { grid-area: main; overflow-y: auto; display: flex; flex-direction: column-reverse; }
  .messages > div { padding: 16px 0 24px; }
  article {
    position: relative; padding: 2px 16px 2px 72px; white-space: pre-wrap; overflow-wrap: anywhere;
    /* offscreen rows skip style and layout until scrolled to (ai/LOG.md, 0.7) */
    content-visibility: auto; contain-intrinsic-size: auto 26px;
  }
  article:hover { background-color: #0000001a; }
  article.head { margin-top: 16px; min-height: 48px; contain-intrinsic-size: auto 48px; }
  article.head::before {
    content: ""; position: absolute; left: 16px; top: 4px; width: 40px; height: 40px; border-radius: 50%;
    background: var(--av) center / cover, var(--bg-raised);
  }
  article.system { color: var(--text-muted); font-style: italic; }
  article.edited::after { content: " (edited)"; font-size: 10px; color: var(--text-muted); }
  article > b { display: block; font-weight: 500; color: var(--text-strong); white-space: normal; cursor: pointer; }
  article > b::after { content: attr(data-ts); margin-left: 8px; font-size: 12px; font-weight: 400; color: var(--text-muted); }
  article > b > i {
    margin-left: 4px; padding: 0 4px; border-radius: 3px; background: var(--accent); color: #fff;
    font: 600 10px/15px "gg sans", sans-serif; vertical-align: 2px;
  }
  /* the date divider, inside the row (content-visibility clips what's outside it): a line, the date centred on it */
  article.day { padding-top: 32px; min-height: 80px; background: linear-gradient(var(--bg-raised) 0 0) 0 8px / 100% 1px no-repeat; }
  article.day::before { top: 36px; }
  article.day > b::before {
    content: attr(data-day); position: absolute; top: 0; left: 50%; translate: -50%; padding: 0 4px;
    background: var(--bg); font-size: 12px; font-weight: 600; line-height: 16px; color: var(--text-muted);
  }
  article.new { border-top: 1px solid var(--danger); }
  /* sending, then failed with Retry and Delete */
  article.sending { opacity: 0.5; }
  article.failed { color: var(--danger); }
  article > p[data-mc=failed] { font-size: 14px; }
  article > p[data-mc=failed] > button { margin-left: 8px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; }

  /* a reply: the replied-to message above the author line, the reply bar above the composer */
  article > q {
    display: block; font-size: 14px; color: var(--text-muted); white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; cursor: pointer; quotes: none;
  }
  article > q::before { content: "↱ "; }
  article.reply::before { top: 26px; }
  & > label {
    grid-area: reply; display: flex; align-items: center; gap: 8px; margin: 0 16px; padding: 6px 12px;
    border-radius: 8px 8px 0 0; background: var(--bg-floating); font-size: 14px; color: var(--text-muted);
  }
  & > label > b { color: var(--text-strong); font-weight: 600; margin-right: auto; }
  & > label > button { border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  & > label > button.on { color: var(--accent); font-weight: 700; }
  /* attachments: media at its scaled size (width and height attributes), other files as a link with the size */
  article > .media { display: block; max-width: 100%; height: auto; margin-top: 4px; border-radius: 8px; background: var(--bg-raised); }
  article > a.file {
    display: flex; width: fit-content; max-width: 100%; gap: 8px; margin-top: 4px; padding: 10px 12px;
    border: 1px solid var(--bg-raised); border-radius: 8px; background: var(--bg-deep); white-space: normal;
  }
  article > a.file::after { content: attr(data-size); color: var(--text-muted); font-size: 12px; align-self: center; }
  /* reactions: a chip per emoji under the content, mine ringed */
  article > p { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; white-space: normal; }
  article > p > button {
    display: flex; align-items: center; gap: 4px; padding: 2px 6px; border: 1px solid transparent; border-radius: 8px;
    background: var(--bg-raised); color: var(--text-muted); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  article > p > button.me { border-color: var(--accent); color: var(--text-strong); }
  article > p > button > img { width: 16px; height: 16px; }
  /* the age gate (app.tsx): over the messages and the composer */
  & > figure {
    grid-area: main / main / compose / main; z-index: 2; display: grid; place-content: center; justify-items: center; gap: 16px;
    background: var(--bg); text-align: center;
  }
  & > figure > h2 { font-size: 20px; color: var(--text-strong); }
  & > figure > button { min-width: 120px; padding: 8px 16px; border: 0; border-radius: 4px; background: var(--bg-raised); color: var(--text-strong); font: inherit; cursor: pointer; }
  /* the context menus: popovers at the pointer */
  menu:is([data-mc=message-menu], [data-mc=server-menu], [data-mc=devices]) { position: fixed; margin: 0; }
  menu > button.danger { color: var(--danger); }
  menu > button:disabled { opacity: 0.5; cursor: default; }
  menu > input { padding: 6px 8px; border: 0; border-radius: 4px; outline: 0; background: var(--bg-deep); color: inherit; font: inherit; }
  menu > p { display: grid; grid-template-columns: repeat(6, 1fr); }
  menu > p > button { padding: 4px; border: 0; border-radius: 4px; background: none; font-size: 22px; line-height: 1; cursor: pointer; }
  menu > p > button:hover { background: var(--bg-raised); }
  menu > p > button > img { width: 24px; height: 24px; }

  /* the member list (members.tsx), and its toggle at the header's end */
  & > header > button { margin-left: auto; border: 0; background: none; color: var(--text-muted); font: inherit; font-size: 14px; cursor: pointer; }
  & > header > button.on { color: var(--text-strong); }
  section {
    grid-area: members; width: 240px; overflow-y: auto; padding: 8px; background: var(--bg-deep);
    display: grid; grid-template-columns: auto 1fr; align-content: start;
  }
  section > h3 { grid-column: 1 / -1; padding: 24px 8px 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); }
  section > a {
    grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; gap: 12px; height: 44px;
    padding: 0 8px; border-radius: 4px; color: var(--text-muted); white-space: nowrap; overflow: hidden;
  }
  section > a:hover { background: var(--bg-raised); }
  section > a::before { content: ""; width: 32px; height: 32px; border-radius: 50%; background: var(--icon, var(--bg-raised)) center / cover; }

  /* the composer (composer.tsx): grows with its text, up to half the window */
  textarea {
    grid-area: compose; margin: 0 16px 16px; min-height: 56px; max-height: 50vh; padding: 16px 16px 16px 56px; resize: none;
    field-sizing: content; anchor-name: --box; border: 0; border-radius: 8px; outline: 0; background: var(--bg-raised); color: inherit; font: inherit;
  }
  textarea.editing { box-shadow: 0 0 0 2px var(--accent); }
  /* autocomplete (autocomplete.tsx): a list over the messages, as wide as the box, just above it */
  menu[data-mc=autocomplete] { position-anchor: --box; width: anchor-size(width); margin: 0 0 8px; }
  menu[data-mc=autocomplete] > button > img { width: 24px; height: 24px; border-radius: 50%; }
  /* the attach button over the box's left edge, the files waiting to go as chips above it */
  & > button[data-mc=attach] {
    grid-area: compose; align-self: start; justify-self: start; z-index: 1; width: 24px; height: 24px; margin: 16px 0 0 32px;
    padding: 0; border: 0; border-radius: 50%; cursor: pointer;
    background: linear-gradient(var(--bg) 0 0) center / 12px 2px no-repeat, linear-gradient(var(--bg) 0 0) center / 2px 12px no-repeat, var(--text-muted);
  }
  & > ul { grid-area: uploads; display: flex; flex-wrap: wrap; gap: 8px; margin: 0 16px; padding: 8px 0; list-style: none; }
  & > ul > button { padding: 8px 12px; border: 0; border-radius: 8px; background: var(--bg-floating); color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
  textarea::placeholder { color: var(--text-faint); }

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
  article img:not(.media) { width: 22px; height: 22px; vertical-align: bottom; object-fit: contain; }
  article mark { background: var(--mention-bg); color: var(--mention-fg); border-radius: 3px; padding: 0 2px; }
  article del { text-decoration: none; background: var(--bg-deep); color: transparent; border-radius: 4px; cursor: pointer; }
  article del[open] { background: var(--bg-raised); color: inherit; }
  article time { background: var(--bg-raised); border-radius: 3px; padding: 0 2px; }
}
`;
