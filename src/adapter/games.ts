// Game detection. Discord's RunningGameStore watches for the games in its database through the desktop app's native
// discord_utils.setObservedGamesCallback, and does everything after a match itself: the "Playing" activity,
// "Stream <game>", Registered Games. Here that native side is game-detection/ (Rust), which the shell runs; two
// patches let the web client's store use it: its desktop-only gate, and getDiscordUtils() answering without
// DiscordNative (only these calls reach it off desktop: anything else still finds no method, as before).

import { G } from './anchor'
import { patch } from './webpack'

interface Observed {
  id: number
  executables: string[]
  cmdline: string | null
  thirdPartySkus?: { distributor: string; id?: string; sku?: string }[]
}

type Native = { observeGames(list: string, cb: (games: string[]) => void): void }
const native = (window as any).mincordNative as Native | undefined

const patches = [
  patch('static displayName="RunningGameStore"', [
    /(!__OVERLAY__&&\(\(0,[\w$]+\.isDesktop\)\(\)\|\|[\w$]+\.[\w$]+)\)/,
    '$1||null!=window.mincordNative)',
  ]),
  patch('getDiscordUtils(){', [
    /getDiscordUtils\(\)\{/,
    'getDiscordUtils(){if(null==window.DiscordNative&&null!=window.mincordNative)return mincord.discordUtils;',
  ]),
]

// in mincord.status(); not a need: without game detection the rest still works
G.gamesApplied = () => patches.every((p) => p.applied)
window.addEventListener('load', () =>
  setTimeout(() => {
    if (!G.gamesApplied()) console.error("[mincord] game detection's patches did not apply (Discord's code changed)")
  }, 10_000),
)

const field = (s: string | null | undefined) => (s ?? '').replace(/[\t\n]/g, ' ').trim()

// the list game-detection reads: `id \t arguments \t steam app ids \t executable ...`; it answers with the running
// ones, `id \t pid \t executable \t path`, as the native module would
G.discordUtils = {
  setObservedGamesCallback(games: Observed[], cb: (processes: object[]) => void) {
    const list = games.map((g) => {
      const steam = (g.thirdPartySkus ?? []).filter((s) => s.distributor === 'steam').map((s) => field(s.id ?? s.sku))
      return [g.id, field(g.cmdline), steam.filter(Boolean).join(','), ...g.executables.map(field)].join('\t')
    })
    native?.observeGames(list.join('\n') + '\n', (running) => {
      const lastFocused = Math.floor(Date.now() / 1000)
      cb(
        running.map((line) => {
          const [id, pid, exeName, exePath] = line.split('\t')
          const game = games.find((g) => String(g.id) === id) as any
          return { id, pid: +pid, name: game?.name, exeName, exePath, cmdLine: '', pidPath: [+pid], lastFocused }
        }),
      )
    })
  },
}
