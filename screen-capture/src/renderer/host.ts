// What cordial supplies to the renderer side (its glue sets these): Discord's stores and functions the quality rules
// read, the main process's cast IPC (shell/preload.js), and the source picker (cordial's UI).

import type { CastSource, CastStart } from './cast'

export interface Discord {
  currentUser(): { id: string } | undefined
  /** the boost tier of the server whose voice channel we're in */
  voiceGuildPremiumTier(): number | undefined
  /** MediaEngineStore.getMediaEngine().connections */
  connections(): Iterable<any>
  /** Discord's canStreamWithSettings(preset, resolution, fps, user, guildPremiumTier) */
  canStreamWithSettings(preset: number, resolution: number, fps: number, user: unknown, tier?: number): boolean
  /** how many watch our Go Live (the stream log) */
  viewers?(): number
  /** the game being played (the "Playing" activity), for the stream log */
  game?(): string | null
}

export interface Native {
  /** niri and capture are there: Go Live captures through capture */
  available(): Promise<boolean>
  /** what capture encodes on this machine's GPU (capture --probe): ['av1'], or none */
  codecs(): Promise<string[]>
  sources(): Promise<CastSource[]>
  /** Starts capture; true: its port follows as a window message ({ cordialCastPort: true }, ports[0]) */
  start(opts: CastStart): Promise<boolean>
  /** the stream log's file (main/streamLog.js): open with its first line, a line, close */
  log?(op: 'open' | 'line' | 'close', text?: string): void
}

export const host: {
  discord: Discord | null
  native: Native | null
  /** Shows the picker; resolves to the pick, rejects when cancelled. None: getDisplayMedia needs a pending pick. */
  pick: ((sources: CastSource[]) => Promise<import('./cast').CastPick>) | null
} = { discord: null, native: null, pick: null }
