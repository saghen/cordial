// The fallback's frames from capture ("raw", capture's main.rs) into a renderer: each of capture's NV12 buffers is
// imported once with Electron's sharedTexture and sent to the page's frame under a key of its own; then one IPC
// message per frame, cordial:cast-raw (key, seq, t). preload/raw.js makes a VideoFrame on the import for each, which
// Chromium encodes. A new size is a new ring under the same ids: its buffers get new keys (a frame never lands on the
// old buffer of its id), and the old imports are released 2 s later (cordial:cast-raw-drop for the page's), so the last
// reference drops off the main thread: releasing one while a frame from it is still in the encoder or compositor
// crashes the renderer.

const { sharedTexture } = require('electron')
const { closeSync } = require('node:fs')

const RELEASE_MS = 2000

let fdsock
/** The fd socket addon (addon/fdsock.c, $CORDIAL_FDSOCK: the flake's fdsock), or null: no raw fallback. */
function loadFdsock() {
  if (fdsock !== undefined) return fdsock
  const file = process.env.CORDIAL_FDSOCK
  if (!file) {
    fdsock = null
    return fdsock
  }
  try {
    fdsock = require(file)
  } catch (e) {
    console.warn(`[cast] no raw fallback: ${file}: ${e.message}`)
    fdsock = null
  }
  return fdsock
}

/**
 * @param {Electron.WebContents} contents
 * @returns {{ message(message: import('./capture.js').RawMessage, fds: number[]): void, close(): void }}
 */
function rawRelay(contents) {
  /** capture's buffer id → its import and key */
  const imports = new Map()
  let keys = 0
  return {
    message(message, fds) {
      if (message.type === 'frame') {
        const entry = imports.get(message.id)
        return entry && contents.send('cordial:cast-raw', entry.key, message.seq, message.t)
      }
      if (message.type !== 'buffer') return
      let imported
      try {
        imported = sharedTexture.importSharedTexture({
          textureInfo: {
            pixelFormat: 'nv12',
            codedSize: { width: message.width, height: message.height },
            // capture's VPP: BT.709, limited range
            colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' },
            handle: {
              nativePixmap: {
                planes: message.planes.map((plane) => ({ ...plane, fd: fds[0] })),
                modifier: message.modifier,
                supportsZeroCopyWebGpuImport: false,
              },
            },
          },
        })
      } catch (e) {
        return console.error('[cast] raw import:', e)
      } finally {
        for (const fd of fds) closeSync(fd) // Electron dup'd them
      }
      const old = imports.get(message.id)
      if (old) {
        if (!contents.isDestroyed()) contents.send('cordial:cast-raw-drop', old.key)
        setTimeout(() => old.imported.release(), RELEASE_MS)
      }
      const key = ++keys
      imports.set(message.id, { imported, key })
      sharedTexture
        .sendSharedTexture({ frame: contents.mainFrame, importedSharedTexture: imported }, key)
        .catch((e) => console.error('[cast] raw send:', e))
    },
    close() {
      const old = [...imports.values()]
      imports.clear()
      if (!contents.isDestroyed()) contents.send('cordial:cast-raw-end')
      // (released as a new size's are: once no frame from them is in the encoder or compositor)
      setTimeout(() => old.forEach((entry) => entry.imported.release()), RELEASE_MS)
    },
  }
}

module.exports = { loadFdsock, rawRelay }
