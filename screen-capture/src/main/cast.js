// Go Live through capture, main side: lists the sources for the picker, starts capture (screen-capture/capture) on the
// picked one (it creates the cast itself and encodes AV1 on the GPU) and relays it to the renderer
// (src/renderer/cast.ts) over a MessagePort: frames, the 1 fps preview, info and stats one way, commands the other.
// The sources: on niri, its windows and outputs (capture casts them through niri's Mutter API, no dialog); elsewhere
// on Wayland, the desktop's ScreenCast portal (capture --portal, the portal's own dialog), with "the same as last time"
// first once a cast gave a restore token (kept in <userData>/capture-portal.json).
//
// The sound (when Discord asks for it), niri only: capture takes it from PipeWire (capture/src/audio.rs), from the
// shared window's apps, or for an output from the focused window on that output (audioTarget, followOutput).
//
// capture: $CORDIAL_CAPTURE, else `cordial-capture` on PATH. Without it, with neither niri nor Wayland, or with
// "capture": false in <userData>/config.json, Go Live is Chromium's own capture (the portal).
//
// For testing: $CORDIAL_CAPTURE_CLIP=FILE.i420:WxH offers that clip as the only source ("clip:0", capture --clip), no
// niri needed. $CORDIAL_CAPTURE_AUDIO=TARGET takes the sound from capture's TARGET (pid=N...) whatever the source.
// $CORDIAL_CAPTURE_PORTAL_BUS=ADDRESS offers only the portal, and capture alone talks to that bus (a test portal on its
// own bus, never the desktop's).
//
// getDisplayMedia (Chromium's own capture: Go Live without capture, and capture's fallback) gets the portal's source:
// on Wayland desktopCapturer asks the ScreenCast portal, which shows its own dialog. With the clip it answers with the
// asking frame itself, no portal (a nested compositor's portal would ask the desktop's).
//
// IPC (src/shell/preload.js): invoke cordial:cast-available () -> boolean, cordial:cast-codecs () -> 'av1'[],
// cordial:cast-sources () -> CastSource[], cordial:cast-start (CastStart) -> boolean; on true the port follows as
// cordial:cast-port.

const { app, desktopCapturer, ipcMain, MessageChannelMain, session } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const { createConnection } = require('node:net')
const path = require('node:path')
const { startCapture } = require('./capture.js')
const { loadFdsock, rawRelay } = require('./raw.js')
require('./streamLog.js')

// WebRTC paces video at 1.1 x the bandwidth target (1.0 for screen content), so a big frame (a switch to a new screen
// of text) waits in the pacer: 80-160 ms live at 1.1, 54-94 at 2.5. Every video stream of the process, the camera too;
// set before app ready (the shell requires this file at its top level).
app.commandLine.appendSwitch(
  'force-fieldtrials',
  'WebRTC-Video-Pacing/factor:2.5/WebRTC-ProbingScreenshareBwe/2.5,2875,80,40,-60,3/',
)

const NIRI_TIMEOUT_MS = 2000
const PROBE_TIMEOUT_MS = 5000
// a stopped capture's time to exit before it's killed
const KILL_MS = 2000

/**
 * @typedef {{ id: number, title: string | null, app_id: string | null, pid: number | null,
 *   workspace_id: number | null, is_focused: boolean, layout?: { window_size?: [number, number] } }} NiriWindow
 * @typedef {{ name: string, make: string, model: string, modes: { width: number, height: number }[],
 *   current_mode: number | null }} NiriOutput
 * @typedef {{ id: string, kind: 'window' | 'output', name: string, detail: string, width: number, height: number }}
 *   CastSource  id: "window:<niri id>" / "output:<name>"
 * @typedef {{ name: string, output: string | null, is_active: boolean, active_window_id: number | null }} NiriWorkspace
 * @typedef {{ source: string, size: [number, number], fps: number, audio?: boolean }} CastStart  size: the box
 *   capture fits the source into, e.g. [2560, 1440]; audio: the stream has sound
 */

let found
function captureBinary() {
  if (found !== undefined) return found
  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((directory) => directory && path.join(directory, 'cordial-capture'))
  found = [process.env.CORDIAL_CAPTURE, ...onPath].find((file) => file && fs.existsSync(file)) ?? null
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
const niri = (request) =>
  new Promise((resolve, reject) => {
    const socket = createConnection(process.env.NIRI_SOCKET ?? '')
    let reply = ''
    function fail(e) {
      socket.destroy()
      reject(e)
    }
    socket.setTimeout(NIRI_TIMEOUT_MS, () => fail(new Error('niri IPC timed out')))
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', (chunk) => {
      reply += chunk
      const end = reply.indexOf('\n')
      if (end < 0) return
      socket.destroy()
      try {
        const result = JSON.parse(reply.slice(0, end))
        if ('Ok' in result) resolve(result.Ok)
        else reject(new Error(`niri: ${JSON.stringify(result.Err ?? result)}`))
      } catch (e) {
        reject(e)
      }
    })
    socket.on('error', fail)
  })

// for testing (see the top of the file): a clip, a portal's bus, a sound target
const clip = /^(.+):(\d+)x(\d+)$/.exec(process.env.CORDIAL_CAPTURE_CLIP ?? '')
const portalBus = process.env.CORDIAL_CAPTURE_PORTAL_BUS || null
const testAudio = process.env.CORDIAL_CAPTURE_AUDIO || null

/** The source kind: the test clip, the test portal, niri, the desktop's portal (any Wayland desktop), or none. */
function via() {
  if (clip) return 'clip'
  if (portalBus) return 'portal'
  if (process.env.NIRI_SOCKET) return 'niri'
  if (process.env.WAYLAND_DISPLAY) return 'portal'
  return null
}

/** Whether Go Live captures through capture: a source kind, capture installed, not off in config.json. */
const castAvailable = () =>
  process.platform === 'linux' && Boolean(via()) && config().capture !== false && Boolean(captureBinary())

let codecs
/**
 * What capture encodes on its GPU (`capture --probe`, ~10 ms, asked once): ['av1'], or [] (it then only hands its
 * frames to Chromium, raw).
 * @returns {Promise<string[]>}
 */
function castCodecs() {
  if (!castAvailable()) return Promise.resolve([])
  codecs ??= new Promise((resolve) =>
    execFile(captureBinary(), ['--probe'], { timeout: PROBE_TIMEOUT_MS }, (_, out) => {
      try {
        resolve(JSON.parse(out).codecs ?? [])
      } catch {
        resolve([])
      }
    }),
  )
  return codecs
}

/**
 * The portal's last cast: its restore token (the portal picks the same source without its dialog) and what it was.
 * @typedef {{ token: string, width: number, height: number }} PortalLast
 */
const portalFile = () => path.join(app.getPath('userData'), 'capture-portal.json')
/** @returns {PortalLast | null} */
function portalLast() {
  try {
    const saved = JSON.parse(fs.readFileSync(portalFile(), 'utf8'))
    return typeof saved.token === 'string' && saved.token ? saved : null
  } catch {
    return null
  }
}

/** The portal's sources: the same as last time (when a token is kept), then the portal's own dialog. */
function portalSources() {
  const last = portalLast()
  const detail = "through the desktop's screen sharing"
  const choose = { id: 'portal:choose', kind: 'output', name: 'Choose a screen or window', detail, width: 0, height: 0 }
  if (!last) return [choose]
  return [
    { id: 'portal:last', kind: 'output', name: 'Same as last time', detail, width: last.width, height: last.height },
    choose,
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
    niri('Windows').then((reply) => /** @type {NiriWindow[]} */ (reply.Windows)),
    niri('Outputs').then((reply) => /** @type {Record<string, NiriOutput>} */ (reply.Outputs)),
  ])
  return [
    ...Object.values(outputs)
      .filter((output) => output.current_mode != null)
      .map((output) => {
        const mode = output.modes[output.current_mode]
        return {
          id: `output:${output.name}`,
          kind: 'output',
          name: output.name,
          detail: `${output.make} ${output.model}`.trim(),
          width: mode.width,
          height: mode.height,
        }
      }),
    ...windows
      // (not cordial's own: niri's pid for a window is its Wayland client's, Electron's main process)
      .filter((window) => window.pid !== process.pid)
      .sort(
        (first, second) =>
          Number(second.is_focused) - Number(first.is_focused) ||
          (first.workspace_id ?? 0) - (second.workspace_id ?? 0),
      )
      .map((window) => ({
        id: `window:${window.id}`,
        kind: 'window',
        name: window.title || window.app_id || `Window ${window.id}`,
        detail: window.app_id ?? '',
        width: window.layout?.window_size?.[0] ?? 0,
        height: window.layout?.window_size?.[1] ?? 0,
      })),
  ]
}

/**
 * Where capture takes a window's sound from (audio.rs): its process and those below it; an X11 window (each has
 * xwayland-satellite's pid) by its Steam app (a Proton game's app id is steam_app_N), else by its app id as the
 * process's name.
 * @param {NiriWindow | undefined} window
 * @returns {Promise<string>}
 */
async function audioTarget(window) {
  if (!window?.pid) return 'off'
  const executable = await fs.promises.readlink(`/proc/${window.pid}/exe`).catch(() => '')
  if (!path.basename(executable).startsWith('xwayland')) return `pid=${window.pid}`
  const steam = /^steam_app_(\d+)$/.exec(window.app_id ?? '')
  if (steam) return `steam=${steam[1]}`
  if (window.app_id) return `name=${window.app_id.toLowerCase()}`
  return 'off'
}

// niri's events that can change an output's focused window
const WINDOW_EVENTS = new Set([
  'WorkspacesChanged',
  'WorkspaceActivated',
  'WorkspaceActiveWindowChanged',
  'WindowsChanged',
  'WindowOpenedOrChanged',
  'WindowClosed',
])

/**
 * An output's sound follows its focused window: the active window of its active workspace, not the global focus
 * (focusing another output keeps it). cordial's own windows keep the one before; an empty workspace is silence.
 * niri's event stream says when to look again (the state asked anew, ~0.4 ms).
 * @param {string} output
 * @param {(target: string) => void} set
 * @returns {() => void} stops following
 */
function followOutput(output, set) {
  let last = null
  let stopped = false
  let busy = false
  let again = false
  async function update() {
    if (busy) {
      again = true
      return
    }
    busy = true
    try {
      const [{ Workspaces: workspaces }, { Windows: windows }] = await Promise.all([
        niri('Workspaces'),
        niri('Windows'),
      ])
      const workspace = /** @type {NiriWorkspace[]} */ (workspaces).find(
        (entry) => entry.output === output && entry.is_active,
      )
      const window = /** @type {NiriWindow[]} */ (windows).find((entry) => entry.id === workspace?.active_window_id)
      const target = window?.pid === process.pid ? last : await audioTarget(window)
      if (!stopped && target != null && target !== last) {
        last = target
        set(target)
      }
    } catch (e) {
      console.error('[cast] sound target:', e)
    } finally {
      busy = false
      if (again && !stopped) {
        again = false
        update()
      }
    }
  }
  // the stream starts with the current state (WorkspacesChanged, WindowsChanged, ...)
  const socket = createConnection(process.env.NIRI_SOCKET ?? '')
  let partial = ''
  socket.on('connect', () => socket.write('"EventStream"\n'))
  socket.on('data', (chunk) => {
    const lines = (partial + chunk).split('\n')
    partial = lines.pop() ?? ''
    const relevant = lines.some((line) => {
      try {
        return WINDOW_EVENTS.has(Object.keys(JSON.parse(line))[0])
      } catch {
        return false
      }
    })
    if (relevant) update()
  })
  socket.on('error', (e) => console.error('[cast] niri events:', e.message))
  return () => {
    stopped = true
    socket.destroy()
  }
}

// niri keeps a cast going after its D-Bus client is gone: stop the cast of a capture that died without stopping it
// (capture stops its own when it exits normally; this then fails harmlessly)
function stopCast(sessionId) {
  niri({ Action: { StopCast: { session_id: sessionId } } }).catch(() => {})
}

let current = null

/** @param {Electron.IpcMainInvokeEvent} e @param {CastStart} opts */
function startCast(e, opts) {
  const binary = captureBinary()
  const [kind, id] = opts.source.split(/:(.*)/s)
  const sourceVia = { clip: 'clip', window: 'niri', output: 'niri', portal: 'portal' }[kind]
  if (!binary || !castAvailable() || sourceVia !== via() || !id) return false
  current?.close()
  const last = kind === 'portal' && id === 'last' ? portalLast() : null
  const args = [
    ...(kind === 'clip' ? ['--clip', clip[1], '--clip-size', `${clip[2]}x${clip[3]}`] : []),
    ...(kind === 'window' ? ['--window', id] : []),
    ...(kind === 'output' ? ['--output', id] : []),
    ...(kind === 'portal' ? ['--portal', ...(last ? ['--restore-token', last.token] : [])] : []),
    '--size',
    `${opts.size[0] | 0}x${opts.size[1] | 0}`,
    '--fps',
    String(opts.fps | 0),
    // (the stream log's ticks: renderer/streamLog.ts)
    '--stats-ms',
    '250',
  ]
  const { port1, port2 } = new MessageChannelMain()
  let open = true
  let sessionId = null
  let token = null
  // the fallback's frames (raw), straight to the page
  const fdsock = loadFdsock()
  const raw = fdsock ? rawRelay(e.sender) : null
  let stopAudio = () => {}
  const capture = startCapture(
    binary,
    args,
    (message) => {
      if (message.type === 'raw') return raw?.message(message.raw, message.fds)
      // the portal's token for next time, kept with the source's size once the format is known
      if (message.type === 'info' && message.info.type === 'cast') {
        sessionId = message.info.sessionId
        token = message.info.restoreToken ?? null
      }
      if (message.type === 'info' && message.info.type === 'input' && token) {
        const keep = { token, width: message.info.width, height: message.info.height }
        fs.promises.writeFile(portalFile(), JSON.stringify(keep)).catch((e) => console.error('[cast] portal token:', e))
        token = null
      }
      if (message.type === 'closed') {
        // (open: not stopped by us, it died)
        if (open) console.warn(`[cast] capture ${capture.pid} ${message.why}`)
        if (sessionId != null) stopCast(sessionId)
        raw?.close()
      }
      // (a MessagePortMain only transfers ports: frames, ~20 kB, and previews are copied)
      if (open) port1.postMessage(message)
      if (message.type === 'closed') cast.close()
    },
    // the test portal's bus for capture alone (cordial stays on the desktop's)
    portalBus && kind === 'portal' ? { ...process.env, DBUS_SESSION_BUS_ADDRESS: portalBus } : undefined,
    fdsock,
  )
  if (opts.audio) {
    const send = (target) => capture.send({ type: 'audio', target })
    if (testAudio) send(testAudio)
    else if (kind === 'window')
      niri('Windows')
        .then((reply) =>
          audioTarget(/** @type {NiriWindow[]} */ (reply.Windows).find((window) => String(window.id) === id)),
        )
        .then(send, (e) => console.error('[cast] sound target:', e))
    else if (kind === 'output') stopAudio = followOutput(id, send)
  }
  const cast = {
    close() {
      if (!open) return
      open = false
      stopAudio()
      capture.send({ type: 'stop' })
      setTimeout(() => capture.kill(), KILL_MS).unref()
      port1.close()
      if (current === cast) current = null
    },
  }
  current = cast
  port1.on('message', ({ data }) => {
    if (data?.type === 'stop') cast.close()
    else capture.send(data)
  })
  port1.on('close', () => cast.close())
  port1.start()
  e.sender.postMessage('cordial:cast-port', null, [port2])
  return true
}

app.whenReady().then(() =>
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (clip) return callback({ video: request.frame })
    const sources = await desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .catch((e) => {
        console.error('[cordial:cast] portal:', e)
        return []
      })
    callback(sources[0] ? { video: sources[0] } : {})
  }),
)

ipcMain.handle('cordial:cast-available', castAvailable)
ipcMain.handle('cordial:cast-codecs', castCodecs)
ipcMain.handle('cordial:cast-sources', castSources)
ipcMain.handle('cordial:cast-start', startCast)
app.on('will-quit', () => current?.close())
