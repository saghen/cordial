// The fallback's frames for the page (main/raw.js sends them): capture's NV12 buffers arrive once each as imported
// shared textures under their key, then (key, seq, t) per frame (dropped while its buffer's import is still on its
// way); each becomes a VideoFrame (on the buffer, no copy) posted on a MessagePort the page gets as a window message
// ({ cordialRawPort: true }) with the session's first buffer (renderer/cast.ts takes it). Runs in the preload
// (src/shell/preload.js) or a page with Node.

const { ipcRenderer, sharedTexture } = require('electron')

/** @param {(port: MessagePort) => void} post hands the page its port */
function receiveRaw(post) {
  let imports = new Map()
  let port = null
  const release = (list) => setTimeout(() => list.forEach((i) => i.release()), 2000)
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, key) => {
    if (!port) {
      const ch = new MessageChannel()
      port = ch.port1
      post(ch.port2)
    }
    imports.set(key, importedSharedTexture)
  })
  // a new size: the old buffer's import goes once the encoder and compositor are surely done with it (main/raw.js)
  ipcRenderer.on('cordial:cast-raw-drop', (_e, key) => {
    const imported = imports.get(key)
    imports.delete(key)
    if (imported) release([imported])
  })
  ipcRenderer.on('cordial:cast-raw', (_e, key, seq, t) => {
    const imported = imports.get(key)
    if (!imported || !port) return
    const base = imported.getVideoFrame()
    // t: capture's CLOCK_MONOTONIC in µs, Chromium's own capture clock on Linux
    const frame = new VideoFrame(base, { timestamp: t })
    base.close()
    port.postMessage({ frame, seq }, [frame])
  })
  ipcRenderer.on('cordial:cast-raw-end', () => {
    port?.close()
    port = null
    // released once the encoder and compositor are surely done with their last frames (see main/raw.js)
    release([...imports.values()])
    imports = new Map()
  })
}

module.exports = { receiveRaw }
