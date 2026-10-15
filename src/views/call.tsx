// The call view, as stock's: who's in the selected voice channel or DM call as tiles filling the area (the top bar's
// too, which it puts on the call's black; a server's voice channel's call takes the chat's place), a click on one fills
// the area with it; under them the call's buttons, or Join while you're elsewhere; the DM header's call buttons;
// incoming calls with Accept and Decline. In a call you're in with a stream, its badges, pills, buttons and the top bar
// fade while the pointer is elsewhere or still for 5 s; Expand puts the call over the chat.

import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

import * as screen from '../../screen-capture/src/renderer'

import * as audio from '../api/audio'
import * as calls from '../api/calls'
import * as channels from '../api/channels'
import { useRingtone } from '../api/sounds'
import type { Channel, PrivateChannel, VoiceState } from '../api/types'
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
const TILE_ASPECT = 16 / 9
const HEALTH_POLL_MS = 1000

export function CallView() {
  const [expanded, setExpanded] = createSignal(false)
  // the tile filling the area: a user's id, or "stream:" and theirs
  const [focused, setFocused] = createSignal<string | null>(null)
  const [awake, setAwake] = createSignal(true)
  // full screen: the call view, a stream filling it, with its UI as in the window
  const [full, setFull] = createSignal(false)
  // the tile that filled the area before, back on leaving full screen
  let before: string | null = null
  const [size, setSize] = createSignal({ width: 0, height: 0 })
  let timer: ReturnType<typeof setTimeout> | undefined
  let section: HTMLElement | undefined
  // the UI shows while the pointer moves over the call or the top bar on it, and while it rests on the buttons or the
  // top bar; it hides as the pointer leaves both
  const over = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest('#cordial-root > :is(header, section.call)'))
  function sleep() {
    clearTimeout(timer)
    if (!section?.parentElement?.querySelector(':scope > header:hover, :scope > section.call > .call-bar:hover'))
      setAwake(false)
    else timer = setTimeout(sleep, IDLE)
  }
  function wake() {
    setAwake(true)
    clearTimeout(timer)
    timer = setTimeout(sleep, IDLE)
  }
  const move = (e: PointerEvent) => over(e.target) && wake()
  function out(e: PointerEvent) {
    if (!over(e.target) || over(e.relatedTarget)) return
    clearTimeout(timer)
    setAwake(false)
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerout', out)
  // Electron leaves full screen on Escape only when the page asks
  function escape(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !full()) return
    e.preventDefault()
    document.exitFullscreen()
  }
  document.addEventListener('keydown', escape)
  // the room for the tiles: the section's content box, inside the padding left for the top bar and the buttons
  const observer = new ResizeObserver(([entry]) =>
    setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
  )
  onCleanup(() => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerout', out)
    document.removeEventListener('keydown', escape)
    clearTimeout(timer)
    observer.disconnect()
  })
  return (
    <Show when={calls.callIn(selectedChannel())}>
      {(channel) => {
        const guildId = () => channel().guild_id
        const states = () => voice.states(channel().id)
        const others = () => states().filter((state) => state.userId !== users.me()?.id)
        // as stock's DM call without cameras or streams: round avatars alone (and an empty channel's Join, shorter)
        const compact = () =>
          !states().length ||
          (!guildId() && !states().some((state) => state.selfStream || streams.videoOf(state.userId, null)))
        const watched = () => others().filter((state) => state.selfStream && streams.watching(state.userId, guildId()))
        // the UI fades only over a stream in a call you're in; otherwise it stays
        const fades = () => voice.connected(channel()) && states().some((state) => state.selfStream)
        function focus() {
          const tile = focused()
          const id = tile?.replace('stream:', '')
          return states().some((state) => state.userId === id && (state.selfStream || tile === id)) ? tile : null
        }
        // the column count giving the largest equal 16:9 tiles in the room left for them
        const grid = createMemo(() => {
          const count = states().length + states().filter((state) => state.selfStream).length
          const room = size()
          let best = { columns: 1, width: 0 }
          for (let columns = 1; columns <= count; columns++) {
            const rows = Math.ceil(count / columns)
            const width = Math.min(
              (room.width - GAP * (columns - 1)) / columns,
              ((room.height - GAP * (rows - 1)) / rows) * TILE_ASPECT,
            )
            if (width > best.width) best = { columns, width }
          }
          return best
        })
        return (
          <section
            ref={(element) => {
              section = element
              observer.observe(element)
              element.addEventListener('fullscreenchange', () => {
                const on = document.fullscreenElement === element
                setFull(on)
                if (!on) setFocused(before)
              })
              wake()
            }}
            class={[
              'call',
              {
                compact: compact(),
                idle: !awake() && fades(),
                expanded: expanded(),
                voice: channel().isGuildVocal(),
                focused: Boolean(focus()),
              },
            ]}
            style={{ '--columns': grid().columns, '--tile-width': `${Math.floor(grid().width)}px` }}
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
            <For each={states()} keyed={(state) => state.userId}>
              {(state) => (
                <Show when={users.get(state().userId)}>
                  {(user) => (
                    <>
                      <Tile
                        user={user()}
                        guildId={guildId()}
                        speaking={voice.speaking(state().userId)}
                        muted={voice.muted(state())}
                        deafened={voice.deafened(state())}
                        video={streams.videoOf(state().userId, guildId())}
                        compact={compact()}
                        focus={focus() === state().userId}
                      />
                      <Show when={state().selfStream}>
                        <StreamTile
                          state={state()}
                          channel={channel()}
                          name={users.displayName(user(), guildId())}
                          focus={focus() === `stream:${state().userId}`}
                          full={full()}
                          onFull={() => {
                            if (full()) return document.exitFullscreen()
                            before = focused()
                            setFocused(`stream:${state().userId}`)
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
              <Show when={voice.connected(channel())} fallback={<JoinButtons channel={channel()} />}>
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
                  onClick={() => streams.toggleLive(channel())}
                />
                <Show when={watched().length}>
                  <IconButton
                    class="call-stop-watching"
                    icon="screen-x"
                    title={text('STOP_WATCHING')}
                    onClick={() => watched().forEach((state) => streams.toggleWatch(state.userId, guildId()))}
                  />
                </Show>
                <IconButton
                  class="call-disconnect"
                  icon="hangup"
                  title={text('DISCONNECT_SELF')}
                  onClick={voice.leave}
                />
              </Show>
            </footer>
            <Show when={!compact() && !full() && !channel().isGuildVocal()}>
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
      <IconButton
        class="call-join"
        icon="call"
        title={text('JOIN_CALL')}
        onClick={() => calls.join(p.channel, false)}
      />
    </Show>
  )
}

// someone's Go Live, beside their tile: Watch Stream until watched (in a call, Discord's core watches a stream the
// other person starts by itself), then the stream with its quality, LAG while the network troubles it (screen-capture's
// receiveHealth, asked each second) and LIVE, and Full Screen (or a double click on it): the call view full screen with
// the stream filling it; Stop Watching is in the call's buttons. Your own: its preview (the core's local video, watched
// while you stream)
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
  const watching = () => Boolean(streams.watching(owner(), guildId()))
  const [health, setHealth] = createSignal<screen.ReceiveHealth | null>(null)
  createEffect(
    () => watching() && owner() !== users.me()?.id,
    (on) => {
      if (!on) return
      const timer = setInterval(() => screen.receiveHealth(owner()).then(setHealth), HEALTH_POLL_MS)
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
        <Show when={streams.quality(owner(), guildId())}>{(quality) => <i class="quality">{quality()}</i>}</Show>
        <Show when={health()?.lag && health()}>
          {(lag) => (
            <i
              class="lag"
              title={text('LAG_DETAIL', {
                loss: Math.round(lag().loss * 1000) / 10,
                pli: lag().pli,
                jitter: Math.round(lag().jitterMs),
              })}
            >
              {text('LAG')}
            </i>
          )}
        </Show>
        <Badge kind="live">{text('LIVE')}</Badge>
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
            {(user) => (
              <>
                <Avatar user={user()} size={48} />
                <Name user={user()} />
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
