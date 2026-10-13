// runs before Discord's scripts, and has to run our bundle before them too: it has to see webpack start
// (adapter/webpack.ts). executeInMainWorld is synchronous, unlike webFrame.executeJavaScript
const { contextBridge, ipcRenderer } = require('electron')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '../../dist/mincord.js'), 'utf8') + '\n//# sourceURL=mincord.js'
// Discord desktop's native modules (adapter/native.ts). MINCORD_PRESENCE=0 leaves them out: no game detection, no Rich
// Presence (the lab's read-only accounts)

// game detection: shell/main.js runs game-detection/ on Discord's list of games
function observeGames(list, cb) {
  ipcRenderer.removeAllListeners('mincord:games')
  ipcRenderer.on('mincord:games', (_, games) => cb(games))
  ipcRenderer.send('mincord:games', list)
}

// Rich Presence: apps connect to discord-ipc-N (in MINCORD_IPC_DIR, for the lab, else as Discord desktop), and Discord's
// own RPC server in the page speaks the protocol; this only carries each connection's bytes
const dir = process.env.MINCORD_IPC_DIR ?? process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? '/tmp'
const sockets = new Map()
const rpc = {
  async listen(cb) {
    for (let i = 0; i < 10; i++) {
      const p = path.join(dir, `discord-ipc-${i}`)
      // another client's, or a stale one left by a crash
      if (fs.existsSync(p) && (await answers(p))) continue
      fs.rmSync(p, { force: true })
      let next = 0
      const server = net.createServer((s) => {
        const id = ++next
        sockets.set(id, s)
        cb(id, 'connect')
        s.on('data', (d) => cb(id, 'data', new Uint8Array(d)))
        s.on('close', () => (sockets.delete(id), cb(id, 'close')))
        s.on('error', () => {})
      })
      const ok = await new Promise((r) => server.once('error', () => r(false)).listen(p, () => r(true)))
      if (!ok) continue
      // a reload starts Discord's RPC server over
      window.addEventListener('pagehide', () => (server.close(), sockets.forEach((s) => s.destroy())))
      return p
    }
    return null
  },
  write: (id, d) => sockets.get(id)?.write(d),
  end: (id, d) => sockets.get(id)?.end(d),
}
const answers = (p) =>
  new Promise((r) => {
    const s = net.connect(p, () => (s.destroy(), r(true)))
    s.on('error', () => r(false))
  })

// Go Live through capture (screen-capture/src/main/cast.js): its frames arrive on a MessagePort, handed on to the
// page's world the way Electron documents for context isolation (screen-capture/src/renderer/cast.ts takes it)
ipcRenderer.on('mincord:cast-port', (e) => window.postMessage({ mincordCastPort: true }, '*', e.ports))
const cast = {
  available: () => ipcRenderer.invoke('mincord:cast-available'),
  sources: () => ipcRenderer.invoke('mincord:cast-sources'),
  start: (opts) => ipcRenderer.invoke('mincord:cast-start', opts),
}

contextBridge.exposeInMainWorld('mincordNative', {
  cast,
  ...(process.env.MINCORD_PRESENCE !== '0' ? { observeGames, rpc } : {}),
})
contextBridge.executeInMainWorld({
  func: (src, config) => ((0, eval)(src), (window.mincord.config = config)),
  args: [src, ipcRenderer.sendSync('mincord:config')],
})
