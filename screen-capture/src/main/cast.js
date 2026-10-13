// Go Live through capture, main side: lists the sources for the picker, starts capture (screen-capture/capture) on the
// picked one (it creates the cast itself and encodes AV1 on the GPU) and relays it to the renderer
// (src/renderer/cast.ts) over a MessagePort: frames, the 1 fps preview, info and stats one way, commands the other.
// The sources: on niri, its windows and outputs (capture casts them through niri's Mutter API, no dialog); elsewhere
// on Wayland, the desktop's ScreenCast portal (capture --portal, the portal's own dialog), with "the same as last time"
// first once a cast gave a restore token (kept in <userData>/capture-portal.json).
//
// capture: $MINCORD_CAPTURE, else `mincord-capture` on PATH. Without it, with neither niri nor Wayland, or with
// "capture": false in <userData>/config.json, Go Live is Chromium's own capture (the portal).
//
// The lab: $MINCORD_CAPTURE_CLIP=FILE.i420:WxH offers that clip as the only source ("clip:0", capture --clip), no niri
// needed (screen-capture/lab/golive.py). $MINCORD_CAPTURE_PORTAL_BUS=ADDRESS offers only the portal, and capture
// alone talks to that bus (the lab portal of screen-capture/lab/castsrc.py --portal, never the desktop's).
//
// getDisplayMedia (Chromium's own capture: Go Live without capture, and capture's fallback) gets the portal's source:
// on Wayland desktopCapturer asks the ScreenCast portal, which shows its own dialog. The lab answers with the asking
// frame itself, no portal (the lab sway's portal is backed by Liam's niri).
//
// IPC (shell/preload.js): invoke mincord:cast-available () -> boolean, mincord:cast-codecs () -> ('av1' | 'h264')[],
// mincord:cast-sources () -> CastSource[],
// mincord:cast-start (CastStart) -> boolean; on true the port follows as mincord:cast-port.

const { app, desktopCapturer, ipcMain, MessageChannelMain, session } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const { readdir, readFile } = require('node:fs/promises')
const { createConnection } = require('node:net')
const path = require('node:path')
const { startCapture } = require('./capture.js')
const { loadFdsock, rawRelay } = require('./raw.js')

// WebRTC paces video at 1.1 x the bandwidth target (1.0 for screen content), so a big frame (a switch to a new
// screen of text) waits in the pacer: 80-160 ms live at 1.1, 54-94 at 2.5 (LOG Key finds, "A jump's pause is the
// pacer"; Liam picked 2.5). Every video stream of the process, the camera too; set before app ready (the shell
// requires this file at its top level). The lab: $MINCORD_PACING=F paces at F instead.
const pacing = process.env.MINCORD_PACING ?? '2.5'
app.commandLine.appendSwitch(
  'force-fieldtrials',
  `WebRTC-Video-Pacing/factor:${pacing}/WebRTC-ProbingScreenshareBwe/${pacing},2875,80,40,-60,3/`,
)

/**
 * @typedef {{ id: number, title: string | null, app_id: string | null, pid: number | null,
 *   workspace_id: number | null, is_focused: boolean, layout?: { window_size?: [number, number] } }} NiriWindow
 * @typedef {{ name: string, make: string, model: string, modes: { width: number, height: number }[],
 *   current_mode: number | null }} NiriOutput
 * @typedef {{ id: string, kind: 'window' | 'output', name: string, detail: string, width: number, height: number }}
 *   CastSource  id: "window:<niri id>" / "output:<name>"
 * @typedef {{ source: string, size: [number, number], fps: number }} CastStart  size: the box capture fits the
 *   source into, e.g. [2560, 1440]
 */

let found
function captureBin() {
  if (found !== undefined) return found
  const env = process.env.MINCORD_CAPTURE
  found = env && fs.existsSync(env) ? env : null
  for (const dir of (process.env.PATH ?? '').split(path.delimiter))
    if (!found && dir && fs.existsSync(path.join(dir, 'mincord-capture'))) found = path.join(dir, 'mincord-capture')
  return found
}

function config() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'))
  } catch {
    return {}
  }
}

/**
 * One request over niri's IPC socket ($NIRI_SOCKET: a JSON request line, a JSON reply line), what `niri msg` does
 * without its process spawn (~6 ms, the socket ~0.2 ms). Resolves to the reply's Ok value.
 * @returns {Promise<any>}
 */
function niri(request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(process.env.NIRI_SOCKET ?? '')
    let reply = ''
    const fail = (e) => {
      socket.destroy()
      reject(e)
    }
    socket.setTimeout(2000, () => fail(new Error('niri IPC timed out')))
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', (chunk) => {
      reply += chunk
      const end = reply.indexOf('\n')
      if (end < 0) return
      socket.destroy()
      try {
        const r = JSON.parse(reply.slice(0, end))
        if ('Ok' in r) resolve(r.Ok)
        else reject(new Error(`niri: ${JSON.stringify(r.Err ?? r)}`))
      } catch (e) {
        reject(e)
      }
    })
    socket.on('error', fail)
  })
}

const clip = /^(.+):(\d+)x(\d+)$/.exec(process.env.MINCORD_CAPTURE_CLIP ?? '')
const portalBus = process.env.MINCORD_CAPTURE_PORTAL_BUS || null
/** The source kind: the lab's clip, the lab's portal, niri, the desktop's portal (any Wayland desktop), or none. */
const via = () =>
  clip
    ? 'clip'
    : portalBus
      ? 'portal'
      : process.env.NIRI_SOCKET
        ? 'niri'
        : process.env.WAYLAND_DISPLAY
          ? 'portal'
          : null

/** Whether Go Live captures through capture: a source kind, capture installed, not off in config.json. */
const castAvailable = () => process.platform === 'linux' && !!via() && config().capture !== false && !!captureBin()

let codecs
/**
 * What capture encodes on its GPU (`capture --probe`, ~10 ms, asked once): ['av1', 'h264'], a part of it, or [].
 * @returns {Promise<('av1' | 'h264')[]>}
 */
function castCodecs() {
  if (!castAvailable()) return Promise.resolve([])
  return (codecs ??= new Promise((resolve) =>
    execFile(captureBin(), ['--probe'], { timeout: 5000 }, (_, out) => {
      try {
        resolve(JSON.parse(out).codecs ?? [])
      } catch {
        resolve([])
      }
    }),
  ))
}

/**
 * The portal's last cast: its restore token (the portal picks the same source without its dialog) and what it was.
 * @typedef {{ token: string, width: number, height: number }} PortalLast
 */
const portalFile = () => path.join(app.getPath('userData'), 'capture-portal.json')
/** @returns {PortalLast | null} */
function portalLast() {
  try {
    const p = JSON.parse(fs.readFileSync(portalFile(), 'utf8'))
    return typeof p.token === 'string' && p.token ? p : null
  } catch {
    return null
  }
}

/** The portal's sources: the same as last time (when a token is kept), then the portal's own dialog. */
function portalSources() {
  const last = portalLast()
  const detail = "through the desktop's screen sharing"
  return [
    ...(last
      ? [
          {
            id: 'portal:last',
            kind: 'output',
            name: 'Same as last time',
            detail,
            width: last.width,
            height: last.height,
          },
        ]
      : []),
    { id: 'portal:choose', kind: 'output', name: 'Choose a screen or window', detail, width: 0, height: 0 },
  ]
}

/**
 * niri's outputs, then its windows (focused first, then by workspace), for the picker
 * @returns {Promise<CastSource[]>}
 */
async function castSources() {
  if (clip) return [{ id: 'clip:0', kind: 'output', name: 'clip', detail: clip[1], width: +clip[2], height: +clip[3] }]
  if (via() === 'portal') return portalSources()
  const [windows, outputs] = await Promise.all([
    niri('Windows').then((r) => /** @type {NiriWindow[]} */ (r.Windows)),
    niri('Outputs').then((r) => /** @type {Record<string, NiriOutput>} */ (r.Outputs)),
  ])
  const own = new Set([process.pid, ...(await descendants(process.pid))])
  return [
    ...Object.values(outputs)
      .filter((o) => o.current_mode != null)
      .map((o) => {
        const mode = o.modes[o.current_mode]
        return {
          id: `output:${o.name}`,
          kind: 'output',
          name: o.name,
          detail: `${o.make} ${o.model}`.trim(),
          width: mode.width,
          height: mode.height,
        }
      }),
    ...windows
      .filter((w) => !own.has(w.pid ?? -1))
      .sort((a, b) => Number(b.is_focused) - Number(a.is_focused) || (a.workspace_id ?? 0) - (b.workspace_id ?? 0))
      .map((w) => ({
        id: `window:${w.id}`,
        kind: 'window',
        name: w.title || w.app_id || `Window ${w.id}`,
        detail: w.app_id ?? '',
        width: w.layout?.window_size?.[0] ?? 0,
        height: w.layout?.window_size?.[1] ?? 0,
      })),
  ]
}

// (CONFIG_PROC_CHILDREN)
const hasChildLists = fs.existsSync(`/proc/${process.pid}/task/${process.pid}/children`)

/**
 * Pids of every process below `pid`: the kernel's per-thread child lists (/proc/<pid>/task/<tid>/children), level by
 * level (~1 ms; scanning all of /proc for parent links took ~40 ms with 1500 processes), else that scan.
 * @returns {Promise<number[]>}
 */
async function descendants(pid) {
  if (hasChildLists) {
    // (a process that exits meanwhile has no children to list)
    const childrenOf = async (p) => {
      const tasks = await readdir(`/proc/${p}/task`).catch(() => [])
      const lists = await Promise.all(
        tasks.map((t) => readFile(`/proc/${p}/task/${t}/children`, 'utf8').catch(() => '')),
      )
      return lists.join(' ').split(/\s+/).filter(Boolean).map(Number)
    }
    const out = []
    for (let level = [pid]; level.length;) {
      level = (await Promise.all(level.map(childrenOf))).flat()
      out.push(...level)
    }
    return out
  }
  const parents = new Map()
  for (const d of await readdir('/proc').catch(() => [])) {
    if (!/^\d+$/.test(d)) continue
    const stat = await readFile(`/proc/${d}/stat`, 'utf8').catch(() => '')
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
    if (ppid) parents.set(ppid, [...(parents.get(ppid) ?? []), Number(d)])
  }
  const out = []
  for (const todo = [pid]; todo.length;) for (const c of parents.get(todo.pop()) ?? []) (out.push(c), todo.push(c))
  return out
}

// niri keeps a cast going after its D-Bus client is gone: stop the cast of a capture that died without stopping it
// (capture stops its own when it exits normally; this then fails harmlessly)
function stopCast(sessionId) {
  niri({ Action: { StopCast: { session_id: sessionId } } }).catch(() => {})
}

let current = null

/** @param {Electron.IpcMainInvokeEvent} e @param {CastStart} opts */
function startCast(e, opts) {
  const bin = captureBin()
  const [kind, id] = opts.source.split(/:(.*)/s)
  const ok = { clip: 'clip', window: 'niri', output: 'niri', portal: 'portal' }[kind]
  if (!bin || !castAvailable() || ok !== via() || !id) return false
  current?.close()
  const last = kind === 'portal' && id === 'last' ? portalLast() : null
  const args = [
    ...(kind === 'clip' ? ['--clip', clip[1], '--clip-size', `${clip[2]}x${clip[3]}`] : []),
    ...(kind === 'window' ? ['--window', id] : kind === 'output' ? ['--output', id] : []),
    ...(kind === 'portal' ? ['--portal', ...(last ? ['--restore-token', last.token] : [])] : []),
    '--size',
    `${opts.size[0] | 0}x${opts.size[1] | 0}`,
    '--fps',
    String(opts.fps | 0),
  ]
  const { port1, port2 } = new MessageChannelMain()
  let open = true
  let sessionId = null
  let token = null
  // the fallback's frames (raw), straight to the page
  const fdsock = loadFdsock()
  const raw = fdsock ? rawRelay(e.sender) : null
  const cap = startCapture(
    bin,
    args,
    (m) => {
      if (m.type === 'raw') return raw?.message(m.raw, m.fds)
      if (m.type === 'info' && m.info.type === 'cast') sessionId = m.info.sessionId
      // the portal's token for next time, kept with the source's size once the format is known
      if (m.type === 'info' && m.info.type === 'cast' && m.info.restoreToken) token = m.info.restoreToken
      if (m.type === 'info' && m.info.type === 'input' && token) {
        const keep = { token, width: m.info.width, height: m.info.height }
        fs.promises.writeFile(portalFile(), JSON.stringify(keep)).catch((e) => console.error('[cast] portal token:', e))
        token = null
      }
      if (m.type === 'closed') {
        console.log(`[cast] capture ${cap.pid} ${m.why}`)
        if (sessionId != null) stopCast(sessionId)
        raw?.close()
      }
      // (a MessagePortMain only transfers ports: frames, ~20 kB, and previews are copied)
      if (open) port1.postMessage(m)
      if (m.type === 'closed') session.close()
    },
    // the lab portal's bus for capture alone (mincord stays on the desktop's)
    portalBus && kind === 'portal' ? { ...process.env, DBUS_SESSION_BUS_ADDRESS: portalBus } : undefined,
    fdsock,
  )
  const session = {
    close() {
      if (!open) return
      open = false
      cap.send({ type: 'stop' })
      setTimeout(() => cap.kill(), 2000).unref()
      port1.close()
      if (current === session) current = null
    },
  }
  current = session
  port1.on('message', ({ data }) => (data?.type === 'stop' ? session.close() : cap.send(data)))
  port1.on('close', () => session.close())
  port1.start()
  e.sender.postMessage('mincord:cast-port', null, [port2])
  console.log(`[cast] capture ${cap.pid}: ${args.join(' ')}`)
  return true
}

app.whenReady().then(() =>
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (clip) return callback({ video: request.frame })
    const sources = await desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .catch((e) => (console.error('[mincord:cast] portal:', e), []))
    callback(sources[0] ? { video: sources[0] } : {})
  }),
)

ipcMain.handle('mincord:cast-available', castAvailable)
ipcMain.handle('mincord:cast-codecs', castCodecs)
ipcMain.handle('mincord:cast-sources', castSources)
ipcMain.handle('mincord:cast-start', startCast)
app.on('will-quit', () => current?.close())

module.exports = { castAvailable, castCodecs, castSources, descendants }
