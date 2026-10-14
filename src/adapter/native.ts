// Discord desktop's native modules, the two cordial stands in for: discord_utils' process observer (game detection)
// and discord_rpc's socket (Rich Presence). Discord's own code does the rest as on desktop. RunningGameStore matches
// games and sets the "Playing" activity; its RPC server does the handshake, checks the app, runs SET_ACTIVITY and
// sets the app's activity. requireModule() answers for these two when DiscordNative is missing (off desktop it threw
// for every module), and two gates that are desktop-only open for them.
//
// window.cordialNative (shell/preload.js) is absent with CORDIAL_PRESENCE=0, and then none of this runs.

import { G } from './anchor'
import { patch } from './webpack'

type Bytes = Uint8Array | ArrayBuffer
interface Native {
  observeGames(list: string, cb: (games: string[]) => void): void
  rpc: {
    listen(cb: (id: number, event: 'connect' | 'data' | 'close', data?: Uint8Array) => void): Promise<string | null>
    write(id: number, data: Uint8Array): void
    end(id: number, data?: Uint8Array): void
  }
}
const native = (window as any).cordialNative as Native | undefined
// the shell's image actions (shell/main.js): one copied to the clipboard (false when it isn't PNG or JPEG), one saved
export const image = (window as any).cordialNative?.image as
  { copy(url: string): Promise<boolean>; save(url: string): void } | undefined

const requireModule = patch('getDiscordUtils(){', [
  /requireModule\(([\w$]+)\)\{(?=if\([\w$]+\.hasOwnProperty\(\1\))/,
  'requireModule($1){if(null==window.DiscordNative&&null!=cordial.nativeModules?.[$1])return cordial.nativeModules[$1];',
])
const games = patch('static displayName="RunningGameStore"', [
  /(!__OVERLAY__&&\(\(0,[\w$]+\.isDesktop\)\(\)\|\|[\w$]+\.[\w$]+)\)/,
  '$1||null!=window.cordialNative)',
])
// the RPC server registers its socket transports on desktop only, after loading discord_rpc; here only the IPC one
// (998921 in Discord's build of 2026-10), not the WebSocket one for websites
const rpc = patch(
  'registerTransportsForEmbeddedPlatform:function(){',
  [
    /([\w$]+\.isPlatformEmbedded)(&&this\.registerTransportsForEmbeddedPlatform\(\))/,
    '($1||null!=window.cordialNative)$2',
  ],
  [
    /[\w$]+\.[\w$]+\.ensureModule\("discord_rpc"\)\.then\(\(\)=>\{for\(let ([\w$]+) of\[[\w$]+\(\d+\)\.default,/,
    'Promise.resolve().then(()=>{for(let $1 of[',
  ],
)

// in cordial.status(); not needs: without these the rest still works
G.nativeApplied = () => ({ games: requireModule.applied && games.applied, rpc: requireModule.applied && rpc.applied })
window.addEventListener('load', () =>
  setTimeout(() => {
    const a = G.nativeApplied()
    if (!a.games || !a.rpc) console.error("[cordial] native module patches did not apply (Discord's code changed)", a)
  }, 10_000),
)

const field = (s: string | null | undefined) => (s ?? '').replace(/[\t\n]/g, ' ').trim()

interface Observed {
  id: number
  name: string
  executables: string[]
  cmdline: string | null
  thirdPartySkus?: { distributor: string; id?: string; sku?: string }[]
}

// the list game-detection reads: `id \t arguments \t steam app ids \t executable ...`; it answers with the running
// ones, `id \t pid \t executable \t path`, as the native module would
const discord_utils = {
  setObservedGamesCallback(games: Observed[], cb: (processes: object[]) => void) {
    const list = games.map((g) => {
      const steam = (g.thirdPartySkus ?? []).filter((s) => s.distributor === 'steam').map((s) => field(s.id ?? s.sku))
      return [g.id, field(g.cmdline), steam.filter(Boolean).join(','), ...g.executables.map(field)].join('\t')
    })
    native!.observeGames(list.join('\n') + '\n', (running) => {
      const lastFocused = Math.floor(Date.now() / 1000)
      cb(
        running.map((line) => {
          const [id, pid, exeName, exePath] = line.split('\t')
          const name = games.find((g) => String(g.id) === id)?.name
          return { id, pid: +pid, name, exeName, exePath, cmdLine: '', pidPath: [+pid], lastFocused }
        }),
      )
    })
  },
}

// node's net, as much of it as Discord's IPC transport uses: a server whose connections are the shell's
class Emitter {
  private handlers: Record<string, Function[]> = {}
  on(type: string, f: Function) {
    ;(this.handlers[type] ??= []).push(f)
    return this
  }
  once(type: string, f: Function) {
    const g = (...a: unknown[]) => (this.removeListener(type, g), f(...a))
    return this.on(type, g)
  }
  removeListener(type: string, f: Function) {
    this.handlers[type] = (this.handlers[type] ?? []).filter((h) => h !== f)
    return this
  }
  emit(type: string, ...args: unknown[]) {
    for (const f of [...(this.handlers[type] ?? [])]) f(...args)
    return true
  }
}

const bytes = (d?: Bytes) => (d == null ? undefined : new Uint8Array(d))

class Socket extends Emitter {
  constructor(private id: number) {
    super()
  }
  write(d: Bytes) {
    native!.rpc.write(this.id, bytes(d)!)
    return true
  }
  end(d?: Bytes) {
    native!.rpc.end(this.id, bytes(d))
  }
  destroy() {
    native!.rpc.end(this.id)
  }
  // the transport also reads on 'readable', which never fires here: data comes as 'data'
  read() {
    return null
  }
}

let accept = (_: Socket) => {}
const sockets = new Map<number, Socket>()
const server = Object.assign(new Emitter(), {
  path: null as string | null,
  listening: false,
  listen(path: string | null, cb?: () => void) {
    server.path = path
    server.listening = path != null
    if (path != null) cb?.()
  },
  address: () => server.path,
})

const discord_rpc = {
  RPCIPC: {
    net: {
      createServer(onConnection: (s: Socket) => void) {
        accept = onConnection
        return server
      },
    },
    // the shell picks the first discord-ipc-N no one answers on and listens there
    getAvailableSocket: () =>
      native!.rpc.listen((id, event, data) => {
        if (event === 'connect') {
          const s = new Socket(id)
          sockets.set(id, s)
          accept(s)
        } else if (event === 'data') sockets.get(id)?.emit('data', data)
        else {
          sockets.get(id)?.emit('close')
          sockets.delete(id)
        }
      }),
  },
}

if (native) G.nativeModules = { discord_utils, discord_rpc }
