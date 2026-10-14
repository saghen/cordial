// The stream log, main side: one logfmt file per Go Live in $XDG_STATE_HOME/cordial/streams
// (~/.local/state/cordial/streams), its lines composed by the renderer (src/renderer/streamLog.ts). The last 10 streams
// within 10 MB are kept (the newest whatever its size); a finished file is compressed with zstd if it's on PATH (one
// left open by a crash or a quit, at the next stream's start). Past 10 MB a stream keeps one tick in four.
//
// IPC (shell/preload.js): send cordial:stream-log ('open', firstLine) | ('line', text) | ('close')

const { app, ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const KEEP = 10
const MAX_BYTES = 10 << 20

const dir = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'cordial/streams')

/** @type {{ path: string, fd: number, bytes: number, ticks: number } | null} */
let file = null

function write(text) {
  const b = Buffer.from(text + '\n')
  fs.writeSync(file.fd, b)
  file.bytes += b.length
}

function open(first) {
  close()
  fs.mkdirSync(dir, { recursive: true })
  // (any .log left is a stream that never closed)
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.log')) compress(path.join(dir, f))
  // (local time, e.g. 2026-10-14T02-12-03)
  const d = new Date()
  const name = new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 19).replaceAll(':', '-')
  const p = path.join(dir, `${name}.log`)
  file = { path: p, fd: fs.openSync(p, 'a'), bytes: 0, ticks: 0 }
  const v = process.versions
  write(`${first} kernel=${os.release()} electron=${v.electron} chromium=${v.chrome}`)
}

function line(text) {
  if (!file) return
  if (file.bytes > MAX_BYTES && text.includes(' k=tick ') && file.ticks++ % 4) return
  write(text)
}

function close() {
  if (!file) return
  fs.closeSync(file.fd)
  const done = file.path
  file = null
  compress(done)
}

const compressing = new Set()
function compress(p) {
  if (compressing.has(p)) return
  compressing.add(p)
  execFile('zstd', ['-q', '-f', '--rm', '-19', p], () => {
    compressing.delete(p)
    if (!compressing.size) prune()
  })
}

/** the newest KEEP within MAX_BYTES (the newest always), never the open one */
function prune() {
  const stat = (f) => ({ f: path.join(dir, f), ...fs.statSync(path.join(dir, f)) })
  const all = fs
    .readdirSync(dir)
    .map(stat)
    .filter((s) => s.f !== file?.path)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  let total = 0
  all.forEach((s, i) => {
    total += s.size
    if (i > 0 && (i >= KEEP || total > MAX_BYTES)) fs.rmSync(s.f, { force: true })
  })
}

ipcMain.on('cordial:stream-log', (_e, op, text) => {
  try {
    if (op === 'open') open(String(text))
    else if (op === 'line') line(String(text))
    else if (op === 'close') close()
  } catch (e) {
    console.error('[stream-log]', e)
  }
})
app.on('will-quit', () => {
  if (file) fs.closeSync(file.fd)
  file = null
})
