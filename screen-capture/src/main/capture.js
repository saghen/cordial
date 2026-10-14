// capture (screen-capture/capture) as a child process: its stdout messages parsed, commands written to its stdin. No
// Electron in here, so it runs under plain Node too.

const { spawn } = require('node:child_process')
const { closeSync } = require('node:fs')

const MAGIC = 0x315a5343 // "CSZ1"
const HEADER_BYTES = 24
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
 * @typedef {{ pid: number | undefined, send(command: CaptureCommand): void, kill(): void }} Capture
 */

/** @param {CaptureCommand} command */
function commandLine(command) {
  switch (command.type) {
    case 'start':
      return `start kbps=${command.kbps | 0}${command.height ? ` height=${command.height | 0}` : ''}`
    case 'bitrate':
      return `bitrate ${command.kbps | 0}`
    case 'height':
      return `height ${command.height | 0}`
    case 'fps':
      return `fps ${command.fps | 0}`
    case 'audio':
      return `audio ${command.target.replace(/\s/g, '')}`
    default:
      return command.type
  }
}

/**
 * Starts capture; every message (and finally "closed") goes to onMessage. With fdsock (addon/fdsock.c), capture gets
 * raw's socket as fd 3 ("raw": the fallback's frames, as raw messages).
 * @param {string} binary
 * @param {string[]} args
 * @param {(message: CaptureMessage) => void} onMessage
 * @param {NodeJS.ProcessEnv} [env]
 * @param {any} [fdsock]
 * @returns {Capture}
 */
function startCapture(binary, args, onMessage, env, fdsock) {
  const [socket, childSocket] = fdsock ? fdsock.open() : []
  let closed = false
  // stderr ignored: capture then logs to $XDG_RUNTIME_DIR/cordial-capture/<pid>.log
  const child = spawn(binary, fdsock ? [...args, '--socket-fd', '3'] : args, {
    stdio: ['pipe', 'pipe', 'ignore', ...(fdsock ? [childSocket] : [])],
    env,
  })
  if (fdsock) {
    closeSync(childSocket)
    fdsock.listen(socket, (data, fds) => {
      if (!data) return closeSync(socket)
      if (closed) return fds.forEach((fd) => closeSync(fd))
      try {
        onMessage({ type: 'raw', raw: JSON.parse(data.toString()), fds })
      } catch (e) {
        fds.forEach((fd) => closeSync(fd))
        console.error('[capture] bad raw message', e)
      }
    })
  }
  let buffered = Buffer.alloc(0)
  let last = Date.now()
  function close(why) {
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
    buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk
    while (buffered.length >= HEADER_BYTES) {
      if (buffered.readUInt32LE(0) !== MAGIC) return close('bad message')
      const size = buffered.readUInt32LE(8)
      if (buffered.length < HEADER_BYTES + size) break
      const type = buffered.readUInt32LE(4)
      const time = buffered.readUInt32LE(16) + buffered.readUInt32LE(20) * 2 ** 32
      const payload = buffered.subarray(HEADER_BYTES, HEADER_BYTES + size)
      try {
        if (type === INFO) onMessage({ type: 'info', t: time, info: JSON.parse(payload.toString()) })
        else if (type === FRAME) {
          const packedSize = payload.readUInt32LE(4)
          onMessage({
            type: 'frame',
            seq: buffered.readUInt32LE(12),
            t: time,
            key: Boolean(payload.readUInt32LE(0) & 1),
            w: packedSize & 0xffff,
            h: packedSize >>> 16,
            data: copy(payload.subarray(16)),
          })
        } else if (type === PREVIEW) {
          const packedSize = payload.readUInt32LE(0)
          onMessage({
            type: 'preview',
            t: time,
            w: packedSize & 0xffff,
            h: packedSize >>> 16,
            data: copy(payload.subarray(4)),
          })
        } else if (type === AUDIO) {
          const rate = payload.readUInt32LE(0)
          onMessage({
            type: 'audio',
            t: time,
            rate,
            channels: payload.readUInt32LE(4),
            data: copy(payload.subarray(8)),
          })
        }
      } catch (e) {
        console.error('[capture] bad message', e)
      }
      buffered = buffered.subarray(HEADER_BYTES + size)
    }
  })
  child.on('error', (e) => close(String(e.message ?? e)))
  child.on('exit', (code, signal) => close(signal ? `killed (${signal})` : `exited (${code})`))
  child.stdin.on('error', () => {})
  return {
    pid: child.pid,
    send(command) {
      if (!closed) child.stdin.write(commandLine(command) + '\n')
    },
    kill() {
      if (child.exitCode == null) child.kill('SIGTERM')
    },
  }
}

// an ArrayBuffer of its own (a Buffer's may be a pooled slab), to be transferred / copied over a MessagePort
const copy = (bytes) => new Uint8Array(bytes).buffer

module.exports = { startCapture }
