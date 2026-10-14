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
  'AudioServiceOutOfProcess,SpareRendererForSitePerProcess,Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
)
app.commandLine.appendSwitch('js-flags', '--heap-growing-percent=50')

// Chrome's zoom steps between 0.5 and 3
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const DEFAULT_ZOOM = 1.5

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
ipcMain.on('cordial:config', (e) => {
  e.returnValue = config()
})

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
const pushToTalk = (on) =>
  `(({ A, S }) => S.MediaEngine.getMode() === 'PUSH_TO_TALK' && A.ptt.set(S.MediaEngine.getMediaEngine(), ${on}))(cordial.adapter)`
const KEYBINDS = {
  TOGGLE_MUTE: { down: 'cordial.adapter.A.audio.toggleSelfMute()' },
  TOGGLE_DEAFEN: { down: 'cordial.adapter.A.audio.toggleSelfDeaf()' },
  PUSH_TO_TALK: { down: pushToTalk(true), up: pushToTalk(false) },
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
  const binary =
    process.env.CORDIAL_GLOBAL_KEYBINDS ?? path.join(__dirname, '../../global-keybinds/target/release/global-keybinds')
  const child = spawn(binary, { stdio: ['pipe', 'pipe', 'inherit'] })
  keybinds = child
  child.on('error', (err) => console.error('[cordial] no global keybinds:', err.message))
  child.stdin.on('error', () => {})
  child.stdin.end(known.map(([keys, action]) => `${keys}\tcordial: ${action}\n`).join(''))
  let rest = ''
  child.stdout.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()
    for (const line of lines) {
      const [, what, keys] = line.match(/^(\w+) ([^\t]*)/) ?? []
      const run = KEYBINDS[binds[keys]]?.[what]
      if (run) mainWindow?.webContents.executeJavaScript(run).catch(() => {})
      else if (what !== 'bound' && what !== 'down' && what !== 'up') console.error(`[cordial] global keybinds: ${line}`)
    }
  })
}

// game detection (adapter/native.ts): game-detection/ watches for Discord's list of games, one list at a time, and
// prints the running ones whenever they change, a line each and an empty line after
let observer = null
ipcMain.on('cordial:games', (e, list) => {
  observer?.kill()
  const binary =
    process.env.CORDIAL_GAME_DETECTION ?? path.join(__dirname, '../../game-detection/target/release/game-detection')
  const child = spawn(binary, { stdio: ['pipe', 'pipe', 'inherit'] })
  observer = child
  child.on('error', (err) => console.error('[cordial] no game detection:', err.message))
  child.stdin.on('error', () => {})
  child.stdin.end(list)
  let rest = ''
  let games = []
  child.stdout.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()
    for (const line of lines) {
      if (line) games.push(line)
      else if (!e.sender.isDestroyed()) e.sender.send('cordial:games', games.splice(0))
    }
  })
})

// discord:// links, handed to us by the desktop (the package's desktop entry; nothing here registers the scheme): their
// path on discord.com, discord://-/channels/1/2 is /channels/1/2. A second launch passes its link to this one and quits
const linkPath = (argv) => {
  const link = argv.find((arg) => arg.startsWith('discord:'))
  return link ? new URL(link).pathname.replace(/^\/*/, '/') : undefined
}
if (!app.requestSingleInstanceLock()) app.quit()
let mainWindow

app.on('second-instance', (_, argv) => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
  const to = linkPath(argv)
  if (to)
    mainWindow.webContents
      .executeJavaScript(`cordial.adapter.A.nav.transitionTo(${JSON.stringify(to)})`)
      .catch(() => {})
})

// Go Live through screen-capture's capture (its IPC: cordial:cast-*)
require('../../screen-capture/src/main/cast.js')

app.whenReady().then(() => {
  const zoomFile = path.join(app.getPath('userData'), 'zoom')
  let zoom = DEFAULT_ZOOM
  try {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(fs.readFileSync(zoomFile, 'utf8')) || DEFAULT_ZOOM))
  } catch {}

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      zoomFactor: zoom,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('dom-ready', () => mainWindow.webContents.setZoomFactor(zoom))
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input[process.platform === 'darwin' ? 'meta' : 'control']) return
    if (input.key === '=' || input.key === '+') zoom = ZOOM_STEPS.find((step) => step > zoom + 0.01) ?? MAX_ZOOM
    else if (input.key === '-') zoom = ZOOM_STEPS.findLast((step) => step < zoom - 0.01) ?? MIN_ZOOM
    else if (input.key === '0') zoom = DEFAULT_ZOOM
    else return
    event.preventDefault()
    mainWindow.webContents.setZoomFactor(zoom)
    fs.writeFile(zoomFile, String(zoom), () => {})
  })
  // right click in a text field (our own menus take theirs before it gets here): Electron's spellchecker's suggestions
  // for a misspelt word and Add to Dictionary, then the edit actions, as stock's composer menu
  mainWindow.webContents.on('context-menu', (_, params) => {
    if (!params.isEditable) return
    const contents = mainWindow.webContents
    const spelling = params.misspelledWord
      ? [
          ...params.dictionarySuggestions.map((word) => ({
            label: word,
            click: () => contents.replaceMisspelling(word),
          })),
          {
            label: 'Add to Dictionary',
            click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
          },
          { type: 'separator' },
        ]
      : []
    const edit = ['cut', 'copy', 'paste', 'selectAll'].map((role) => ({ role }))
    Menu.buildFromTemplate([...spelling, ...edit]).popup({ window: mainWindow })
  })
  // the badge from the title our UI writes (app.tsx): "(N) Discord" is N (Unity launchers and macOS show it)
  mainWindow.on('page-title-updated', (_, title) => app.setBadgeCount(+(title.match(/^\((\d+)\) /)?.[1] ?? 0)))
  // hidden rather than auto-hidden: Alt doesn't show it, its shortcuts (DevTools, reload) still work
  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadURL(`https://discord.com${linkPath(process.argv) ?? '/app'}`)
  bindKeys(config().keybinds ?? {})
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => keybinds?.kill())
