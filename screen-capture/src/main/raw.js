// The fallback's frames from capture ("raw", capture's main.rs) into a renderer: each of capture's NV12 buffers is
// imported once with Electron's sharedTexture and sent to the page's frame under its id; then one IPC message per frame,
// mincord:cast-raw (id, seq, t). preload/raw.js makes a VideoFrame on the import for each, which Chromium encodes.
// Imports live as long as the session: releasing one while a frame from it was still in the encoder or compositor
// crashed the renderer (approach B: the last reference then drops off the main thread).

const { sharedTexture } = require('electron')

let fdsock
/** The fd socket addon (addon/fdsock.c, $MINCORD_FDSOCK: the flake's fdsock), or null: no raw fallback. */
function loadFdsock() {
  if (fdsock !== undefined) return fdsock
  const file = process.env.MINCORD_FDSOCK
  if (!file) return (fdsock = null)
  try {
    fdsock = require(file)
  } catch (e) {
    console.log(`[cast] no raw fallback: ${file}: ${e.message}`)
    fdsock = null
  }
  return fdsock
}

/**
 * @param {Electron.WebContents} contents
 * @returns {{ message(m: import('./capture.js').RawMessage, fds: number[]): void, close(): void }}
 */
function rawRelay(contents) {
  const imports = new Map()
  return {
    message(m, fds) {
      if (m.type === 'frame') return contents.send('mincord:cast-raw', m.id, m.seq, m.t)
      if (m.type !== 'buffer') return
      let imported
      try {
        imported = sharedTexture.importSharedTexture({
          textureInfo: {
            pixelFormat: 'nv12',
            codedSize: { width: m.width, height: m.height },
            // capture's VPP: BT.709, limited range
            colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' },
            handle: {
              nativePixmap: {
                planes: m.planes.map((p) => ({ ...p, fd: fds[0] })),
                modifier: m.modifier,
                supportsZeroCopyWebGpuImport: false,
              },
            },
          },
        })
      } catch (e) {
        return console.error('[cast] raw import:', e)
      } finally {
        for (const fd of fds) fdsock.close(fd) // Electron dup'd them
      }
      // (a new size: capture's new ring reuses the ids)
      imports.get(m.id)?.release()
      imports.set(m.id, imported)
      sharedTexture
        .sendSharedTexture({ frame: contents.mainFrame, importedSharedTexture: imported }, m.id)
        .catch((e) => console.error('[cast] raw send:', e))
    },
    close() {
      for (const i of imports.values()) i.release()
      imports.clear()
      if (!contents.isDestroyed()) contents.send('mincord:cast-raw-end')
    },
  }
}

module.exports = { loadFdsock, rawRelay }
