// runs before Discord's scripts, and has to run our bundle before them too: it has to see webpack start
// (adapter/webpack.ts). executeInMainWorld is synchronous, unlike webFrame.executeJavaScript
const { contextBridge, ipcRenderer } = require('electron')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '../../dist/cordial.js'), 'utf8') + '\n//# sourceURL=cordial.js'
// Discord desktop's native modules (adapter/native.ts). CORDIAL_PRESENCE=0 leaves them out: no game detection, no Rich
// Presence

// game detection: src/shell/main.js runs game-detection/ on Discord's list of games
function observeGames(list, cb) {
  ipcRenderer.removeAllListeners('cordial:games')
  ipcRenderer.on('cordial:games', (_, games) => cb(games))
  ipcRenderer.send('cordial:games', list)
}

// Rich Presence: apps connect to discord-ipc-N (in CORDIAL_IPC_DIR if set, else where Discord desktop puts it), and
// Discord's own RPC server in the page speaks the protocol; this only carries each connection's bytes
const env = process.env
const dir = env.CORDIAL_IPC_DIR || env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp'
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
        s.on('close', () => {
          sockets.delete(id)
          cb(id, 'close')
        })
        s.on('error', () => {})
      })
      const ok = await new Promise((r) => server.once('error', () => r(false)).listen(p, () => r(true)))
      if (!ok) continue
      // a reload starts Discord's RPC server over
      window.addEventListener('pagehide', () => {
        server.close()
        sockets.forEach((s) => s.destroy())
      })
      return p
    }
    return null
  },
  write: (id, d) => sockets.get(id)?.write(d),
  end: (id, d) => sockets.get(id)?.end(d),
}
const answers = (p) =>
  new Promise((r) => {
    const s = net.connect(p, () => {
      s.destroy()
      r(true)
    })
    s.on('error', () => r(false))
  })

// Go Live through capture (screen-capture/src/main/cast.js): its frames arrive on a MessagePort, handed on to the
// page's world the way Electron documents for context isolation (screen-capture/src/renderer/cast.ts takes it)
ipcRenderer.on('cordial:cast-port', (e) => window.postMessage({ cordialCastPort: true }, '*', e.ports))
// and the fallback's frames, VideoFrames on a port of their own (screen-capture/src/preload/raw.js)
require('../../screen-capture/src/preload/raw.js').receiveRaw((port) =>
  window.postMessage({ cordialRawPort: true }, '*', [port]),
)
const cast = {
  available: () => ipcRenderer.invoke('cordial:cast-available'),
  codecs: () => ipcRenderer.invoke('cordial:cast-codecs'),
  sources: () => ipcRenderer.invoke('cordial:cast-sources'),
  start: (opts) => ipcRenderer.invoke('cordial:cast-start', opts),
  // the stream log's file (screen-capture/src/main/streamLog.js)
  log: (op, text) => ipcRenderer.send('cordial:stream-log', op, text),
}

// an image copied, or saved (src/shell/main.js)
const image = {
  copy: (url) => ipcRenderer.invoke('cordial:copy-image', url),
  save: (url) => ipcRenderer.send('cordial:save', url),
}

contextBridge.exposeInMainWorld('cordialNative', {
  cast,
  image,
  ...(process.env.CORDIAL_PRESENCE !== '0' ? { observeGames, rpc } : {}),
})
contextBridge.executeInMainWorld({
  func: (src, config) => {
    // oxlint-disable-next-line no-eval -- our bundle, run in the page's world before Discord's scripts
    globalThis.eval(src)
    window.cordial.config = config
  },
  args: [src, ipcRenderer.sendSync('cordial:config')],
})
