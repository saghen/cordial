// capture (screen-capture/capture) as a child process: its stdout messages parsed, commands written to its stdin. No
// Electron in here: the lab bench runs the same code.

const { spawn } = require('node:child_process')

const MAGIC = 0x315a5343 // "CSZ1"
const FRAME = 2
const INFO = 3
const PREVIEW = 4
/** No message (capture sends stats every second) for this long: it's stuck. */
const STALL_MS = 3000

/**
 * @typedef {{ type: 'frame', seq: number, t: number, key: boolean, w: number, h: number, data: ArrayBuffer }
 *   | { type: 'preview', t: number, w: number, h: number, data: ArrayBuffer }
 *   | { type: 'info', t: number, info: any }
 *   | { type: 'closed', why: string }} CaptureMessage
 * @typedef {{ type: 'start', kbps: number, height?: number } | { type: 'bitrate', kbps: number } | { type: 'key' }
 *   | { type: 'height', height: number } | { type: 'stop' }} CaptureCommand
 * @typedef {{ pid: number | undefined, send(c: CaptureCommand): void, kill(): void }} Capture
 */

/** @param {CaptureCommand} c */
const commandLine = (c) =>
  c.type === 'start'
    ? `start kbps=${c.kbps | 0}${c.height ? ` height=${c.height | 0}` : ''}`
    : c.type === 'bitrate'
      ? `bitrate ${c.kbps | 0}`
      : c.type === 'height'
        ? `height ${c.height | 0}`
        : c.type

/**
 * Starts capture; every message (and finally "closed") goes to onMessage.
 * @param {string} bin
 * @param {string[]} args
 * @param {(m: CaptureMessage) => void} onMessage
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Capture}
 */
function startCapture(bin, args, onMessage, env) {
  // stderr ignored: capture then logs to $XDG_RUNTIME_DIR/mincord-capture/<pid>.log
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'ignore'], env })
  let buf = Buffer.alloc(0)
  let closed = false
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
function copy(b) {
  const out = new ArrayBuffer(b.length)
  new Uint8Array(out).set(b)
  return out
}

module.exports = { startCapture }
