import { ICONS } from './icons'

// All of the renderer's CSS. The root is one grid; list rows are subgrids of their list (icon, label, badge). Elements
// are styled by tag, nested under the root so Discord's own layers never see these rules, and each region's rules under
// its element so they can't reach another's.

export const CSS = `
#mincord-root {
  --bg: #1e1e2e; --bg-raised: #2c2c3f; --bg-selected: #363645; --bg-floating: #313244; --bg-deep: #11111b; --accent: #5f8cfb; --link: #89b4fa;
  --text: #efeff1; --text-strong: #fbfbfb; --text-muted: #96979e; --text-faint: #4f505a;
  --mention-bg: #5f8cfb3d; --mention-fg: #a9bbff; --danger: #da3e44; --positive: #3d9e60; --warning: #fdb833;
  ${ICONS}
  --i: var(--i-hash);
  position: fixed; inset: 0; z-index: 1; display: grid;
  grid: "notice notice notice notice" auto "servers side head head" 48px "servers panels call members" auto "servers panels main members" 1fr
    "servers panels uploads members" auto "servers panels reply members" auto "servers panels compose members" auto
    / 72px 300px minmax(0, 1fr) auto;
  background: var(--bg); color: var(--text); font: 16px/1.375 "gg sans", "Noto Sans", sans-serif;

  & * { margin: 0; box-sizing: border-box; }
  /* the base (no specificity of its own): buttons are bare, fields sunk, floating panels raised */
  :where(button) { border: 0; background: none; cursor: pointer; }
  :where(input:not([type=range], [type=checkbox], [type=radio], [type=file]), select) { border: 0; border-radius: 4px; background: var(--bg-deep); color: var(--text); font: inherit; }
  :where(menu, [popover]:not(.search-results), dialog.incoming) { border: 0; border-radius: 8px; background: var(--bg-floating); color: var(--text); box-shadow: 0 8px 16px #0006; }
  a { cursor: pointer; color: inherit; text-decoration: none; }
  small { font-size: 14px; font-weight: 500; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }
  /* scrollbars: a thumb, no arrows (the standard scrollbar-* properties would turn these off), shown while the scroller
     is hovered. Through a custom property: Chromium restyles a scrollbar's parts on a change to the scroller's own
     style, not on :hover alone (a :not(:hover) thumb rule painted only on the next scroll) */
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-thumb { border: 2px solid #0000; border-radius: 6px; background: var(--thumb, #0000) padding-box; }
  ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: none; }
  :hover { --thumb: var(--bg-floating); }

  & > p { grid-area: notice; padding: 8px; text-align: center; background: var(--accent); color: var(--text-strong); }
  & > h1, & > header {
    display: flex; align-items: center; gap: 8px; padding: 0 16px; border-bottom: 1px solid var(--bg-raised);
    font-size: 16px; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden;
  }
  & > h1 { grid-area: side; }

  /* Discord's icons (icons.ts): a mask over the text colour, --i picks which */
  nav > a:not([style])::before, nav > a.cat::after, nav > a:is(.mute, .deaf)::after, & > header.channel::before,
  & > header > button::before, section.side > footer > button::before, & > button:not(.user-panel)::before, section.side > button:not(.user-panel)::before, div.box > button::before, div.open > a.folder::before, aside > button.add-server::before, dialog.incoming > button::before, section.call > figure:is(.mute, .deaf)::after, section.call > footer > button[title]::before,
  menu.message-menu > button::before, menu.autocomplete > button.ch::before, article > p > button.reaction-add::before,
  div.search-results > h2 > button::before, article.call::before, menu > nav > button[style]::before, menu > h3 > button::before {
    content: ""; flex: none; width: 20px; height: 20px; background: currentColor; mask: var(--i) center / contain no-repeat;
  }
  /* avatars (DMs, the user panel) are round, with the status as a ring */
  nav > a[style]::before, & > header[style]::before, button.user-panel::before {
    content: ""; width: 32px; height: 32px; border-radius: 50%; background: var(--icon) center / cover;
  }
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
  :is(nav > a, & > header, menu > button.ch) {
    &.news { --i: var(--i-announce); }
    &.nsfw { --i: var(--i-hash-nsfw); }
    &.lock { --i: var(--i-hash-lock); }
  }

  /* the server bar: stock's squircles (its BlobMask path, within 0.1 px), the pill on the left for unread, hovered and
     selected. The top padding centres the DMs button on the header row */
  aside {
    grid-area: servers; display: grid; align-content: start; justify-items: center; gap: 8px; overflow-y: auto; padding: 4px 0 12px;
    border-right: 1px solid var(--bg-raised); scrollbar-width: none;
    a {
      width: 40px; height: 40px; border-radius: 13px; corner-shape: superellipse(1.3); display: grid; place-items: center; position: relative;
      background: var(--icon, none) center / cover, var(--bg-raised); font-size: 16px; font-weight: 500; color: var(--text-strong);
      transition: background-color 0.15s;
    }
    a[style] { background-color: transparent; }
    a:not([style]):is(:hover, .sel) { background-color: var(--accent); }
    a.dm { border-radius: 50%; corner-shape: round; }
    a::before {
      content: ""; position: absolute; left: -16px; width: 4px; height: 0; border-radius: 0 4px 4px 0;
      background: var(--text-strong); transition: height 0.15s;
    }
    a.unread::before { height: 8px; }
    a:hover::before { height: 20px; }
    a.sel::before { height: 40px; }
    /* the DMs button: a bare bubble (Liam's design), grey, lavender while hovered or open */
    a.dms { background: var(--img-chat) center / 24px no-repeat; }
    a.dms:is(:hover, .sel) { background: var(--img-chat-on) center / 24px no-repeat; }
    a[data-n]::after { position: absolute; right: -4px; bottom: -4px; box-shadow: 0 0 0 3px var(--bg); }
    /* folders, as stock measures them: closed, a 48 px tile of four; open, the folder icon in its colour over its
       servers, on one column */
    > div { display: grid; gap: 8px; justify-items: center; width: 48px; border-radius: 16px; }
    > div.open { padding: 4px 0 8px; background: #97979f1f; }
    a.folder {
      width: 48px; height: 48px; grid: 1fr 1fr / 1fr 1fr; gap: 2px; padding: 4px; border-radius: 16px; corner-shape: round;
      background: #97979f1f;
    }
    a.folder:hover { background-color: #97979f33; }
    a.folder::before { left: -12px; }
    > div.open > a.folder { width: 40px; height: 40px; border-radius: 12px; grid: auto / auto; place-items: center; background: none; color: var(--folder); }
    > div.open > a.folder:hover { background-color: #97979f33; }
    > div.open > a.folder::before { position: static; --i: var(--i-folder); transition: none; }
    a.folder > i {
      width: 19px; height: 19px; border-radius: 4px; display: grid; place-items: center; overflow: hidden;
      background: var(--icon, none) center / cover, var(--bg); font: 500 8px/1 "gg sans", sans-serif;
      &:nth-child(1) { border-top-left-radius: 13px; } &:nth-child(2) { border-top-right-radius: 13px; }
      &:nth-child(3) { border-bottom-left-radius: 13px; } &:nth-child(4) { border-bottom-right-radius: 13px; }
    }
    > hr { width: 32px; margin-top: -5px; border: 0; border-top: 1px solid var(--bg-raised); }
    /* Add a Server: a + tile at the bar's end, its form beside the bar */
    > button.add-server {
      --i: var(--i-plus); display: grid; place-content: center; width: 40px; height: 40px; border-radius: 12px; background: var(--bg-raised);
      color: var(--positive);
    }
    > button.add-server::before { width: 20px; height: 20px; }
    > button.add-server:hover { background: var(--positive); color: #fff; }
  }
  form:is(.join, .login) {
    > label { display: grid; gap: 8px; color: var(--text-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; }
    input { padding: 8px; text-transform: none; }
    > button { padding: 8px; border-radius: 4px; background: var(--accent); color: #fff; font: inherit; font-weight: 500; }
    > button:disabled { opacity: .5; cursor: default; }
  }
  form.join {
    position: fixed; inset: 48px auto auto 80px; width: 360px; padding: 16px; font-size: 14px;
    &:popover-open { display: grid; gap: 12px; }
    > p { display: grid; grid-template-columns: 48px 1fr; column-gap: 12px; align-items: center; font-weight: 600; }
    > p[style]::before { content: ""; grid-row: 1 / 3; width: 48px; height: 48px; border-radius: 16px; background: var(--icon) center / cover; }
    > p > small { grid-column: 2; font-weight: 400; color: var(--text-muted); }
  }
  /* logged out (login.tsx): the form alone, centred */
  form.login {
    grid-area: 1 / 1 / -1 / -1; place-self: center; display: grid; gap: 16px; width: min(480px, 100% - 32px); padding: 32px;
    border-radius: 8px; background: var(--bg-floating); font-size: 14px;
    > h2 { font-size: 24px; text-align: center; color: var(--text-strong); }
    > p[role=alert] { color: var(--danger); }
    > button[type=button] { justify-self: start; padding: 0; background: none; color: var(--link); }
  }

  /* the channel list and the DMs. A row reaches the list's edge with a clear left border, where the unread pill goes;
     its colour stays in the padding box */
  nav { grid-area: nav; display: grid; align-content: start; overflow-y: auto; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px; padding: 8px; }
  nav > a {
    grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; column-gap: 8px;
    min-height: 32px; margin-left: -8px; padding: 0 8px; border-left: 8px solid #0000; border-radius: 16px 8px 8px 16px / 8px;
    background-clip: padding-box; color: var(--text-muted); font-size: 16px; font-weight: 500; line-height: 20px; white-space: nowrap; overflow: hidden;
    &:not([style])::before { width: 18px; height: 18px; }
    &.unread {
      background: radial-gradient(circle at 0 50%, var(--text-strong) 3.5px, #0000 4px) 0 50% / 4px 8px no-repeat border-box, none padding-box;
      color: var(--text-strong); font-weight: 600;
    }
    &:hover, &.sel { background-color: var(--bg-raised); color: var(--text-strong); }
    &.sel { background-color: var(--bg-selected); }
    &.muted { color: var(--text-faint); }
    &.voice { --i: var(--i-voice); }
    &.voice.lock { --i: var(--i-voice-lock); }
    /* someone in it: the icon green, how long the call has gone on at the end */
    &.live::before { color: var(--positive); }
    &.voice[data-time]::after { content: attr(data-time); grid-column: 3; font: 12px "gg mono", ui-monospace, monospace; color: var(--positive); }
    /* who's in it: the avatar under the channel's name */
    &.voice-user { display: flex; gap: 8px; min-height: 30px; padding-left: 36px; font-size: 14px; }
    &[style].voice-user::before { flex: none; width: 24px; height: 24px; }
    &.speaking::before { box-shadow: 0 0 0 2px var(--positive); }
    &.elsewhere { opacity: 0.5; }
    /* muted: the mic off; deafened: the mic and headphones off; by the server: in red */
    &.voice-user > b {
      margin-left: auto; padding: 0 6px; border-radius: 8px; background: var(--danger); font: 700 11px/16px "gg sans", sans-serif; color: #fff;
    }
    &.mute::after { --i: var(--i-mic-off); width: 16px; height: 16px; }
    &.deaf::after { width: 36px; mask: var(--i-mic-off) left / 16px no-repeat, var(--i-deaf) right / 16px no-repeat; }
    &.forced::after { background: var(--danger); }
    &.voice-user:not(:has(> b))::after { margin-left: auto; }
    /* a category: its name and a chevron, lit on hover (no background) */
    &.cat { --i: var(--i-chevron); display: flex; gap: 2px; margin-top: 16px; min-height: 24px; font-size: 13px; line-height: 16px; font-weight: 500; }
    &.cat:first-child { margin-top: 0; }
    &.cat:hover { background: none; }
    &.cat::before { display: none; }
    &.cat::after { width: 12px; height: 12px; }
    &.cat.collapsed::after { rotate: -90deg; }
    /* a DM's second line is its status or size */
    &.dm { min-height: 42px; }
    > small { grid-column: 2; min-width: 0; font-size: 12px; line-height: 16px; }
    &:has(> small) { align-content: center; }
    &:has(> small)::before { grid-row: span 2; }
  }

  /* the side column: the channel list or the DMs, then the voice panel and the user panel, each in its own row, so
     neither panel covers the list */
  section.side { grid-area: panels; display: grid; grid: "nav" minmax(0, 1fr) "voice" auto "me" 60px / minmax(0, 1fr); }
  /* the voice panel. Rows: the voice settings when open, the status, the channel; the buttons a column each beside
     the last two */
  section.side > footer {
    grid-area: voice; display: grid; background: var(--bg); grid: auto auto auto / 1fr repeat(5, auto); padding: 8px; border-top: 1px solid var(--bg-raised);
    font-size: 14px;
    > b { grid-area: 2 / 1; font-weight: 600; color: var(--warning); }
    &[data-state=RTC_CONNECTED] > b { color: var(--positive); }
    > small { grid-area: 3 / 1; font-size: 12px; color: var(--text-muted); }
    > button:nth-of-type(2) { grid-column: 3; } > button:nth-of-type(3) { grid-column: 4; }
    > button:nth-of-type(4) { grid-column: 5; } > button:nth-of-type(5) { grid-column: 6; }
    > button.voice-camera { --i: var(--i-video-slash); }
    > button.voice-camera.on { --i: var(--i-video); color: var(--positive); }
    > button.voice-camera:hover { color: var(--text-strong); }
    > button {
      --i: var(--i-hangup); grid-area: 2 / 2 / 4; display: grid; place-content: center; width: 32px; height: 32px; border-radius: 4px;
      color: var(--text-muted);
    }
    > button:hover { background: var(--bg-raised); color: var(--danger); }
    > button.voice-settings-button { --i: var(--i-settings); }
    > button.voice-soundboard { --i: var(--i-soundboard); }
    > button.voice-screen { --i: var(--i-screen); }
    > button.voice-screen.on { --i: var(--i-screen-x); color: var(--positive); }
    > button:is(.voice-screen, .voice-soundboard, .voice-settings-button):hover, > button.voice-settings-button.on { color: var(--text-strong); }
  }
  /* Go Live's picker: a list of the sources, modal */
  dialog.screen-picker {
    width: min(480px, 100% - 32px); max-height: 80vh; padding: 16px; border: 0; border-radius: 8px; background: var(--bg-floating);
    color: var(--text); font-size: 14px; box-shadow: 0 8px 16px #0006;
    &[open] { display: grid; gap: 8px; }
    &::backdrop { background: #000a; }
    > h2 { font-size: 20px; color: var(--text-strong); }
    > button { display: grid; justify-items: start; padding: 8px 12px; border-radius: 4px; background: var(--bg-raised); color: var(--text-strong); font: inherit; font-weight: 600; }
    > button:hover { background: var(--bg-selected); }
    > button.screen-cancel { justify-self: end; background: none; color: var(--text-muted); font-weight: 500; }
    > label { display: flex; gap: 8px; align-items: center; color: var(--text-muted); }
    select { padding: 4px; }
  }
  /* the soundboard: each server's sounds as tiles, over the panel */
  menu.soundboard {
    inset: auto auto 72px 80px; width: 420px; max-height: 60vh; overflow-y: auto;
    > h3 { padding: 8px 4px 0; font-size: 12px; text-transform: uppercase; color: var(--text-muted); }
    > p { grid-template-columns: repeat(3, 1fr); gap: 8px; }
    > p > button { display: flex; gap: 6px; align-items: center; padding: 8px; border-radius: 8px; background: var(--bg-raised); color: var(--text); font: inherit; font-size: 13px; text-align: left; overflow: hidden; }
    > p > button.on { outline: 2px solid var(--positive); }
    > p > button:disabled { opacity: 0.4; cursor: default; }
    > p > button > img { width: 20px; height: 20px; object-fit: contain; }
  }
  /* the voice settings: a column of labelled controls, a section of the voice panel above its line */
  form.voice-settings {
    grid-area: 1 / 1 / 2 / -1; display: grid; gap: 12px; max-height: 60vh; overflow-y: auto; margin: 0 -8px 8px; padding: 4px 8px 12px;
    border-bottom: 1px solid var(--bg-raised); font-weight: 500;
    :is(label:has(> select), label:has(> [type=range]), fieldset) { display: grid; gap: 4px; color: var(--text-muted); font-size: 12px; text-transform: uppercase; }
    fieldset { margin: 0; padding: 0; border: 0; }
    fieldset > label { text-transform: none; font-size: 14px; color: var(--text); }
    label:has(> [type=checkbox], > [type=radio]) { display: flex; gap: 8px; align-items: center; }
    select { padding: 6px; text-transform: none; }
    input { accent-color: var(--accent); }
  }

  /* the user panel (a button: it opens the account popout), and mute and deafen over its end (user_panel.tsx) */
  section.side > button {
    grid-area: me; display: grid; grid: auto auto / auto 1fr; column-gap: 8px; align-content: center; padding: 0 8px;
    border-top: 1px solid var(--bg-raised); text-align: left; font: inherit; font-weight: 500; color: var(--text-strong);
    &.user-panel::before { grid-row: span 2; align-self: center; }
    > small { font-size: 12px; }
    &.user-panel { padding-right: 88px; }
    &:is(.self-mute, .self-deafen) {
      justify-self: end; align-self: center; width: 32px; height: 32px; margin-right: 8px; padding: 0; border: 0; border-radius: 4px;
      grid: auto / auto; place-content: center; color: var(--text-muted);
      &:hover { background: var(--bg-raised); }
      &.on { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    }
    &.self-mute { --i: var(--i-mic); margin-right: 44px; }
    &.self-mute.on { --i: var(--i-mic-off); }
    &.self-deafen { --i: var(--i-headphones); }
    &.self-deafen.on { --i: var(--i-deaf); }
  }

  /* menus: the account popout above the panel (popovertarget makes the panel its anchor), the context menus at the
     pointer, the pickers above the box */
  menu {
    inset: auto; margin: 0 0 8px; position-area: top span-right; width: 224px; padding: 8px;
    &:popover-open { display: grid; gap: 2px; }
    > button { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; color: inherit; font: inherit; font-size: 14px; text-align: left; }
    > button:hover, > button.sel { background: var(--bg-raised); color: var(--text-strong); }
    > button[data-status]::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--status); }
    > button.danger { color: var(--danger); }
    > button:disabled { opacity: 0.5; cursor: default; }
    > hr { margin: 4px 8px; border: 0; border-top: 1px solid #ffffff1a; }
    > button.menu-react { --i: var(--i-reaction); }
    > button.menu-edit { --i: var(--i-pencil); } > button.menu-reply { --i: var(--i-reply); }
    > button.menu-copy { --i: var(--i-copy); } > button.menu-pin { --i: var(--i-pin); }
    > button.menu-unread { --i: var(--i-unread); } > button.menu-link { --i: var(--i-link); }
    > button.menu-delete { --i: var(--i-trash); }
    > input { padding: 6px 8px; outline: 0; color: inherit; }
    > p { display: grid; grid-template-columns: repeat(6, 1fr); }
    > p > button { padding: 4px; border-radius: 4px; }
    > p > button:hover { background: var(--bg-raised); }
    > p > button > img { width: 24px; height: 24px; object-fit: contain; }
    &:is(.message-menu, .server-menu, .channel-menu, .devices) { position: fixed; margin: 0; }
  }
  /* the message menu as stock: the quick reactions as tiles, groups between lines, an icon per item */
  menu.message-menu {
    > button { padding: 8px; font-weight: 500; }
    > button::before { width: 18px; height: 18px; }
    > p:first-child { grid-template-columns: repeat(4, 1fr); gap: 6px; padding-bottom: 4px; }
    > p:first-child > button { aspect-ratio: 1; display: grid; place-content: center; border-radius: 8px; background: var(--bg-raised); }
  }

  /* messages: column-reverse keeps the view at the bottom (scroller.ts); scroll anchoring keeps it still when rows
     arrive while scrolled up */
  .messages { grid-area: main; overflow-y: auto; display: flex; flex-direction: column-reverse; }
  .messages > div { padding: 16px 0 24px; }
  article {
    position: relative; padding: 2px 16px 2px 72px; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text;
    /* offscreen rows skip style and layout until scrolled to (ai/LOG.md, Key finds) */
    content-visibility: auto; contain-intrinsic-size: auto 26px;
    &:not(.head):hover::before {
      content: attr(data-t); position: absolute; left: 0; top: 2px; width: 64px; text-align: right; font-size: 11px; line-height: 22px; color: var(--text-muted);
    }
    &.head { margin-top: 16px; min-height: 48px; contain-intrinsic-size: auto 48px; }
    /* the avatar: below a reply's line (--q) */
    &.head::before {
      content: ""; position: absolute; left: 16px; top: calc(var(--q, 0px) + 4px); width: 40px; height: 40px; border-radius: 50%;
      background: var(--av) center / cover, var(--bg-raised);
    }
    /* a system message: stock's container adds 2 px above and below the line */
    &.system { padding-block: 4px; color: var(--text-muted); }
    &.system:hover::before { top: 4px; }
    /* a DM call: stock's handset in the avatar's column, green (grey and mirrored when missed) */
    &.call::before, &.call:hover::before { content: ""; position: absolute; left: 28px; top: 7px; width: 16px; height: 16px; --i: var(--i-call-joined); background: var(--positive); }
    &.call.missed::before { --i: var(--i-call-missed); background: var(--text-muted); }
    /* a collapsed run of blocked or ignored messages: one line on its first row, stock's "N blocked messages" */
    &.gone { display: none; }
    > button:is(.blocked-show, .ignored-show) { padding: 0; color: var(--text-muted); font: inherit; font-size: 14px; }
    > button:is(.blocked-show, .ignored-show):hover { text-decoration: underline; }
    &.edited::after { content: " (edited)"; font-size: 10px; color: var(--text-muted); }
    /* the author line: the name (only it underlines on hover), its time, a line break */
    > b { font-weight: 500; color: var(--text-strong); white-space: normal; cursor: pointer; }
    > b::before { pointer-events: none; }
    > time.ts { margin-left: 8px; font-size: 12px; color: var(--text-muted); }
    &.system > time.ts { margin-left: 4px; }
    > b:hover { text-decoration: underline 1px; }
    /* The date divider and the first unread's red line with stock's NEW tag: inside the row (content-visibility clips
       what's outside it), in a clear top border, so a mention or reply's background starts below them (the last layer
       clips the colour to the padding box; the date's clip reaches the border). On one row, the date sits on the red line */
    &.day {
      border-top: 32px solid #0000; overflow-clip-margin: border-box;
      background: linear-gradient(var(--bg-raised) 0 0) 0 7px / 100% 1px no-repeat border-box, linear-gradient(#0000 0 0) padding-box;
    }
    &.day > b[data-day]::before {
      content: attr(data-day); position: absolute; top: -32px; left: 50%; translate: -50%; padding: 0 4px;
      background: var(--bg); font-size: 12px; font-weight: 600; line-height: 16px; color: var(--text-muted);
    }
    &.new {
      --line: var(--new) right 16px top 1px / 36px 14px no-repeat border-box, linear-gradient(var(--danger) 0 0) 0 7px / calc(100% - 52px) 1px no-repeat border-box;
      border-top: 16px solid #0000; background: var(--line), linear-gradient(#0000 0 0) padding-box;
    }
    &.new.day { border-top-width: 32px; }
    /* mentions me: stock's tint and bar; the message being replied to, as stock */
    &.mention { background-color: #fdb83314; box-shadow: inset 2px 0 var(--warning); }
    &.replying { background-color: #5f8cfb1f; box-shadow: inset 2px 0 var(--accent); }
    /* sending, then failed with Retry and Delete */
    &.sending { color: var(--text-muted); }
    &.failed { color: var(--danger); }
    > p.failed { font-size: 14px; }
    > p.failed > button { margin-left: 8px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; }
    /* a reply: the replied-to message above the author line, with the spine from the avatar's column to it */
    > q {
      position: relative; display: block; font-size: 14px; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; quotes: none;
      overflow: clip; overflow-clip-margin: 40px;
    }
    > q > img:first-child { width: 16px; height: 16px; margin-right: 4px; border-radius: 50%; vertical-align: -3px; }
    > q > b { margin-right: 4px; font-weight: 500; color: var(--text-strong); }
    > q > span * { display: inline; margin: 0; padding: 0; border: 0; }
    > q:hover { color: var(--text-strong); }
    > q::before {
      content: ""; position: absolute; left: -38px; top: 9px; width: 32px; height: 13px;
      border: 2px solid var(--text-faint); border-width: 2px 0 0 2px; border-top-left-radius: 6px;
    }
    &.reply { --q: 22px; }
    /* a command's line: not a link; the command in the link colour */
    > q.command { cursor: auto; }
    > q.command > span { color: var(--link); }
    /* a forward: stock's "Forwarded" line, then the message inside a bar */
    > blockquote.forward { display: block; margin: 4px 0; padding-left: 12px; border-left: 4px solid var(--bg-raised); }
    > blockquote.forward::before { content: "Forwarded"; display: block; font-size: 14px; font-style: italic; color: var(--text-muted); }
    /* attachments: media at its scaled size (width and height attributes), other files as a link with the size */
    > .media { display: block; max-width: 100%; height: auto; margin-top: 4px; border-radius: 8px; background: var(--bg-raised); }
    > a.file {
      display: flex; width: fit-content; max-width: 100%; gap: 8px; margin-top: 4px; padding: 10px 12px;
      border: 1px solid var(--bg-raised); border-radius: 8px; background: var(--bg-deep); white-space: normal;
    }
    > a.file::after { content: attr(data-size); color: var(--text-muted); font-size: 12px; align-self: center; }
    /* link embeds (embeds.tsx): a card, the embed's colour down its left, the thumbnail beside the text, large media under it */
    > figure {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; align-content: start; width: fit-content;
      max-width: min(100%, 516px); margin-top: 4px; padding: 0 16px 16px 12px; border-left: 4px solid var(--bg-raised);
      border-radius: 4px; background: var(--bg-raised); font-size: 14px;
      > * { grid-column: 1; margin-top: 8px; }
      &:has(> .media:not(.thumb)) > :not(.media) { contain: inline-size; }
      > b { font-weight: 600; color: var(--text-strong); }
      > a { font-size: 16px; font-weight: 600; }
      > .media { grid-column: 1 / -1; display: block; max-width: 100%; height: auto; margin-top: 16px; border-radius: 4px; cursor: pointer; }
      > .thumb { grid-area: 1 / 2 / span 4; margin-top: 8px; cursor: auto; }
    }
    /* reactions as stock: a chip per emoji (Discord's images), mine ringed, then a chip to add one */
    > p { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; white-space: normal; }
    > p > button {
      display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 8px; border: 1px solid transparent; border-radius: 8px;
      background: var(--bg-raised); color: var(--text-muted); font: inherit; font-size: 15px; font-weight: 600;
    }
    > p > button.me { border-color: var(--accent); background-color: #5f8cfb26; color: var(--text-strong); }
    > p > button:hover { border-color: var(--text-faint); }
    > p > button > img:not(.media) { width: 20px; height: 20px; object-fit: contain; }
    > p > button.reaction-add::before { --i: var(--i-reaction); }
  }
  /* the reply bar above the composer */
  & > label {
    grid-area: reply; display: flex; align-items: center; gap: 8px; margin: 0 16px; padding: 6px 12px;
    border-radius: 8px 8px 0 0; background: var(--bg-floating); font-size: 14px; color: var(--text-muted);
    > b { color: var(--text-strong); font-weight: 600; margin-right: auto; }
    > button { color: inherit; font: inherit; }
    > button.on { color: var(--accent); font-weight: 700; }
  }

  /* the header: the channel's name and topic; its buttons, the member list's toggle last */
  & > header {
    grid-area: head;
    &[style]::before { width: 24px; height: 24px; }
    &.channel::before { width: 24px; height: 24px; color: var(--text-muted); }
    > button { --i: var(--i-members); display: grid; padding: 0; color: var(--text-muted); }
    > button:first-of-type { margin-left: auto; }
    > button + button { margin-left: 16px; }
    > button:hover, > button.on { color: var(--text-strong); }
    > button.call-start { --i: var(--i-call); }
    > button.call-video { --i: var(--i-video); }
    /* notification settings (header.tsx): mute with its durations on hover, then the levels as radios */
    > button.notifications { --i: var(--i-bell); }
    > button.notifications.muted { --i: var(--i-bell-slash); }
    /* pins: a dot while there are new ones, cut out of the icon by a ring of the header's background */
    > button.pins { --i: var(--i-pin); position: relative; }
    > button.pins.unread::after { content: ""; position: absolute; right: -1px; bottom: 1px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--bg); }
    /* search: a box at the header's end, wider while in use */
    > input.search {
      width: 160px; height: 28px; margin-left: 16px; padding: 0 8px; outline: 0; font-size: 14px; transition: width 0.2s;
      &:focus { width: 240px; }
    }
  }
  menu.notifications-menu {
    margin: 8px 0 0; position-area: bottom span-left; overflow: visible;
    > button { display: grid; grid-template-columns: 1fr auto; column-gap: 8px; }
    > button > small { grid-column: 1; font-size: 12px; }
    > button.on::after, > button.notifications-level::after {
      content: ""; grid-area: 1 / 2 / span 2; align-self: center; width: 10px; height: 10px; border: 2px solid currentColor; border-radius: 50%;
    }
    > button.on::after { border-color: var(--accent); background: radial-gradient(var(--accent) 45%, transparent 50%); }
    > menu { display: none; position: absolute; inset: 0 auto auto 100%; margin: 0; }
    > button:hover + menu, > menu:hover { display: grid; }
  }
  /* the pins under their button, the search results down the right side under the header: messages as cards, Jump on
     hover */
  div:is(.pins-list, .search-results) {
    overflow-y: auto; padding: 0 0 16px; font-weight: 400;
    > h2 { padding: 16px; font-size: 16px; font-weight: 600; color: var(--text-strong); }
    > article.head { margin: 0 8px 8px; padding-top: 8px; padding-bottom: 8px; border-radius: 4px; background: var(--bg); }
    > article > button { position: absolute; top: 8px; right: 8px; display: none; }
    > article:hover > button { display: block; }
    button { padding: 2px 8px; border-radius: 4px; background: var(--bg-raised); color: var(--text-strong); font: inherit; font-size: 12px; }
  }
  div.pins-list {
    inset: auto; margin: 8px 0 0; position-area: bottom span-left; width: 420px; max-height: 70vh;
    > p { padding: 16px; color: var(--text-muted); text-align: center; }
    > button { display: block; margin: 0 auto; }
  }
  div.search-results {
    inset: 48px 0 0 auto; width: 420px; height: auto; margin: 0; border: 0; border-left: 1px solid var(--bg-raised); background: var(--bg-deep);
    color: var(--text);
    > h2 { display: flex; }
    > h2 > button { --i: var(--i-close); margin-left: auto; padding: 0; background: none; color: var(--text-muted); }
    > :is(p, nav) { display: flex; justify-content: center; align-items: center; gap: 16px; padding: 16px; color: var(--text-muted); }
    > article > small { margin-left: 8px; color: var(--text-muted); font-size: 12px; }
    button:disabled { opacity: 0.5; cursor: default; }
  }

  /* the member list (members.tsx): as stock, offline members dimmed, bots badged as in messages */
  section.members {
    grid-area: members; width: 240px; overflow-y: auto; padding: 8px; border-left: 1px solid var(--bg-raised);
    > h3 { padding: 16px 8px 4px; font-size: 13px; font-weight: 500; color: var(--text-muted); }
    > h3:first-child { padding-top: 0; }
    > a {
      display: flex; align-items: center; gap: 12px; height: 44px;
      padding: 0 8px; border-radius: 4px; color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden;
    }
    > a:hover { background: var(--bg-raised); }
    > a[data-status=offline] { opacity: 0.3; }
    > a::before { content: ""; flex: none; width: 32px; height: 32px; border-radius: 50%; background: var(--icon, var(--bg-raised)) center / cover; }
  }
  section.members > a > i, article > b > i {
    display: inline-block; margin-left: 4px; padding: 0 4px; border-radius: 3px; background: var(--accent); color: #fff;
    font: 600 10px/15px "gg sans", sans-serif; font-style: normal; vertical-align: 2px;
  }
  section.members > a > i { margin-left: -8px; }

  /* the message box (message_input.tsx): a grid of the attach button, the text, then the pickers (pickers.tsx) in
     stock's order, GIF, sticker, emoji, each in a column of its own, so the text never runs under them. The text grows
     with its lines, up to half the window; the buttons stay on the first line; the pickers open above */
  div.box {
    grid-area: compose; display: grid; grid: "attach text gif sticker emoji" auto / auto minmax(0, 1fr) auto auto auto;
    column-gap: 16px; align-items: start; margin: 0 16px 16px; padding: 0 16px; anchor-name: --box; border-radius: 8px;
    background: var(--bg-raised);
    &[hidden] { display: none; }
    &:has(> textarea.editing) { box-shadow: 0 0 0 2px var(--accent); }
    > textarea {
      grid-area: text; min-height: 56px; max-height: 50vh; padding: 16px 0; resize: none; field-sizing: content;
      border: 0; outline: 0; background: none; color: inherit; font: inherit;
    }
    > textarea::placeholder { color: var(--text-faint); }
    > button { --i: var(--i-reaction); grid-area: emoji; display: grid; place-content: center; width: 24px; height: 24px; margin-top: 16px; padding: 0; border: 0; color: var(--text-muted); }
    > button:hover { color: var(--text-strong); }
    > button[hidden] { display: none; }
    > button.attach { --i: var(--i-plus); grid-area: attach; }
    > button.gif-button { --i: var(--i-gif); grid-area: gif; }
    > button.sticker-button { --i: var(--i-sticker); grid-area: sticker; }
  }
  &:has(> label) > div.box { border-top-left-radius: 0; border-top-right-radius: 0; }
  /* autocomplete: a list over the messages, as wide as the box, just above it; stock's sizes: headings 12/600 caps,
     rows 16 px with the hint at 12 px on the right, 24 px avatars (with the status), 20 px emoji, 16 px channel icons,
     dividers between the @ list's sections */
  menu.autocomplete {
    position-anchor: --box; width: anchor-size(width); margin: 0 0 8px; border-radius: 5px; gap: 0;
    > h3 { margin: 0 0 8px; padding: 4px 0; font-size: 12px; font-weight: 600; line-height: 16px; text-transform: uppercase; color: var(--text-muted); }
    > hr { margin: 8px 0; }
    > button { padding: 8px; border-radius: 3px; color: var(--text-strong); font-size: 16px; line-height: 20px; }
    > button:has(> img) { min-height: 31px; padding: 4px 8px; }
    > button > img { width: 20px; height: 20px; object-fit: contain; }
    > button[data-status]::before { content: ""; flex: none; width: 24px; height: 24px; }
    > button.ch::before { width: 16px; height: 16px; color: var(--text-muted); }
    > button > small { margin-left: auto; padding-left: 16px; font-size: 12px; font-weight: 400; line-height: 16px; white-space: nowrap; }
  }
  /* the pickers, as stock's: a search field with its magnifier; emoji and stickers as sections under sticky names,
     a rail of them on the left, the hovered one named below; GIFs as darkened tiles, then results in two columns */
  menu:is(.emoji-picker, .gif-picker, .sticker-picker) {
    position-area: top span-left; width: 480px; padding: 0; gap: 0; overflow: hidden;
    > input {
      margin: 12px; padding: 8px 8px 8px 36px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--bg-raised);
      background: var(--img-search) 10px center / 18px no-repeat, var(--bg-deep);
    }
    > input:focus { box-shadow: inset 0 0 0 1px var(--accent); }
  }
  menu:is(.emoji-picker, .sticker-picker):popover-open {
    display: grid; grid: "search search" auto "rail list" 380px "foot foot" auto / 48px minmax(0, 1fr);
    > input { grid-area: search; }
    > nav { grid-area: rail; display: flex; flex-direction: column; align-items: center; gap: 8px; overflow-y: auto; padding: 4px 0 8px; scrollbar-width: none; }
    > nav > button { display: grid; place-content: center; width: 32px; height: 32px; padding: 0; border-radius: 8px; color: var(--text-muted); font: 600 11px/1 sans-serif; }
    > nav > button:hover { background: var(--bg-raised); color: var(--text-strong); }
    > nav > button > img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
    > div { grid-area: list; overflow-y: auto; padding: 0 8px 8px 4px; }
    > div > h3 { position: sticky; top: 0; z-index: 1; padding: 8px 4px; background: var(--bg-floating); font-size: 13px; font-weight: 600; color: var(--text-muted); }
    /* a section not built yet: as tall as its rows (--n items, --cols to a row of --row) */
    > div > p { display: grid; grid-template-columns: repeat(var(--cols), 1fr); margin: 0; }
    > div > p:empty { height: calc(round(up, var(--n) / var(--cols), 1) * var(--row)); }
    > div > p > button { display: grid; place-content: center; padding: 4px; border-radius: 6px; }
    > div > p > button:hover { background: var(--bg-raised); }
    > footer { grid-area: foot; display: grid; grid: auto auto / 28px 1fr; column-gap: 10px; align-items: center; min-height: 52px; padding: 8px 16px; background: var(--bg-deep); }
    > footer > img { grid-row: span 2; width: 28px; height: 28px; object-fit: contain; }
    > footer > b { grid-column: 2; font-size: 14px; font-weight: 600; color: var(--text-strong); }
    > footer > small { grid-column: 2; font-size: 12px; color: var(--text-muted); }
  }
  menu.emoji-picker {
    --cols: 9; --row: 40px;
    > div > p > button > img { width: 32px; height: 32px; object-fit: contain; }
  }
  /* a Lottie sticker by its name, as the chat shows one */
  menu.sticker-picker {
    --cols: 4; --row: 100px;
    > div > p { gap: 4px; }
    > div > p > button { aspect-ratio: 1; color: var(--text-muted); font: inherit; font-size: 13px; }
    > div > p > button > img { width: 88px; height: 88px; }
  }
  menu.gif-picker {
    > h3 { display: flex; align-items: center; gap: 12px; margin: 12px; min-height: 36px; font-size: 16px; font-weight: 600; color: var(--text-strong); }
    > h3 > button { --i: var(--i-back); display: grid; padding: 0; color: var(--text-muted); }
    > h3 > button:hover { color: var(--text-strong); }
    > :is(p, div) { height: 400px; overflow-y: auto; padding: 0 12px 12px; }
    > p { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 110px; gap: 8px; align-content: start; }
    > p > button {
      display: grid; place-content: center; padding: 0; border-radius: 8px; color: #fff; font-size: 16px; font-weight: 700;
      background: linear-gradient(#0000008c 0 0), var(--img, linear-gradient(var(--accent) 0 0)) center / cover;
    }
    > p > button:hover { background: linear-gradient(#00000059 0 0), var(--img, linear-gradient(var(--accent) 0 0)) center / cover; }
    /* results in two columns inside the scroller (a column box of fixed height would overflow into more columns) */
    > div > div { columns: 2; column-gap: 8px; }
    > div > div > button { display: block; width: 100%; margin-bottom: 8px; padding: 0; border-radius: 8px; overflow: hidden; break-inside: avoid; }
    > div > div > button > :is(img, video) { display: block; width: 100%; height: auto; }
  }
  & > ul { grid-area: uploads; display: flex; flex-wrap: wrap; align-items: start; gap: 8px; margin: 0 16px; padding: 8px 0; list-style: none; }
  & > ul > button { padding: 8px 12px; border-radius: 8px; background: var(--bg-floating); color: inherit; font: inherit; font-size: 14px; }
  /* an image's card: the image above its name */
  & > ul > button[style] { display: grid; gap: 8px; width: 216px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; }
  & > ul > button[style]::before { content: ""; height: 168px; background: var(--preview) center / contain no-repeat; }
  /* back to the present, at the messages' bottom right */
  & > button.jump {
    --i: var(--i-chevron); grid-area: main; align-self: end; justify-self: end; z-index: 2; display: grid; grid: auto / auto; width: 48px; height: 48px;
    margin: 0 28px 40px 0; padding: 0; border: 0; border-radius: 50%; background: var(--bg-floating); color: var(--text-muted);
    place-content: center; box-shadow: 0 4px 8px #0006;
    &::before { width: 28px; height: 28px; }
    &:hover { color: var(--text-strong); }
  }

  /* the call view: a tile per person (avatar, name, a ring while speaking), Join below them; a camera fills its tile,
     under the name; someone's Go Live: Watch Stream until watched, then the stream, larger and letterboxed */
  & > section.call {
    grid-area: call; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 16px; background: var(--bg-deep);
  }
  section.call {
    > figure {
      display: grid; place-items: end start; width: 160px; height: 90px; padding: 6px 8px; border-radius: 8px; font-size: 14px; font-weight: 500;
      background: var(--icon, none) center / 48px no-repeat, var(--bg-raised); outline: 2px solid transparent; outline-offset: -2px;
      position: relative; z-index: 0;
    }
    > figure > video { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; border-radius: 8px; object-fit: cover; }
    > figure.stream { place-items: center; align-content: center; gap: 8px; background: var(--bg-raised); }
    > figure.stream.watching { width: 480px; height: 270px; place-items: end start; align-content: stretch; background: #000; }
    > figure.stream > video { object-fit: contain; }
    > figure.stream > span::after { content: " · LIVE"; color: var(--danger); font-weight: 700; }
    > figure.stream > button { padding: 4px 12px; border-radius: 4px; background: var(--bg-selected); color: var(--text-strong); font: inherit; }
    > figure.stream.watching > button { position: absolute; inset: 6px 8px auto auto; opacity: .8; }
    > figure.speaking { outline-color: var(--positive); }
    > figure.mute { --i: var(--i-mic-off); }
    > figure.deaf { --i: var(--i-deaf); }
    > figure:is(.mute, .deaf)::after { grid-area: 1 / 1; place-self: start end; width: 16px; height: 16px; color: var(--danger); }
    /* a DM call without cameras or streams, as stock's: round avatars, the name on hover, the icon at the bottom right */
    &.dm:not(:has(video, figure.stream)) > figure {
      width: 80px; height: 80px; padding: 0; border-radius: 50%; font-size: 0; background: var(--icon, none) center / cover, var(--bg-raised); outline-offset: 2px;
    }
    &.dm:not(:has(video, figure.stream)) > figure:is(.mute, .deaf)::after { place-self: end end; width: 20px; height: 20px; }
  }
  /* Join on a row of its own below the tiles; a DM's are icons */
  section.call > footer { display: flex; flex-basis: 100%; justify-content: center; gap: 8px; }
  section.call > footer > button[title] { display: grid; place-content: center; width: 56px; height: 40px; padding: 0; --i: var(--i-call); }
  section.call > footer > button.call-join-video { --i: var(--i-video); }
  section.call > footer > button, dialog.incoming > button {
    padding: 8px 16px; border-radius: 4px; background: var(--positive); color: #fff; font: inherit; font-size: 14px; font-weight: 500;
  }
  /* a call ringing for you, at the top of the window */
  dialog.incoming {
    position: fixed; inset: 16px 0 auto; z-index: 3; display: grid; grid-template-columns: 1fr auto auto; gap: 4px 8px; align-items: center; width: 280px;
    padding: 16px 16px 16px 80px; background: var(--icon) 16px center / 48px no-repeat, var(--bg-floating);
    > small { grid-column: 1; color: var(--text-muted); }
    > button { --i: var(--i-voice); display: grid; place-content: center; grid-row: 1 / 3; width: 40px; height: 40px; padding: 0; border-radius: 50%; }
    > button.incoming-decline { --i: var(--i-hangup); background: var(--danger); }
  }
  /* the new messages bar, across the messages' top */
  & > div.new-messages {
    grid-area: main; align-self: start; z-index: 2; display: flex; margin: 0 16px; border-radius: 0 0 8px 8px; background: var(--accent);
    color: #fff; font-size: 14px; font-weight: 500; line-height: 24px;
    > button { padding: 0 12px; color: inherit; font: inherit; }
    > button:first-child { flex: 1; text-align: left; }
  }
  /* the media viewer (chat.tsx): the whole window, so a click outside the image lands on the dialog itself */
  dialog.viewer {
    width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: none;
    &[open] { display: grid; place-content: center; justify-items: center; gap: 8px; }
    &::backdrop { background: #000c; }
    > img { max-width: 90vw; max-height: 85vh; object-fit: contain; }
    > a { font-size: 14px; color: var(--text-muted); }
  }
  img[data-full] { cursor: zoom-in; }
  /* who's typing: over the messages' bottom padding, the dots in line with +, a pulse running across them; scrolled up,
     on the background with a fade above, over what scrolls under it */
  & > output {
    grid-area: main; align-self: end; z-index: 1; margin: 0 16px; padding: 0 16px; font-size: 12px; line-height: 24px; color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    &::before {
      content: ""; display: inline-block; width: 22px; height: 6px; margin-right: 8px; vertical-align: middle;
      background: radial-gradient(circle 3px at 3px 50%, var(--text-strong) 95%, #0000) 0 / 8px 6px;
      mask: linear-gradient(90deg, #0006 33%, #000 50%, #0006 67%) 100% / 300% 100%; animation: mc-typing 1.2s linear infinite;
    }
    > b { font-weight: 700; color: var(--text-strong); }
  }
  &:has(> .messages.up) > output { background: var(--bg); box-shadow: 0 -8px 8px var(--bg); }

  /* content (lib/content.ts); Discord's reset (its stylesheet stays loaded for the fonts) needs em and strong back */
  article {
    :is(h1, h2, h3) { margin: 8px 0 0; line-height: 1.25; color: var(--text-strong); }
    h1 { font-size: 24px; } h2 { font-size: 20px; } h3 { font-size: 16px; }
    small { display: block; font-size: 12px; font-weight: 400; }
    code, pre { font: 14px/1.3 "gg mono", ui-monospace, monospace; background: var(--bg-raised); border-radius: 4px; }
    code { padding: 0 3px; }
    pre { display: block; padding: 8px; margin: 4px 0; }
    blockquote { margin: 2px 0; padding-left: 12px; border-left: 4px solid var(--text-faint); border-radius: 4px; color: var(--text-muted); }
    ul, ol { padding-left: 24px; white-space: normal; }
    ul { list-style: disc; } ol { list-style: decimal; }
    em { font-style: italic; } strong { font-weight: 700; }
    a { color: var(--link); } a:hover { text-decoration: underline; }
    img:not(.media) { width: 22px; height: 22px; vertical-align: bottom; object-fit: contain; }
    img.jumbo { width: 48px; height: 48px; }
    :is(img, i).sticker { display: block; width: 160px; height: 160px; margin-top: 4px; }
    i.sticker { display: grid; place-content: center; border-radius: 8px; background: var(--bg-raised); color: var(--text-muted); font-size: 14px; }
    mark { background: var(--mention-bg); color: var(--mention-fg); border-radius: 3px; padding: 0 2px; }
    del { text-decoration: none; background: var(--bg-deep); color: transparent; border-radius: 4px; cursor: pointer; }
    del[open] { background: var(--bg-raised); color: inherit; }
    time:not(.ts) { background: var(--bg-raised); border-radius: 3px; padding: 0 2px; }
  }
}
@keyframes mc-typing { to { mask-position: 0; } }
`
