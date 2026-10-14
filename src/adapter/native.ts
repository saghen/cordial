// Discord desktop's native modules, the two cordial stands in for: discord_utils' process observer (game detection)
// and discord_rpc's socket (Rich Presence). Discord's own code does the rest as on desktop. RunningGameStore matches
// games and sets the "Playing" activity; its RPC server does the handshake, checks the app, runs SET_ACTIVITY and
// sets the app's activity. requireModule() answers for these two when DiscordNative is missing (off desktop it throws
// for every module), and two gates that are desktop-only open for them.
//
// window.cordialNative (src/shell/preload.js) is absent with CORDIAL_PRESENCE=0, and then none of this runs.

import { G } from './anchor'
import { patch } from './webpack'

type Bytes = Uint8Array | ArrayBuffer
interface Native {
  observeGames(list: string, callback: (games: string[]) => void): void
  rpc: {
    listen(
      listener: (id: number, event: 'connect' | 'data' | 'close', data?: Uint8Array) => void,
    ): Promise<string | null>
    write(id: number, data: Uint8Array): void
    end(id: number, data?: Uint8Array): void
  }
  // the shell's image actions (src/shell/main.js): one copied to the clipboard (false when it isn't PNG or JPEG), one
  // saved
  image: { copy(url: string): Promise<boolean>; save(url: string): void }
}
const native = (window as any).cordialNative as Native | undefined
export const image = native?.image

const requireModule = patch('getDiscordUtils(){', [
  /requireModule\(([\w$]+)\)\{(?=if\([\w$]+\.hasOwnProperty\(\1\))/,
  'requireModule($1){if(null==window.DiscordNative&&null!=cordial.nativeModules?.[$1])return cordial.nativeModules[$1];',
])
const games = patch('static displayName="RunningGameStore"', [
  /(!__OVERLAY__&&\(\(0,[\w$]+\.isDesktop\)\(\)\|\|[\w$]+\.[\w$]+)\)/,
  '$1||null!=window.cordialNative)',
])
// the RPC server registers its socket transports on desktop only, after loading discord_rpc; here only the IPC one, not
// the WebSocket one for websites
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
    const applied = G.nativeApplied()
    if (!applied.games || !applied.rpc)
      console.error("[cordial] native module patches did not apply (Discord's code changed)", applied)
  }, 10_000),
)

const field = (value: string | null | undefined) => (value ?? '').replace(/[\t\n]/g, ' ').trim()

interface Observed {
  id: number
  name: string
  executables: string[]
  cmdline: string | null
  thirdPartySkus?: { distributor: string; id?: string; sku?: string }[]
}

// the list game-detection reads: `id \t arguments \t steam app ids \t executable ...`; it answers with the running
// ones, `id \t pid \t executable \t path`, as the native module would
const discordUtils = {
  setObservedGamesCallback(games: Observed[], callback: (processes: object[]) => void) {
    const list = games.map((game) => {
      const steam = (game.thirdPartySkus ?? [])
        .filter((sku) => sku.distributor === 'steam')
        .map((sku) => field(sku.id ?? sku.sku))
      return [game.id, field(game.cmdline), steam.filter(Boolean).join(','), ...game.executables.map(field)].join('\t')
    })
    native!.observeGames(list.join('\n') + '\n', (running) => {
      const lastFocused = Math.floor(Date.now() / 1000)
      callback(
        running.map((line) => {
          const [id, pid, exeName, exePath] = line.split('\t')
          const name = games.find((game) => String(game.id) === id)?.name
          return { id, pid: +pid, name, exeName, exePath, cmdLine: '', pidPath: [+pid], lastFocused }
        }),
      )
    })
  },
}

// node's net, as much of it as Discord's IPC transport uses: a server whose connections are the shell's
class Emitter {
  private handlers: Record<string, Function[]> = {}
  on(type: string, listener: Function) {
    this.handlers[type] = [...(this.handlers[type] ?? []), listener]
    return this
  }
  once(type: string, listener: Function) {
    const wrapped = (...args: unknown[]) => {
      this.removeListener(type, wrapped)
      return listener(...args)
    }
    return this.on(type, wrapped)
  }
  removeListener(type: string, listener: Function) {
    this.handlers[type] = (this.handlers[type] ?? []).filter((handler) => handler !== listener)
    return this
  }
  emit(type: string, ...args: unknown[]) {
    for (const handler of this.handlers[type] ?? []) handler(...args)
    return true
  }
}

const bytes = (data?: Bytes) => (data == null ? undefined : new Uint8Array(data))

class Socket extends Emitter {
  constructor(private id: number) {
    super()
  }
  write(data: Bytes) {
    native!.rpc.write(this.id, new Uint8Array(data))
    return true
  }
  end(data?: Bytes) {
    native!.rpc.end(this.id, bytes(data))
  }
  destroy() {
    native!.rpc.end(this.id)
  }
  // the transport also reads on 'readable', which never fires here: data comes as 'data'
  read() {
    return null
  }
}

let accept: (socket: Socket) => void = () => {}
const sockets = new Map<number, Socket>()
const server = Object.assign(new Emitter(), {
  path: null as string | null,
  listening: false,
  listen(path: string | null, callback?: () => void) {
    server.path = path
    server.listening = path != null
    if (path != null) callback?.()
  },
  address: () => server.path,
})

const discordRpc = {
  RPCIPC: {
    net: {
      createServer(onConnection: (socket: Socket) => void) {
        accept = onConnection
        return server
      },
    },
    // the shell picks the first discord-ipc-N no one answers on and listens there
    getAvailableSocket: () =>
      native!.rpc.listen((id, event, data) => {
        if (event === 'connect') {
          const socket = new Socket(id)
          sockets.set(id, socket)
          accept(socket)
        } else if (event === 'data') sockets.get(id)?.emit('data', data)
        else {
          sockets.get(id)?.emit('close')
          sockets.delete(id)
        }
      }),
  },
}

if (native) G.nativeModules = { discord_utils: discordUtils, discord_rpc: discordRpc }
