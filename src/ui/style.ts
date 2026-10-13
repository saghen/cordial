import { ICONS } from "./icons";

// All of the renderer's CSS. The root is one grid; list rows are subgrids of their list (icon, label, badge). Elements
// are styled by tag, nested under the root so Discord's own layers never see these rules.

export const CSS = `
#mincord-root {
  --bg: #1e1e2e; --bg-raised: #2c2c3f; --bg-selected: #363645; --bg-floating: #313244; --bg-deep: #11111b; --accent: #5f8cfb; --link: #89b4fa;
  --text: #efeff1; --text-strong: #fbfbfb; --text-muted: #96979e; --text-faint: #4f505a;
  --mention-bg: #5f8cfb3d; --mention-fg: #a9bbff; --danger: #da3e44; --positive: #3d9e60; --warning: #fdb833;
  ${ICONS}
  --i: var(--i-hash);
  position: fixed; inset: 0; z-index: 1; display: grid;
  grid: "notice notice notice notice" auto "servers side head head" 48px "servers nav main members" 1fr
    "servers nav uploads members" auto "servers nav reply members" auto "servers nav compose members" auto
    "servers me compose members" 60px / 72px 300px minmax(0, 1fr) auto;
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

  /* Discord's icons (icons.ts): a mask over the text colour, --i picks which */
  nav > a:not([style])::before, nav > a.cat::after, nav > a:is(.mute, .deaf)::after, & > header.channel::before,
  & > header > button::before, & > footer > button::before, & > button:not([data-mc=me])::before, div.open > a.folder::before,
  menu[data-mc=message-menu] > button::before, menu > button[data-mc="menu:react"]::after, article > p > button[data-mc="reaction:add"]::before {
    content: ""; flex: none; width: 20px; height: 20px; background: currentColor; mask: var(--i) center / contain no-repeat;
  }

  /* rows: server icons, channels, categories, DMs */
  a { cursor: pointer; color: inherit; text-decoration: none; }
  aside, nav { display: grid; align-content: start; overflow-y: auto; }
  aside { scrollbar-width: none; }
  /* the server bar: stock's squircles (its BlobMask path, within 0.1 px), the pill on the left for unread, hovered and
     selected. The top padding centres the DMs button on the header row */
  aside { grid-area: servers; justify-items: center; gap: 8px; padding: 4px 0 12px; border-right: 1px solid var(--bg-raised); }
  aside a {
    width: 40px; height: 40px; border-radius: 13px; corner-shape: superellipse(1.3); display: grid; place-items: center; position: relative;
    background: var(--icon, none) center / cover, var(--bg-raised); font-size: 16px; font-weight: 500; color: var(--text-strong);
    transition: background-color 0.15s;
  }
  aside a[style] { background-color: transparent; }
  aside a:not([style]):is(:hover, .sel) { background-color: var(--accent); }
  aside a[data-mc^="dm:"] { border-radius: 50%; corner-shape: round; }
  aside a::before {
    content: ""; position: absolute; left: -16px; width: 4px; height: 0; border-radius: 0 4px 4px 0;
    background: var(--text-strong); transition: height 0.15s;
  }
  aside a.unread::before { height: 8px; }
  aside a:hover::before { height: 20px; }
  aside a.sel::before { height: 40px; }
  aside a[data-mc=dms] { background: var(--img-discord) center / 28px no-repeat, var(--bg-raised); }
  /* folders, as stock measures them: closed, a 48 px tile of four; open, the folder icon in its colour over its servers,
     on one column */
  aside > div { display: grid; gap: 8px; justify-items: center; width: 48px; border-radius: 16px; }
  aside > div.open { padding: 4px 0 8px; background: #97979f1f; }
  aside a.folder {
    width: 48px; height: 48px; grid: 1fr 1fr / 1fr 1fr; gap: 2px; padding: 4px; border-radius: 16px; corner-shape: round;
    background: #97979f1f;
  }
  aside a.folder:hover { background-color: #97979f33; }
  aside a.folder::before { left: -12px; }
  aside > div.open > a.folder { width: 40px; height: 40px; border-radius: 12px; grid: auto / auto; place-items: center; background: none; color: var(--folder); }
  aside > div.open > a.folder:hover { background-color: #97979f33; }
  aside > div.open > a.folder::before { position: static; --i: var(--i-folder); transition: none; }
  aside a.folder > i {
    width: 19px; height: 19px; border-radius: 4px; display: grid; place-items: center; overflow: hidden;
    background: var(--icon, none) center / cover, var(--bg); font: 500 8px/1 "gg sans", sans-serif;
  }
  aside a.folder > i:nth-child(1) { border-top-left-radius: 13px; }
  aside a.folder > i:nth-child(2) { border-top-right-radius: 13px; }
  aside a.folder > i:nth-child(3) { border-bottom-left-radius: 13px; }
  aside a.folder > i:nth-child(4) { border-bottom-right-radius: 13px; }
  aside > hr { width: 32px; margin-top: -5px; border: 0; border-top: 1px solid var(--bg-raised); }
  /* the channel list and the DMs */
  nav {
    grid-area: nav; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px; padding: 8px;
  }
  /* scrollbars: a thumb, no arrows (the standard scrollbar-* properties would turn these off), shown on hover */
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-thumb { border: 2px solid #0000; border-radius: 6px; background: var(--bg-floating) padding-box; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: none; }
  :not(:hover)::-webkit-scrollbar-thumb { background: none; }
  /* a row reaches the list's edge with a clear left border, where the unread pill goes; its colour stays in the padding box */
  nav > a {
    grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; column-gap: 8px;
    min-height: 32px; margin-left: -8px; padding: 0 8px; border-left: 8px solid #0000; border-radius: 16px 8px 8px 16px / 8px;
    background-clip: padding-box; color: var(--text-muted); font-size: 15px; white-space: nowrap; overflow: hidden;
  }
  nav > a:not([style])::before { width: 18px; height: 18px; }
  nav > a.unread {
    background: radial-gradient(circle at 0 50%, var(--text-strong) 3.5px, #0000 4px) 0 50% / 4px 8px no-repeat border-box, none padding-box;
    color: var(--text-strong); font-weight: 600;
  }
  :is(nav > a, & > header).news { --i: var(--i-announce); }
  :is(nav > a, & > header).nsfw { --i: var(--i-hash-nsfw); }
  :is(nav > a, & > header).lock { --i: var(--i-hash-lock); }
  nav > a:hover, nav > a.sel { background-color: var(--bg-raised); color: var(--text-strong); }
  nav > a.sel { background-color: var(--bg-selected); }
  nav > a.muted { color: var(--text-faint); }
  nav > a.voice { --i: var(--i-voice); }
  /* someone in it: the icon green, how long the call has gone on at the end */
  nav > a.live::before { color: var(--positive); }
  nav > a.voice[data-time]::after { content: attr(data-time); grid-column: 3; font: 12px "gg mono", ui-monospace, monospace; color: var(--positive); }
  /* who's in it: the avatar under the channel's name */
  nav > a[data-mc^=voice-user] { display: flex; gap: 8px; min-height: 30px; padding-left: 36px; font-size: 14px; }
  nav > a[style][data-mc^=voice-user]::before { flex: none; width: 24px; height: 24px; }
  nav > a.speaking::before { box-shadow: 0 0 0 2px var(--positive); }
  nav > a.elsewhere { opacity: 0.5; }
  /* muted: the mic off; deafened: the mic and headphones off; by the server: in red */
  nav > a[data-mc^=voice-user] > b {
    margin-left: auto; padding: 0 6px; border-radius: 8px; background: var(--danger); font: 700 11px/16px "gg sans", sans-serif; color: #fff;
  }
  nav > a.mute::after { --i: var(--i-mic-off); width: 16px; height: 16px; }
  nav > a.deaf::after { width: 36px; mask: var(--i-mic-off) left / 16px no-repeat, var(--i-deaf) right / 16px no-repeat; }
  nav > a.forced::after { background: var(--danger); }
  nav > a[data-mc^=voice-user]:not(:has(> b))::after { margin-left: auto; }
  /* the voice panel: over the channel list's end, which makes room for it, so the chat keeps its size */
  &:has(> footer) > nav { padding-bottom: 64px; }
  & > footer {
    grid-area: nav; align-self: end; display: grid; background: var(--bg); grid-template-columns: 1fr auto; padding: 8px; border-top: 1px solid var(--bg-raised);
    font-size: 14px; font-weight: 600; color: var(--warning);
  }
  & > footer[data-state=RTC_CONNECTED] { color: var(--positive); }
  & > footer > small { grid-column: 1; font-weight: 400; font-size: 12px; color: var(--text-muted); }
  & > footer > button {
    --i: var(--i-hangup); grid-area: 1 / 2 / 3; width: 32px; height: 32px; border: 0; border-radius: 4px; background: none; cursor: pointer;
    color: var(--text-muted);
  }
  & > footer > button:hover { background: var(--bg-raised); color: var(--danger); }
  /* a category: its name and a chevron, lit on hover (no background) */
  nav > a.cat { --i: var(--i-chevron); display: flex; gap: 2px; margin-top: 16px; min-height: 24px; font-size: 13px; font-weight: 500; }
  nav > a.cat:hover { background: none; }
  nav > a.cat::before { display: none; }
  nav > a.cat::after { width: 12px; height: 12px; }
  nav > a.cat.collapsed::after { rotate: -90deg; }
  /* avatars (DMs, the user panel) are round, with the status as a ring; a DM's second line is its status or size */
  nav > a[style]::before, & > header[style]::before, & > button[data-mc=me]::before {
    content: ""; width: 32px; height: 32px; border-radius: 50%; background: var(--icon) center / cover;
  }
  nav > a[data-mc^=dm] { min-height: 42px; font-size: 16px; line-height: 20px; }
  nav > a > small { grid-column: 2; min-width: 0; font-size: 12px; line-height: 14px; }
  nav > a:has(> small) { align-content: center; }
  nav > a:has(> small)::before { grid-row: span 2; }
  & > header[style]::before { width: 24px; height: 24px; }
  /* the status: stock's shape at the avatar's bottom right, cut out of it. Masks, top first: the shape's cut (offline's
     hole, idle's bite, dnd's bar; inside the dot, so XOR removes it), the dot, the avatar less a ring, the avatar */
  [data-status][style]::before {
    border-radius: 0; background: radial-gradient(16% 16% at 84% 84%, var(--status) calc(100% - 1px), #0000), var(--icon) center / cover;
    mask: var(--cut, linear-gradient(#0000 0 0)), radial-gradient(16% 16% at 84% 84%, #000 calc(100% - 1px), #0000),
      radial-gradient(25% 25% at 84% 84%, #0000 calc(100% - 1px), #000), radial-gradient(50% 50%, #000 calc(100% - 1px), #0000);
    mask-composite: exclude, add, intersect;
  }
  [data-status] { --status: var(--text-muted); --cut: radial-gradient(7% 7% at 84% 84%, #000 calc(100% - 1px), #0000); }
  [data-status=online] { --status: var(--positive); --cut: initial; }
  [data-status=idle] { --status: var(--warning); --cut: var(--idle-cut) 100% 100% / 32% 32% no-repeat; }
  [data-status=dnd] { --status: var(--danger); --cut: linear-gradient(#000 0 0) 91.5% 86.2% / 18% 6% no-repeat; }
  a[data-n]::after {
    content: attr(data-n); box-sizing: border-box; min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--danger);
    font: 700 12px/16px "gg sans", sans-serif; color: #fff; text-align: center;
  }
  aside a[data-n]::after { position: absolute; right: -4px; bottom: -4px; box-shadow: 0 0 0 3px var(--bg); }
  /* the user panel (a button: it opens the account popout) */
  & > button {
    grid-area: me; display: grid; grid: auto auto / auto 1fr; column-gap: 8px; align-content: center; padding: 0 8px; border: 0;
    border-top: 1px solid var(--bg-raised); background: none; text-align: left; font: inherit; font-weight: 500; color: var(--text-strong); cursor: pointer;
  }
  & > button[data-mc=me]::before { grid-row: span 2; align-self: center; }
  & > button > small { font-size: 12px; }
  /* mute and deafen over the panel's end (user_panel.tsx) */
  & > button[data-mc=me] { padding-right: 88px; }
  & > button:is([data-mc=mute], [data-mc=deafen]) {
    justify-self: end; align-self: center; width: 32px; height: 32px; margin-right: 8px; padding: 0; border: 0; border-radius: 4px;
    grid: auto / auto; place-content: center; color: var(--text-muted);
  }
  & > button:is([data-mc=mute], [data-mc=deafen]):hover { background: var(--bg-raised); }
  & > button:is([data-mc=mute], [data-mc=deafen]).on { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
  & > button[data-mc=mute] { --i: var(--i-mic); margin-right: 44px; }
  & > button[data-mc=mute].on { --i: var(--i-mic-off); }
  & > button[data-mc=deafen] { --i: var(--i-headphones); }
  & > button[data-mc=deafen].on { --i: var(--i-deaf); }

  /* the account popout, above the panel (popovertarget makes the panel its anchor) */
  menu {
    inset: auto; margin: 0 0 8px; position-area: top span-right; width: 224px; padding: 8px; border: 0;
    border-radius: 8px; background: var(--bg-floating); color: var(--text); box-shadow: 0 8px 16px #0006;
  }
  menu:popover-open { display: grid; gap: 2px; }
  menu > button {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 4px; background: none;
    color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer;
  }
  menu > button:hover, menu > button.sel { background: var(--bg-raised); color: var(--text-strong); }
  menu > button[data-status]::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--status); }

  /* messages: column-reverse keeps the view at the bottom (scroller.ts); scroll anchoring keeps it still when rows
     arrive while scrolled up */
  .messages { grid-area: main; overflow-y: auto; display: flex; flex-direction: column-reverse; }
  .messages > div { padding: 16px 0 24px; }
  article {
    position: relative; padding: 2px 16px 2px 72px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text;
    /* offscreen rows skip style and layout until scrolled to (ai/LOG.md, 0.7) */
    content-visibility: auto; contain-intrinsic-size: auto 26px;
  }
  article:not(.head):hover::before {
    content: attr(data-t); position: absolute; left: 0; top: 2px; width: 64px; text-align: right; font-size: 11px; line-height: 22px; color: var(--text-muted);
  }
  article.head { margin-top: 16px; min-height: 48px; contain-intrinsic-size: auto 48px; }
  /* the avatar: below a reply's line (--q) */
  article.head::before {
    content: ""; position: absolute; left: 16px; top: calc(var(--q, 0px) + 4px); width: 40px; height: 40px; border-radius: 50%;
    background: var(--av) center / cover, var(--bg-raised);
  }
  article.system { color: var(--text-muted); font-style: italic; }
  article.edited::after { content: " (edited)"; font-size: 10px; color: var(--text-muted); }
  /* the author line: the name (only it underlines on hover), its time, a line break */
  article > b { font-weight: 500; color: var(--text-strong); white-space: normal; cursor: pointer; }
  article > b::before { pointer-events: none; }
  article > time[data-mc=ts] { margin-left: 8px; font-size: 12px; color: var(--text-muted); }
  article > b:hover { text-decoration: underline 1px; }
  /* The date divider and the first unread's red line with stock's NEW tag: inside the row (content-visibility clips
     what's outside it), in a clear top border, so a mention or reply's background starts below them (the last layer
     clips the colour to the padding box; the date's clip reaches the border). On one row, the date sits on the red line */
  article.day {
    border-top: 32px solid #0000; overflow-clip-margin: border-box;
    background: linear-gradient(var(--bg-raised) 0 0) 0 7px / 100% 1px no-repeat border-box, linear-gradient(#0000 0 0) padding-box;
  }
  article.day > b::before {
    content: attr(data-day); position: absolute; top: -32px; left: 50%; translate: -50%; padding: 0 4px;
    background: var(--bg); font-size: 12px; font-weight: 600; line-height: 16px; color: var(--text-muted);
  }
  article.new {
    --line: var(--new) right 16px top 1px / 36px 14px no-repeat border-box, linear-gradient(var(--danger) 0 0) 0 7px / calc(100% - 52px) 1px no-repeat border-box;
    border-top: 16px solid #0000; background: var(--line), linear-gradient(#0000 0 0) padding-box;
  }
  article.new.day { border-top-width: 32px; }
  /* mentions me: stock's tint and bar */
  article.mention { background-color: #fdb83314; box-shadow: inset 2px 0 var(--warning); }
  /* the message being replied to, as stock */
  article.replying { background-color: #5f8cfb1f; box-shadow: inset 2px 0 var(--accent); }
  /* sending, then failed with Retry and Delete */
  article.sending { color: var(--text-muted); }
  article.failed { color: var(--danger); }
  article > p[data-mc=failed] { font-size: 14px; }
  article > p[data-mc=failed] > button { margin-left: 8px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; }

  /* a reply: the replied-to message above the author line, the reply bar above the composer */
  article > q {
    position: relative; display: block; font-size: 14px; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; quotes: none;
    overflow: clip; overflow-clip-margin: 40px;
  }
  article > q > img:first-child { width: 16px; height: 16px; margin-right: 4px; border-radius: 50%; vertical-align: -3px; }
  article > q > b { margin-right: 4px; font-weight: 500; color: var(--text-strong); }
  article > q > span * { display: inline; margin: 0; padding: 0; border: 0; }
  article > q:hover { color: var(--text-strong); }
  /* the spine from the avatar's column to the replied-to message */
  article > q::before {
    content: ""; position: absolute; left: -38px; top: 9px; width: 32px; height: 13px;
    border: 2px solid var(--text-faint); border-width: 2px 0 0 2px; border-top-left-radius: 6px;
  }
  article.reply { --q: 22px; }
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
  /* link embeds (embeds.tsx): a card, the embed's colour down its left, the thumbnail beside the text, large media under it */
  article > figure {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; align-content: start; width: fit-content;
    max-width: min(100%, 516px); margin-top: 4px; padding: 0 16px 16px 12px; border-left: 4px solid var(--bg-raised);
    border-radius: 4px; background: var(--bg-raised); font-size: 14px;
  }
  article > figure > * { grid-column: 1; margin-top: 8px; }
  article > figure:has(> .media:not(.thumb)) > :not(.media) { contain: inline-size; }
  article > figure > b { font-weight: 600; color: var(--text-strong); }
  article > figure > a { font-size: 16px; font-weight: 600; }
  article > figure > .media { grid-column: 1 / -1; display: block; max-width: 100%; height: auto; margin-top: 16px; border-radius: 4px; cursor: pointer; }
  article > figure > .thumb { grid-area: 1 / 2 / span 4; margin-top: 8px; cursor: auto; }
  /* reactions as stock: a chip per emoji (Discord's images), mine ringed, then a chip to add one */
  article > p { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; white-space: normal; }
  article > p > button {
    display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 8px; border: 1px solid transparent; border-radius: 8px;
    background: var(--bg-raised); color: var(--text-muted); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  article > p > button.me { border-color: var(--accent); background-color: #5f8cfb26; color: var(--text-strong); }
  article > p > button:hover { border-color: var(--text-faint); }
  article > p > button > img:not(.media) { width: 20px; height: 20px; }
  article > p > button[data-mc="reaction:add"]::before { --i: var(--i-reaction); }
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
  /* the message menu as stock: the quick reactions as tiles, groups between lines, an icon per item */
  menu > hr { margin: 4px 8px; border: 0; border-top: 1px solid var(--bg-raised); }
  menu[data-mc=message-menu] > button { padding: 8px; font-weight: 500; }
  menu[data-mc=message-menu] > button::before { width: 18px; height: 18px; }
  menu > button[data-mc="menu:react"] { --i: var(--i-reaction); }
  menu > button[data-mc="menu:react"]::after { --i: var(--i-chevron-right); width: 16px; height: 16px; margin-left: auto; }
  menu > button[data-mc="menu:edit"] { --i: var(--i-pencil); }
  menu > button[data-mc="menu:reply"] { --i: var(--i-reply); }
  menu > button[data-mc="menu:copy"] { --i: var(--i-copy); }
  menu > button[data-mc="menu:pin"] { --i: var(--i-pin); }
  menu > button[data-mc="menu:unread"] { --i: var(--i-unread); }
  menu > button[data-mc="menu:link"] { --i: var(--i-link); }
  menu > button[data-mc="menu:delete"] { --i: var(--i-trash); }
  menu[data-mc=message-menu] > p:first-child { grid-template-columns: repeat(4, 1fr); gap: 6px; padding-bottom: 4px; }
  menu[data-mc=message-menu] > p:first-child > button { aspect-ratio: 1; display: grid; place-content: center; border-radius: 8px; background: var(--bg-raised); }
  menu > input { padding: 6px 8px; border: 0; border-radius: 4px; outline: 0; background: var(--bg-deep); color: inherit; font: inherit; }
  menu > p { display: grid; grid-template-columns: repeat(6, 1fr); }
  menu > p > button { padding: 4px; border: 0; border-radius: 4px; background: none; cursor: pointer; }
  menu > p > button:hover { background: var(--bg-raised); }
  menu > p > button > img { width: 24px; height: 24px; }

  /* the member list (members.tsx), and its toggle at the header's end */
  & > header.channel::before { width: 24px; height: 24px; color: var(--text-muted); }
  & > header > button { --i: var(--i-members); display: grid; margin-left: auto; padding: 0; border: 0; background: none; color: var(--text-muted); cursor: pointer; }
  & > header > button:hover, & > header > button.on { color: var(--text-strong); }
  section { grid-area: members; width: 240px; overflow-y: auto; padding: 8px; border-left: 1px solid var(--bg-raised); }
  section > h3 { padding: 24px 8px 4px; font-size: 14px; font-weight: 500; color: var(--text-muted); }
  section > a {
    display: flex; align-items: center; gap: 12px; height: 44px;
    padding: 0 8px; border-radius: 4px; color: var(--text-muted); white-space: nowrap; overflow: hidden;
  }
  section > a:hover { background: var(--bg-raised); }
  /* as stock: offline members dimmed, bots badged as in messages */
  section > a[data-status=offline] { opacity: 0.3; }
  section > a > i, article > b > i {
    display: inline-block; margin-left: 4px; padding: 0 4px; border-radius: 3px; background: var(--accent); color: #fff;
    font: 600 10px/15px "gg sans", sans-serif; font-style: normal; vertical-align: 2px;
  }
  section > a > i { margin-left: -8px; }
  section > a::before { content: ""; flex: none; width: 32px; height: 32px; border-radius: 50%; background: var(--icon, var(--bg-raised)) center / cover; }

  /* the message input (message_input.tsx): grows with its text, up to half the window */
  textarea {
    grid-area: compose; margin: 0 16px 16px; min-height: 56px; max-height: 50vh; padding: 16px 16px 16px 56px; resize: none;
    field-sizing: content; anchor-name: --box; border: 0; border-radius: 8px; outline: 0; background: var(--bg-raised); color: inherit; font: inherit;
  }
  textarea::placeholder { color: var(--text-faint); }
  textarea.editing { box-shadow: 0 0 0 2px var(--accent); }
  &:has(> label) > textarea { border-top-left-radius: 0; border-top-right-radius: 0; }
  /* autocomplete (message_input.tsx): a list over the messages, as wide as the box, just above it */
  menu[data-mc=autocomplete] { position-anchor: --box; width: anchor-size(width); margin: 0 0 8px; }
  menu[data-mc=autocomplete] > button > img { width: 24px; height: 24px; border-radius: 50%; }
  /* the attach button over the box's left edge, the files waiting to go as chips above it */
  & > button[data-mc=attach] {
    --i: var(--i-plus); grid-area: compose; align-self: start; justify-self: start; z-index: 1; width: 24px; height: 24px; margin: 16px 0 0 32px;
    padding: 0; border: 0; background: none; color: var(--text-muted); place-content: center; cursor: pointer;
  }
  & > button[data-mc=attach]:hover { color: var(--text-strong); }
  & > button[data-mc=attach][hidden] { display: none; }
  & > ul { grid-area: uploads; display: flex; flex-wrap: wrap; gap: 8px; margin: 0 16px; padding: 8px 0; list-style: none; }
  & > ul > button { padding: 8px 12px; border: 0; border-radius: 8px; background: var(--bg-floating); color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
  /* back to the present, at the messages' bottom right */
  & > button[data-mc=jump] {
    --i: var(--i-chevron); grid-area: main; align-self: end; justify-self: end; z-index: 2; display: grid; grid: auto / auto; width: 48px; height: 48px;
    margin: 0 28px 40px 0; padding: 0; border: 0; border-radius: 50%; background: var(--bg-floating); color: var(--text-muted);
    place-content: center; box-shadow: 0 4px 8px #0006; cursor: pointer;
  }
  & > button[data-mc=jump]::before { width: 28px; height: 28px; }
  & > button[data-mc=jump]:hover { color: var(--text-strong); }
  /* who's typing: over the messages' bottom padding, the dots in line with +, a pulse running across them; scrolled up,
     on the background with a fade above, over what scrolls under it */
  & > output {
    grid-area: main; align-self: end; z-index: 1; margin: 0 16px; padding: 0 16px; font-size: 12px; line-height: 24px; color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  & > output::before {
    content: ""; display: inline-block; width: 22px; height: 6px; margin-right: 8px; vertical-align: middle;
    background: radial-gradient(circle 3px at 3px 50%, var(--text-strong) 95%, #0000) 0 / 8px 6px;
    mask: linear-gradient(90deg, #0006 33%, #000 50%, #0006 67%) 100% / 300% 100%; animation: mc-typing 1.2s linear infinite;
  }
  &:has(> .messages.up) > output { background: var(--bg); box-shadow: 0 -8px 8px var(--bg); }
  & > output > b { font-weight: 700; color: var(--text-strong); }

  /* content (lib/content.ts) */
  article h1, article h2, article h3 { margin: 8px 0 0; line-height: 1.25; color: var(--text-strong); }
  article h1 { font-size: 24px; } article h2 { font-size: 20px; } article h3 { font-size: 16px; }
  article small { display: block; font-size: 12px; }
  article code, article pre { font: 14px/1.3 "gg mono", ui-monospace, monospace; background: var(--bg-raised); border-radius: 4px; }
  article code { padding: 0 3px; }
  article pre { display: block; padding: 8px; margin: 4px 0; }
  article blockquote { margin: 2px 0; padding-left: 12px; border-left: 4px solid var(--text-faint); border-radius: 4px; color: var(--text-muted); }
  article ul, article ol { padding-left: 24px; white-space: normal; }
  article ul { list-style: disc; } article ol { list-style: decimal; }
  /* Discord's reset (its stylesheet stays loaded for the fonts) */
  article em { font-style: italic; } article strong { font-weight: 700; }
  article a { color: var(--link); } article a:hover { text-decoration: underline; }
  article img:not(.media) { width: 22px; height: 22px; vertical-align: bottom; object-fit: contain; }
  article img.jumbo { width: 48px; height: 48px; }
  article mark { background: var(--mention-bg); color: var(--mention-fg); border-radius: 3px; padding: 0 2px; }
  article del { text-decoration: none; background: var(--bg-deep); color: transparent; border-radius: 4px; cursor: pointer; }
  article del[open] { background: var(--bg-raised); color: inherit; }
  article time:not([data-mc]) { background: var(--bg-raised); border-radius: 3px; padding: 0 2px; }
}
@keyframes mc-typing { to { mask-position: 0; } }
`;
