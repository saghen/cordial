// The fallback's frames for the page (main/raw.js sends them): capture's NV12 buffers arrive once each as imported
// shared textures, then (id, seq, t) per frame; each becomes a VideoFrame (on the buffer, no copy) posted on a
// MessagePort the page gets as a window message ({ mincordRawPort: true }) with the session's first buffer
// (renderer/cast.ts takes it). Runs in the preload (mincord's shell/preload.js) or a page with Node (the lab bench).

const { ipcRenderer, sharedTexture } = require('electron')

/** @param {(port: MessagePort) => void} post hands the page its port */
function receiveRaw(post) {
  let imports = new Map()
  let port = null
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, id) => {
    if (!port) {
      const ch = new MessageChannel()
      port = ch.port1
      post(ch.port2)
    }
    imports.get(id)?.release()
    imports.set(id, importedSharedTexture)
  })
  ipcRenderer.on('mincord:cast-raw', (_e, id, seq, t) => {
    const imported = imports.get(id)
    if (!imported || !port) return
    const base = imported.getVideoFrame()
    // t: capture's CLOCK_MONOTONIC in µs, Chromium's own capture clock on Linux
    const frame = new VideoFrame(base, { timestamp: t })
    base.close()
    port.postMessage({ frame, seq }, [frame])
  })
  ipcRenderer.on('mincord:cast-raw-end', () => {
    port?.close()
    port = null
    // released once the encoder and compositor are surely done with their last frames (see main/raw.js)
    const old = imports
    imports = new Map()
    setTimeout(() => old.forEach((i) => i.release()), 2000)
  })
}

module.exports = { receiveRaw }
