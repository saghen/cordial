// capture (screen-capture/capture) as a child process: its stdout messages parsed, commands written to its stdin. No
// Electron in here, so it runs under plain Node too.

const { spawn } = require('node:child_process')
const { closeSync } = require('node:fs')

const MAGIC = 0x315a5343 // "CSZ1"
const FRAME = 2
const INFO = 3
const PREVIEW = 4
const AUDIO = 5
/** No message (capture sends stats every second) for this long: it's stuck. */
const STALL_MS = 3000

/**
 * @typedef {{ type: 'frame', seq: number, t: number, key: boolean, w: number, h: number, data: ArrayBuffer }
 *   | { type: 'preview', t: number, w: number, h: number, data: ArrayBuffer }
 *   | { type: 'audio', t: number, rate: number, channels: number, data: ArrayBuffer }
 *   | { type: 'info', t: number, info: any }
 *   | { type: 'raw', raw: RawMessage, fds: number[] }
 *   | { type: 'closed', why: string }} CaptureMessage
 * @typedef {{ type: 'buffer', id: number, width: number, height: number, modifier: string,
 *   planes: { offset: number, stride: number, size: number }[] } | { type: 'frame', id: number, seq: number, t: number }}
 *   RawMessage  on raw's socket (capture's main.rs): fds, ours to close, come with a buffer
 * @typedef {{ type: 'start', kbps: number, height?: number } | { type: 'raw' }
 *   | { type: 'bitrate', kbps: number } | { type: 'key' } | { type: 'height', height: number } | { type: 'fps', fps: number }
 *   | { type: 'audio', target: string } | { type: 'stop' }} CaptureCommand  audio: off | pid=N | steam=N | name=S
 * @typedef {{ pid: number | undefined, send(c: CaptureCommand): void, kill(): void }} Capture
 */

/** @param {CaptureCommand} c */
function commandLine(c) {
  switch (c.type) {
    case 'start':
      return `start kbps=${c.kbps | 0}${c.height ? ` height=${c.height | 0}` : ''}`
    case 'bitrate':
      return `bitrate ${c.kbps | 0}`
    case 'height':
      return `height ${c.height | 0}`
    case 'fps':
      return `fps ${c.fps | 0}`
    case 'audio':
      return `audio ${c.target.replace(/\s/g, '')}`
    default:
      return c.type
  }
}

/**
 * Starts capture; every message (and finally "closed") goes to onMessage. With fdsock (addon/fdsock.c), capture gets
 * raw's socket as fd 3 ("raw": the fallback's frames, as raw messages).
 * @param {string} bin
 * @param {string[]} args
 * @param {(m: CaptureMessage) => void} onMessage
 * @param {NodeJS.ProcessEnv} [env]
 * @param {any} [fdsock]
 * @returns {Capture}
 */
function startCapture(bin, args, onMessage, env, fdsock) {
  const [sock, childSock] = fdsock ? fdsock.open() : []
  let closed = false
  // stderr ignored: capture then logs to $XDG_RUNTIME_DIR/cordial-capture/<pid>.log
  const child = spawn(bin, fdsock ? [...args, '--socket-fd', '3'] : args, {
    stdio: ['pipe', 'pipe', 'ignore', ...(fdsock ? [childSock] : [])],
    env,
  })
  if (fdsock) {
    closeSync(childSock)
    fdsock.listen(sock, (data, fds) => {
      if (!data) return closeSync(sock)
      if (closed) return fds.forEach((fd) => closeSync(fd))
      try {
        onMessage({ type: 'raw', raw: JSON.parse(data.toString()), fds })
      } catch (e) {
        fds.forEach((fd) => closeSync(fd))
        console.error('[capture] bad raw message', e)
      }
    })
  }
  let buf = Buffer.alloc(0)
  let last = Date.now()
  const close = (why) => {
    if (closed) return
    closed = true
    clearInterval(watchdog)
    if (child.exitCode == null) child.kill('SIGKILL')
    onMessage({ type: 'closed', why })
  }
  const watchdog = setInterval(() => {
    if (Date.now() - last > STALL_MS) close(`no message for ${STALL_MS} ms`)
  }, 500)
  child.stdout.on('data', (chunk) => {
    last = Date.now()
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    while (buf.length >= 24) {
      if (buf.readUInt32LE(0) !== MAGIC) return close('bad message')
      const size = buf.readUInt32LE(8)
      if (buf.length < 24 + size) break
      const type = buf.readUInt32LE(4)
      const t = buf.readUInt32LE(16) + buf.readUInt32LE(20) * 2 ** 32
      const p = buf.subarray(24, 24 + size)
      try {
        if (type === INFO) onMessage({ type: 'info', t, info: JSON.parse(p.toString()) })
        else if (type === FRAME) {
          const wh = p.readUInt32LE(4)
          onMessage({
            type: 'frame',
            seq: buf.readUInt32LE(12),
            t,
            key: !!(p.readUInt32LE(0) & 1),
            w: wh & 0xffff,
            h: wh >>> 16,
            data: copy(p.subarray(16)),
          })
        } else if (type === PREVIEW) {
          const wh = p.readUInt32LE(0)
          onMessage({ type: 'preview', t, w: wh & 0xffff, h: wh >>> 16, data: copy(p.subarray(4)) })
        } else if (type === AUDIO) {
          const rate = p.readUInt32LE(0)
          onMessage({ type: 'audio', t, rate, channels: p.readUInt32LE(4), data: copy(p.subarray(8)) })
        }
      } catch (e) {
        console.error('[capture] bad message', e)
      }
      buf = buf.subarray(24 + size)
    }
  })
  child.on('error', (e) => close(String(e.message ?? e)))
  child.on('exit', (code, signal) => close(signal ? `killed (${signal})` : `exited (${code})`))
  child.stdin.on('error', () => {})
  return {
    pid: child.pid,
    send: (c) => {
      if (!closed) child.stdin.write(commandLine(c) + '\n')
    },
    kill: () => {
      if (child.exitCode == null) child.kill('SIGTERM')
    },
  }
}

// an ArrayBuffer of its own (a Buffer's may be a pooled slab), to be transferred / copied over a MessagePort
const copy = (b) => new Uint8Array(b).buffer

module.exports = { startCapture }
