// The call view, as stock's: who's in the selected voice channel or DM call as tiles filling the area (the top bar's
// too, which it puts on the call's black), a click on one fills the area with it; under them the call's buttons, or
// Join while you're elsewhere; the DM header's call buttons; incoming calls with Accept and Decline. Its badges, pills,
// buttons and the top bar fade while the pointer is elsewhere or still for 5 s; Expand puts the call over the chat.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import * as screen from '../../screen-capture/src/renderer'

import * as audio from '../api/audio'
import * as calls from '../api/calls'
import * as channels from '../api/channels'
import { useRingtone } from '../api/sounds'
import type { Channel, PrivateChannel, VoiceState } from '../api/records'
import { selectedChannel } from '../api/store'
import { text } from '../api/strings'
import * as streams from '../api/streams'
import * as users from '../api/users'
import * as voice from '../api/voice'
import { Avatar } from '../components/avatar'
import { Name } from '../components/name'
import { Tile } from '../components/tile'
import { Video } from '../components/video'
import { Badge } from '../primitives/badge'
import { Button, IconButton, Toggle } from '../primitives/button'
import { Icon } from '../primitives/icon'

const IDLE = 5000
// the tiles' gap (call.css)
const GAP = 8

export function CallView() {
  const [expanded, setExpanded] = createSignal(false)
  // the tile filling the area: a user's id, or "stream:" and theirs
  const [focused, setFocused] = createSignal<string | null>(null)
  const [awake, setAwake] = createSignal(true)
  // full screen: the call view, a stream filling it, with its UI as in the window
  const [full, setFull] = createSignal(false)
  // the tile that filled the area before, back on leaving full screen
  let before: string | null = null
  const [size, setSize] = createSignal({ w: 0, h: 0 })
  let timer: ReturnType<typeof setTimeout> | undefined
  let section: HTMLElement | undefined
  // the UI shows while the pointer moves over the call or the top bar on it, and while it rests on the buttons or the
  // top bar; it hides as the pointer leaves both
  const over = (t: EventTarget | null) => t instanceof Element && !!t.closest('#cordial-root > :is(header, section.call)')
  const sleep = () => {
    clearTimeout(timer)
    if (!section?.parentElement?.querySelector(':scope > header:hover, :scope > section.call > .call-bar:hover'))
      setAwake(false)
    else timer = setTimeout(sleep, IDLE)
  }
  const wake = () => {
    setAwake(true)
    clearTimeout(timer)
    timer = setTimeout(sleep, IDLE)
  }
  const move = (e: PointerEvent) => over(e.target) && wake()
  const out = (e: PointerEvent) => {
    if (!over(e.target) || over(e.relatedTarget)) return
    clearTimeout(timer)
    setAwake(false)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerout', out)
  // the room for the tiles: inside the section's padding, which leaves the top bar's and the buttons'
  // Electron leaves full screen on Escape only when the page asks
  const escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !full()) return
    e.preventDefault()
    document.exitFullscreen()
  }
  document.addEventListener('keydown', escape)
  const observer = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
  onCleanup(() => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerout', out)
    document.removeEventListener('keydown', escape)
    clearTimeout(timer)
    observer.disconnect()
  })
  return (
    <Show when={calls.callIn(selectedChannel())}>
      {(c) => {
        const guildId = () => c().guild_id
        const states = () => voice.states(c().id)
        const others = () => states().filter((v) => v.userId !== users.me()?.id)
        // as stock's DM call without cameras or streams: round avatars alone (and an empty channel's Join, shorter)
        const compact = () =>
          !states().length || (!guildId() && !states().some((v) => v.selfStream || streams.videoOf(v.userId, null)))
        const watched = () => others().filter((v) => v.selfStream && streams.watching(v.userId, guildId()))
        const focus = () => {
          const f = focused(),
            id = f?.replace('stream:', '')
          return states().some((v) => v.userId === id && (v.selfStream || f === id)) ? f : null
        }
        // the column count giving the largest equal 16:9 tiles in the room left for them
        const grid = createMemo(() => {
          const n = states().length + states().filter((v) => v.selfStream).length,
            { w, h } = size()
          let best = { cols: 1, width: 0 }
          for (let cols = 1; cols <= n; cols++) {
            const rows = Math.ceil(n / cols),
              width = Math.min((w - GAP * (cols - 1)) / cols, ((h - GAP * (rows - 1)) / rows) * (16 / 9))
            if (width > best.width) best = { cols, width }
          }
          return best
        })
        return (
          <section
            ref={(s) => {
              section = s
              observer.observe(s)
              s.addEventListener('fullscreenchange', () => {
                const on = document.fullscreenElement === s
                setFull(on)
                if (!on) setFocused(before)
              })
              wake()
            }}
            class={['call', { compact: compact(), idle: !awake(), expanded: expanded(), focused: !!focus() }]}
            style={{ '--cols': grid().cols, '--tile-width': `${Math.floor(grid().width)}px` }}
            onClick={(e) => {
              const tile = (e.target as Element).closest('figure.tile')
              if (!tile || compact() || (e.target as Element).closest('button')) return
              const id = (tile.classList.contains('stream') ? 'stream:' : '') + (tile as HTMLElement).dataset.id
              // full screen keeps its tile filling the screen
              if (full() && focus() === id) return
              setFocused(focus() === id ? null : id)
            }}
          >
            {/* by user: a voice state's update (mute, deafen) keeps the tiles, and their videos playing */}
            <For each={states()} keyed={(v) => v.userId}>
              {(v) => (
                <Show when={users.get(v().userId)}>
                  {(user) => (
                    <>
                      <Tile
                        user={user()}
                        guildId={guildId()}
                        speaking={voice.speaking(v().userId)}
                        muted={voice.muted(v())}
                        deafened={voice.deafened(v())}
                        video={streams.videoOf(v().userId, guildId())}
                        compact={compact()}
                        focus={focus() === v().userId}
                      />
                      <Show when={v().selfStream}>
                        <StreamTile
                          state={v()}
                          channel={c()}
                          name={users.displayName(user(), guildId())}
                          focus={focus() === `stream:${v().userId}`}
                          full={full()}
                          onFull={() => {
                            if (full()) return document.exitFullscreen()
                            before = focused()
                            setFocused(`stream:${v().userId}`)
                            section!.requestFullscreen()
                          }}
                        />
                      </Show>
                    </>
                  )}
                </Show>
              )}
            </For>
            {/* the call's buttons while you're in it; Join (a DM's video and voice) while you're elsewhere */}
            <footer class="call-bar">
              <Show when={voice.connected(c())} fallback={<JoinButtons channel={c()} />}>
                <Toggle
                  class="call-mute"
                  on={audio.selfMuted()}
                  icon="mic"
                  onIcon="mic-off"
                  title={text('MUTE')}
                  onTitle={text('UNMUTE')}
                  onClick={audio.toggleMute}
                />
                <Toggle
                  class="call-deafen"
                  on={audio.selfDeafened()}
                  icon="headphones"
                  onIcon="deaf"
                  title={text('DEAFEN')}
                  onTitle={text('UNDEAFEN')}
                  onClick={audio.toggleDeafen}
                />
                <Toggle
                  class="call-camera"
                  on={audio.camera()}
                  icon="video-slash"
                  onIcon="video"
                  title={text('CAMERA_ON')}
                  onTitle={text('CAMERA_OFF')}
                  onClick={audio.toggleCamera}
                />
                <Toggle
                  class="call-screen"
                  on={streams.live()}
                  icon="screen"
                  onIcon="screen-x"
                  title={text('SHARE_YOUR_SCREEN')}
                  onTitle={text('STOP_STREAMING')}
                  onClick={() => streams.toggleLive(c())}
                />
                <Show when={watched().length}>
                  <IconButton
                    class="call-stop-watching"
                    icon="screen-x"
                    title={text('STOP_WATCHING')}
                    onClick={() => watched().forEach((v) => streams.toggleWatch(v.userId, guildId()))}
                  />
                </Show>
                <IconButton class="call-disconnect" icon="hangup" title={text('DISCONNECT_SELF')} onClick={voice.leave} />
              </Show>
            </footer>
            <Show when={!compact() && !full()}>
              <IconButton
                class="call-expand"
                icon="chevron"
                title={text(expanded() ? 'COLLAPSE' : 'EXPAND')}
                onClick={() => setExpanded((on) => !on)}
              />
            </Show>
          </section>
        )
      }}
    </Show>
  )
}

// as stock, while you're elsewhere: Join Voice, or a DM call's video and voice
function JoinButtons(p: { channel: Channel }) {
  return (
    <Show
      when={!p.channel.guild_id}
      fallback={
        <Button variant="positive" class="call-join" onClick={() => voice.join(p.channel)}>
          {text('JOIN_VOICE')}
        </Button>
      }
    >
      <IconButton
        class="call-join-video"
        icon="video"
        title={text('JOIN_VIDEO_CALL')}
        onClick={() => calls.join(p.channel, true)}
      />
      <IconButton class="call-join" icon="call" title={text('JOIN_CALL')} onClick={() => calls.join(p.channel, false)} />
    </Show>
  )
}

// someone's Go Live, beside their tile: Watch Stream until watched (in a call, Discord's core watches a stream the other
// person starts by itself), then the stream with its quality, LAG while the network troubles it (screen-capture's
// receiveHealth, asked each second) and LIVE, and Full Screen (or a double click on it): the call view full screen
// with the stream filling it; Stop Watching is in the call's buttons. Your own: its preview (the core's local video, watched while
// you stream)
function StreamTile(p: {
  state: VoiceState
  channel: Channel
  name: string
  focus: boolean
  full: boolean
  onFull: () => void
}) {
  const owner = () => p.state.userId
  const guildId = () => p.channel.guild_id
  const watching = () => !!streams.watching(owner(), guildId())
  const [health, setHealth] = createSignal<screen.ReceiveHealth | null>(null)
  createEffect(
    () => watching() && owner() !== users.me()?.id,
    (on) => {
      if (!on) return
      const timer = setInterval(() => screen.receiveHealth(owner()).then(setHealth), 1000)
      return () => {
        clearInterval(timer)
        setHealth(null)
      }
    },
  )
  return (
    <figure
      class={['tile', 'stream', { watching: watching(), focus: p.focus }]}
      data-id={owner()}
      onDblClick={(e) => e.target instanceof HTMLVideoElement && p.onFull()}
    >
      <Show
        when={watching() && streams.videoOf(owner(), guildId(), 'stream')}
        fallback={
          <Button class="stream-watch" onClick={() => streams.toggleWatch(owner(), guildId())}>
            {text('WATCH_STREAM')}
          </Button>
        }
      >
        {(id) => (
          <>
            <Video id={id()} />
            <IconButton
              class="stream-full"
              icon={p.full ? 'fullscreen-exit' : 'fullscreen'}
              title={text(p.full ? 'EXIT_FULL_SCREEN' : 'FULL_SCREEN')}
              onClick={p.onFull}
            />
          </>
        )}
      </Show>
      <span class="badges">
        <Show when={streams.quality(owner(), guildId())}>{(q) => <i class="quality">{q()}</i>}</Show>
        <Show when={health()?.lag && health()}>
          {(h) => (
            <i
              class="lag"
              title={text('LAG_DETAIL', {
                loss: Math.round(h().loss * 1000) / 10,
                pli: h().pli,
                jitter: Math.round(h().jitterMs),
              })}
            >
              {text('LAG')}
            </i>
          )}
        </Show>
        <Badge kind="live">LIVE</Badge>
      </span>
      <b class="name">
        <Icon name="screen" />
        {p.name}
      </b>
    </figure>
  )
}

// stock's DM header buttons: a voice or video call; gone while you're in it
export function CallButtons(p: { channel: PrivateChannel }) {
  return (
    <Show when={!voice.connected(p.channel)}>
      <IconButton
        class="call-start"
        icon="call"
        title={text('START_VOICE_CALL')}
        onClick={() => calls.start(p.channel, false)}
      />
      <IconButton
        class="call-video"
        icon="video"
        title={text('START_VIDEO_CALL')}
        onClick={() => calls.start(p.channel, true)}
      />
    </Show>
  )
}

// calls ringing for you, at the top of the window: the caller, Accept, Decline
export function IncomingCalls() {
  useRingtone()
  return (
    <For each={calls.incoming()}>
      {(call) => (
        <dialog class="incoming" data-id={call.channel.id} open>
          <Show when={calls.caller(call)} fallback={channels.title(call.channel)}>
            {(u) => (
              <>
                <Avatar user={u()} size={48} />
                <Name user={u()} />
              </>
            )}
          </Show>
          <small>{text('INCOMING_CALL_ELLIPSIS')}</small>
          <IconButton class="incoming-accept" icon="voice" title={text('ACCEPT')} onClick={() => calls.accept(call)} />
          <IconButton
            class="incoming-decline"
            icon="hangup"
            title={text('DECLINE')}
            onClick={() => calls.decline(call)}
          />
        </dialog>
      )}
    </For>
  )
}
