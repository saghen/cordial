const { app, BrowserWindow, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// Discord's web client, as Chrome would load it
app.userAgentFallback = app.userAgentFallback.replace(/ (mincord|Electron)\/\S+/g, '')

// Chrome's zoom steps between 0.5 and 3
const steps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

// <userData>/config.json, read on each load: { "warm": N } preloads the N most used channels (default 5, 0 for none)
ipcMain.on('mincord:config', (e) => {
  try {
    e.returnValue = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'))
  } catch {
    e.returnValue = {}
  }
})

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

app.whenReady().then(() => {
  const zoomFile = path.join(app.getPath('userData'), 'zoom')
  let zoom = 1.5
  try {
    zoom = Math.min(3, Math.max(0.5, Number(fs.readFileSync(zoomFile, 'utf8')) || 1.5))
  } catch {}

  const win = new BrowserWindow({
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
  // hidden rather than auto-hidden: Alt doesn't show it, its shortcuts (DevTools, reload) still work
  win.setMenuBarVisibility(false)
  win.loadURL('https://discord.com/app')
})

app.on('window-all-closed', () => app.quit())
