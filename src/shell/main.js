const { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, net, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// Discord's web client, as Chrome would load it
app.userAgentFallback = app.userAgentFallback.replace(/ (cordial|Electron)\/\S+/g, '')

// Trims (measured as each process's USS): the audio service in the browser process (one process less, 10 MB), Chrome
// services Discord doesn't use; and V8's heap growing by half rather than doubling, which halves the full GCs that
// cause switch spikes at the same memory
app.commandLine.appendSwitch(
  'disable-features',
  'AudioServiceOutOfProcess,SpareRendererForSitePerProcess,Translate,MediaRouter,OptimizationHints,AutofillServerCommunication' +
    (process.env.CORDIAL_EXP_DISABLE ? ',' + process.env.CORDIAL_EXP_DISABLE : ''),
)
app.commandLine.appendSwitch(
  'js-flags',
  '--heap-growing-percent=50' + (process.env.CORDIAL_EXP_JS ? ' ' + process.env.CORDIAL_EXP_JS : ''),
)
// EXPERIMENT (memory): extra switches by env
if (process.env.CORDIAL_EXP_ENABLE) app.commandLine.appendSwitch('enable-features', process.env.CORDIAL_EXP_ENABLE)
for (const sw of (process.env.CORDIAL_EXP_SWITCHES ?? '').split(' ').filter(Boolean))
  app.commandLine.appendSwitch(...sw.split('='))

// Chrome's zoom steps between 0.5 and 3
const steps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

// <userData>/config.json, read on each load: { "warm": N } preloads the N most used channels (default 5, 0 for none);
// { "keybinds": { "Ctrl+Shift+M": "TOGGLE_MUTE", ... } } are global shortcuts (read at start): TOGGLE_MUTE,
// TOGGLE_DEAFEN, PUSH_TO_TALK
const config = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'))
  } catch {
    return {}
  }
}
ipcMain.on('cordial:config', (e) => (e.returnValue = config()))

// an image's actions (the viewer's menu, Ctrl+C there): copied to the clipboard (PNG or JPEG: nativeImage reads no
// other), saved through Electron's save dialog. Fetched here: the page's fetch is cross-origin to Discord's media
ipcMain.handle('cordial:copy-image', async (_, url) => {
  const image = nativeImage.createFromBuffer(Buffer.from(await (await net.fetch(url)).arrayBuffer()))
  if (!image.isEmpty()) clipboard.writeImage(image)
  return !image.isEmpty()
})
ipcMain.on('cordial:save', (e, url) => e.sender.downloadURL(url))

// what a global shortcut does (stock's keybind actions) on its press and release. Push to talk is held while the
// keys are down, in push to talk's input mode only (as stock's)
const PTT = (on) =>
  `(({ A, S }) => S.MediaEngine.getMode() === 'PUSH_TO_TALK' && A.ptt.set(S.MediaEngine.getMediaEngine(), ${on}))(cordial.adapter)`
const KEYBINDS = {
  TOGGLE_MUTE: { down: 'cordial.adapter.A.audio.toggleSelfMute()' },
  TOGGLE_DEAFEN: { down: 'cordial.adapter.A.audio.toggleSelfDeaf()' },
  PUSH_TO_TALK: { down: PTT(true), up: PTT(false) },
}

// global keybinds: global-keybinds/ binds config.json's through the desktop's GlobalShortcuts portal and prints their
// presses and releases ("down Ctrl+Shift+M", "up ..."); Electron's globalShortcut reports presses only. Off a desktop
// whose portal has GlobalShortcuts (wlroots, X11) there are none
let keybinds = null
function bindKeys(binds) {
  const known = Object.entries(binds).filter(([keys, action]) => {
    if (!KEYBINDS[action]) console.error(`[cordial] keybind ${keys}: no action ${action}`)
    return KEYBINDS[action]
  })
  if (!known.length) return
  const bin =
    process.env.CORDIAL_GLOBAL_KEYBINDS ?? path.join(__dirname, '../../global-keybinds/target/release/global-keybinds')
  const p = (keybinds = spawn(bin, { stdio: ['pipe', 'pipe', 'inherit'] }))
  p.on('error', (err) => console.error('[cordial] no global keybinds:', err.message))
  p.stdin.on('error', () => {})
  p.stdin.end(known.map(([keys, action]) => `${keys}\tcordial: ${action}\n`).join(''))
  let rest = ''
  p.stdout.on('data', (d) => {
    const lines = (rest + d).split('\n')
    rest = lines.pop()
    for (const l of lines) {
      const [, what, keys] = l.match(/^(\w+) ([^\t]*)/) ?? []
      const run = KEYBINDS[binds[keys]]?.[what]
      if (run) win?.webContents.executeJavaScript(run).catch(() => {})
      else if (what === 'bound') console.log(`[cordial] global keybind ${l.slice(6)}`)
      else if (what !== 'down' && what !== 'up') console.error(`[cordial] global keybinds: ${l}`)
    }
  })
}

// game detection (adapter/native.ts): game-detection/ watches for Discord's list of games, one list at a time, and
// prints the running ones whenever they change, a line each and an empty line after
let observer = null
ipcMain.on('cordial:games', (e, list) => {
  observer?.kill()
  const bin =
    process.env.CORDIAL_GAME_DETECTION ?? path.join(__dirname, '../../game-detection/target/release/game-detection')
  const p = (observer = spawn(bin, { stdio: ['pipe', 'pipe', 'inherit'] }))
  p.on('error', (err) => console.error('[cordial] no game detection:', err.message))
  p.stdin.on('error', () => {})
  p.stdin.end(list)
  let rest = '',
    games = []
  p.stdout.on('data', (d) => {
    const lines = (rest + d).split('\n')
    rest = lines.pop()
    for (const l of lines) {
      if (l) games.push(l)
      else if (!e.sender.isDestroyed()) e.sender.send('cordial:games', games.splice(0))
    }
  })
})

// discord:// links, handed to us by the desktop (the package's desktop entry; nothing here registers the scheme): their
// path on discord.com, discord://-/channels/1/2 is /channels/1/2. A second launch passes its link to this one and quits
const linkPath = (argv) => {
  const link = argv.find((a) => a.startsWith('discord:'))
  return link ? new URL(link).pathname.replace(/^\/*/, '/') : undefined
}
if (!app.requestSingleInstanceLock()) app.quit()
let win

app.on('second-instance', (_, argv) => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  const to = linkPath(argv)
  if (to) win.webContents.executeJavaScript(`cordial.adapter.A.nav.transitionTo(${JSON.stringify(to)})`).catch(() => {})
})

// Go Live through screen-capture's capture (its IPC: cordial:cast-*)
require('../../screen-capture/src/main/cast.js')

app.whenReady().then(() => {
  const zoomFile = path.join(app.getPath('userData'), 'zoom')
  let zoom = 1.5
  try {
    zoom = Math.min(3, Math.max(0.5, Number(fs.readFileSync(zoomFile, 'utf8')) || 1.5))
  } catch {}

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      zoomFactor: zoom,
      ...(process.env.CORDIAL_EXP_NOSPELL ? { spellcheck: false } : {}),
    },
  })
  // EXPERIMENT (memory): hide the window after N s, as in the tray
  if (process.env.CORDIAL_EXP_HIDE) setTimeout(() => win.hide(), Number(process.env.CORDIAL_EXP_HIDE) * 1000)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('dom-ready', () => win.webContents.setZoomFactor(zoom))
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input[process.platform === 'darwin' ? 'meta' : 'control']) return
    if (input.key === '=' || input.key === '+') zoom = steps.find((s) => s > zoom + 0.01) ?? 3
    else if (input.key === '-') zoom = steps.findLast((s) => s < zoom - 0.01) ?? 0.5
    else if (input.key === '0') zoom = 1.5
    else return
    event.preventDefault()
    win.webContents.setZoomFactor(zoom)
    fs.writeFile(zoomFile, String(zoom), () => {})
  })
  // right click in a text field (our own menus take theirs before it gets here): Electron's spellchecker's suggestions
  // for a misspelt word and Add to Dictionary, then the edit actions, as stock's composer menu
  win.webContents.on('context-menu', (_, p) => {
    if (!p.isEditable) return
    const wc = win.webContents
    const spelling = p.misspelledWord
      ? [
          ...p.dictionarySuggestions.map((word) => ({ label: word, click: () => wc.replaceMisspelling(word) })),
          {
            label: 'Add to Dictionary',
            click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord),
          },
          { type: 'separator' },
        ]
      : []
    const edit = ['cut', 'copy', 'paste', 'selectAll'].map((role) => ({ role }))
    Menu.buildFromTemplate([...spelling, ...edit]).popup({ window: win })
  })
  // the badge from the title our UI writes (app.tsx): "(N) Discord" is N (Unity launchers and macOS show it)
  win.on('page-title-updated', (_, title) => app.setBadgeCount(+(title.match(/^\((\d+)\) /)?.[1] ?? 0)))
  // hidden rather than auto-hidden: Alt doesn't show it, its shortcuts (DevTools, reload) still work
  win.setMenuBarVisibility(false)
  win.loadURL(process.env.CORDIAL_EXP_BLANK ? 'about:blank' : `https://discord.com${linkPath(process.argv) ?? '/app'}`)
  bindKeys(config().keybinds ?? {})
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => keybinds?.kill())
