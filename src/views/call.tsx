// The call view: who's in the selected voice channel, or in the DM's call, as tiles above its messages (a voice
// channel's text chat), with Join below them while elsewhere; the DM header's call buttons; incoming calls with Accept
// and Decline.

import { For, Show } from 'solid-js'

import * as calls from '../api/calls'
import * as channels from '../api/channels'
import { useRingtone } from '../api/sounds'
import type { Id, PrivateChannel, VoiceState } from '../api/records'
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
          <section class={['call', { dm: !guildId() }]}>
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
                      <Show when={v.selfStream && v.userId !== users.me()?.id}>
                        <StreamTile
                          state={v}
                          guildId={guildId()}
                          name={users.nameOf(user(), users.member(user(), guildId())?.nick)}
                        />
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

// someone's Go Live, beside their tile: Watch Stream until watched, then the stream, larger, with Stop Watching. In a
// call, Discord's core watches a stream the other person starts by itself
function StreamTile(p: { state: VoiceState; guildId: Id | null; name: string }) {
  const owner = () => p.state.userId
  const watching = () => !!streams.watching(owner(), p.guildId)
  return (
    <figure class={{ stream: true, watching: watching() }} data-id={owner()}>
      <Show when={watching() && streams.videoOf(owner(), p.guildId, 'stream')}>{(id) => <Video id={id()} />}</Show>
      <span>{p.name}</span>
      <Button class="stream-watch" onClick={() => streams.toggleWatch(owner(), p.guildId)}>
        {text(watching() ? 'STOP_WATCHING' : 'WATCH_STREAM')}
      </Button>
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
