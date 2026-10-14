// The stream log, main side: one logfmt file per Go Live in $XDG_STATE_HOME/cordial/streams
// (~/.local/state/cordial/streams), its lines composed by the renderer (src/renderer/streamLog.ts). The last 10 streams
// within 10 MB are kept (the newest whatever its size); a finished file is compressed with zstd if it's on PATH (one
// left open by a crash or a quit, at the next stream's start). Past 10 MB a stream keeps one tick in four.
//
// IPC (src/shell/preload.js): send cordial:stream-log ('open', firstLine) | ('line', text) | ('close')

const { app, ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const KEEP = 10
const MAX_BYTES = 10 << 20
const MINUTE_MS = 60e3

const directory = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'cordial/streams')

/** @type {{ path: string, fd: number, bytes: number, ticks: number } | null} */
let file = null

function write(text) {
  const bytes = Buffer.from(text + '\n')
  fs.writeSync(file.fd, bytes)
  file.bytes += bytes.length
}

function open(firstLine) {
  close()
  fs.mkdirSync(directory, { recursive: true })
  // (any .log left is a stream that never closed)
  for (const entry of fs.readdirSync(directory)) if (entry.endsWith('.log')) compress(path.join(directory, entry))
  // (local time, e.g. 2026-10-14T02-12-03)
  const now = new Date()
  const name = new Date(now.getTime() - now.getTimezoneOffset() * MINUTE_MS)
    .toISOString()
    .slice(0, 19)
    .replaceAll(':', '-')
  const filePath = path.join(directory, `${name}.log`)
  file = { path: filePath, fd: fs.openSync(filePath, 'a'), bytes: 0, ticks: 0 }
  const versions = process.versions
  write(`${firstLine} kernel=${os.release()} electron=${versions.electron} chromium=${versions.chrome}`)
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
function compress(filePath) {
  if (compressing.has(filePath)) return
  compressing.add(filePath)
  execFile('zstd', ['-q', '-f', '--rm', '-19', filePath], () => {
    compressing.delete(filePath)
    if (!compressing.size) prune()
  })
}

/** the newest KEEP within MAX_BYTES (the newest always), never the open one */
function prune() {
  const stat = (name) => ({ file: path.join(directory, name), ...fs.statSync(path.join(directory, name)) })
  const all = fs
    .readdirSync(directory)
    .map(stat)
    .filter((entry) => entry.file !== file?.path)
    .sort((first, second) => second.mtimeMs - first.mtimeMs)
  let total = 0
  all.forEach((entry, i) => {
    total += entry.size
    if (i > 0 && (i >= KEEP || total > MAX_BYTES)) fs.rmSync(entry.file, { force: true })
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
