const { app, BrowserWindow, globalShortcut, ipcMain, Menu, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// Discord's web client, as Chrome would load it
app.userAgentFallback = app.userAgentFallback.replace(/ (mincord|Electron)\/\S+/g, '')

// Trims (ai/LOG.md Key finds, measured as each process's USS): the audio service in the browser process (one process
// less, 10 MB), Chrome services Discord doesn't use; and V8's heap growing by half rather than doubling, which halves
// the full GCs that cause switch spikes at the same memory
app.commandLine.appendSwitch(
  'disable-features',
  'AudioServiceOutOfProcess,SpareRendererForSitePerProcess,Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
)
app.commandLine.appendSwitch('js-flags', '--heap-growing-percent=50')
// global shortcuts through the desktop's portal on Wayland (Chrome's own, X11, elsewhere)
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

// Chrome's zoom steps between 0.5 and 3
const steps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

// <userData>/config.json, read on each load: { "warm": N } preloads the N most used channels (default 5, 0 for none);
// { "keybinds": { "Ctrl+Shift+M": "TOGGLE_MUTE", ... } } are global shortcuts (read at start)
const config = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'))
  } catch {
    return {}
  }
}
ipcMain.on('mincord:config', (e) => (e.returnValue = config()))

// what a global shortcut does (stock's keybind actions): presses only, so no push to talk (ai/LOG.md question 8)
const KEYBINDS = {
  TOGGLE_MUTE: 'mincord.adapter.A.audio.toggleSelfMute()',
  TOGGLE_DEAFEN: 'mincord.adapter.A.audio.toggleSelfDeaf()',
}

// game detection (adapter/games.ts): game-detection/ watches for Discord's list of games, one list at a time, and
// prints the running ones whenever they change, a line each and an empty line after
let observer = null
ipcMain.on('mincord:games', (e, list) => {
  observer?.kill()
  const bin =
    process.env.MINCORD_GAME_DETECTION ?? path.join(__dirname, '../../game-detection/target/release/game-detection')
  const p = (observer = spawn(bin, { stdio: ['pipe', 'pipe', 'inherit'] }))
  p.on('error', (err) => console.error('[mincord] no game detection:', err.message))
  p.stdin.on('error', () => {})
  p.stdin.end(list)
  let rest = '',
    games = []
  p.stdout.on('data', (d) => {
    const lines = (rest + d).split('\n')
    rest = lines.pop()
    for (const l of lines) {
      if (l) games.push(l)
      else if (!e.sender.isDestroyed()) e.sender.send('mincord:games', games.splice(0))
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
  if (to) win.webContents.executeJavaScript(`mincord.adapter.A.nav.transitionTo(${JSON.stringify(to)})`).catch(() => {})
})

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false, zoomFactor: zoom },
  })
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
  win.loadURL(`https://discord.com${linkPath(process.argv) ?? '/app'}`)
  for (const [keys, action] of Object.entries(config().keybinds ?? {})) {
    const run = KEYBINDS[action]
    if (!run || !globalShortcut.register(keys, () => win.webContents.executeJavaScript(run).catch(() => {})))
      console.error(`[mincord] keybind ${keys} (${action}) not registered`)
  }
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => globalShortcut.unregisterAll())
