// The call view: who's in the selected voice channel, or in the DM's call, as tiles above its messages (a voice
// channel's text chat), with Join below them while elsewhere; the DM header's call buttons; incoming calls with Accept
// and Decline.

import { createSignal, For, onCleanup, Show } from 'solid-js'

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
import { Button, IconButton } from '../primitives/button'

export function CallView() {
  return (
    <Show when={calls.callIn(selectedChannel())}>
      {(c) => {
        const guildId = () => c().guild_id
        const states = () => voice.states(c().id)
        // as stock's DM call without cameras or streams: round avatars alone
        const compact = () => !guildId() && !states().some((v) => v.selfStream || streams.videoOf(v.userId, null))
        return (
          <section class="call">
            <For each={states()}>
              {(v) => (
                <Show when={users.get(v.userId)}>
                  {(user) => (
                    <>
                      <Tile
                        user={user()}
                        guildId={guildId()}
                        speaking={voice.speaking(v.userId)}
                        muted={voice.muted(v)}
                        deafened={voice.deafened(v)}
                        video={streams.videoOf(v.userId, guildId())}
                        compact={compact()}
                      />
                      <Show when={v.selfStream}>
                        <StreamTile state={v} channel={c()} name={users.displayName(user(), guildId())} />
                      </Show>
                    </>
                  )}
                </Show>
              )}
            </For>
            {/* as stock, below the tiles while you're elsewhere: Join Voice, or a DM call's video and voice */}
            <Show when={!voice.connected(c())}>
              <footer>
                <Show
                  when={!guildId()}
                  fallback={
                    <Button variant="positive" class="call-join" onClick={() => voice.join(c())}>
                      {text('JOIN_VOICE')}
                    </Button>
                  }
                >
                  <IconButton
                    class="call-join-video"
                    icon="video"
                    title={text('JOIN_VIDEO_CALL')}
                    onClick={() => calls.join(c(), true)}
                  />
                  <IconButton
                    class="call-join"
                    icon="call"
                    title={text('JOIN_CALL')}
                    onClick={() => calls.join(c(), false)}
                  />
                </Show>
              </footer>
            </Show>
          </section>
        )
      }}
    </Show>
  )
}

// someone's Go Live, beside their tile: Watch Stream until watched, then the stream, larger, with Stop Watching and
// Full Screen (or a double click on it; Escape leaves). In a call, Discord's core watches a stream the other person
// starts by itself. Your own: its preview (the core's local video, watched while you stream), with Stop Streaming
function StreamTile(p: { state: VoiceState; channel: Channel; name: string }) {
  const owner = () => p.state.userId
  const guildId = () => p.channel.guild_id
  const self = () => owner() === users.me()?.id
  const watching = () => !!streams.watching(owner(), guildId())
  const [full, setFull] = createSignal(false)
  let tile!: HTMLElement
  const toggleFull = () => (full() ? document.exitFullscreen() : tile.requestFullscreen())
  // Electron leaves full screen on Escape only when the page asks
  const escape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !full()) return
    e.preventDefault()
    document.exitFullscreen()
  }
  document.addEventListener('keydown', escape)
  onCleanup(() => document.removeEventListener('keydown', escape))
  return (
    <figure
      ref={(f) => {
        tile = f
        f.addEventListener('fullscreenchange', () => setFull(document.fullscreenElement === f))
      }}
      class={{ stream: true, watching: watching() }}
      data-id={owner()}
      onDblClick={(e) => e.target instanceof HTMLVideoElement && toggleFull()}
    >
      <Show when={watching() && streams.videoOf(owner(), guildId(), 'stream')}>
        {(id) => (
          <>
            <Video id={id()} />
            <IconButton
              class="stream-full"
              icon={full() ? 'fullscreen-exit' : 'fullscreen'}
              title={text(full() ? 'EXIT_FULL_SCREEN' : 'FULL_SCREEN')}
              onClick={toggleFull}
            />
          </>
        )}
      </Show>
      <span>{p.name}</span>
      <Show
        when={!self()}
        fallback={
          <Button class="stream-watch" onClick={() => streams.toggleLive(p.channel)}>
            {text('STOP_STREAMING')}
          </Button>
        }
      >
        <Button class="stream-watch" onClick={() => streams.toggleWatch(owner(), guildId())}>
          {text(watching() ? 'STOP_WATCHING' : 'WATCH_STREAM')}
        </Button>
      </Show>
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
