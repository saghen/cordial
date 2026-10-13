// The call view: who's in the selected voice channel, or in the DM's call, as tiles above its messages (a voice
// channel's text chat), with Join below them while elsewhere; the DM header's call button; incoming calls with Accept and Decline.
// Discord's voice engine does the call (stock's selectVoiceChannel, call and stopRinging)

import { createEffect, createMemo, For, Show } from 'solid-js'

import { A, S } from '../adapter/needs'
import type { FluxStore, Id, Rec } from '../adapter/discord'
import { url } from './channels'
import { nameOf } from '../api/model'
import { $, selectedChannel } from '../api/store'
import { Button, IconButton } from '../primitives/button'

// a DM's call with someone in it (a call record can outlive its last participant)
const going = (id: Id) => !!$.Call.getCall(id) && Object.keys($.VoiceState.getVoiceStatesForChannel(id)).length > 0

// voice and stage channels, and DMs with a call going
const callOf = () => {
  const c = selectedChannel()
  return c && (c.type === 2 || c.type === 13 || (!c.guild_id && going(c.id))) ? c : null
}

export function CallView() {
  return (
    <Show when={callOf()}>
      {(c) => {
        const states = () => Object.values($.VoiceState.getVoiceStatesForChannel(c().id)) as Rec[]
        return (
          <section class={['call', { dm: !c().guild_id }]}>
            <For each={states()}>
              {(v) => {
                const user = () => $.User.getUser(v.userId)
                const name = () => nameOf(user(), c().guild_id && $.GuildMember.getMember(c().guild_id, v.userId)?.nick)
                return (
                  <>
                    <figure
                      data-id={v.userId}
                      title={name()}
                      style={url(user()?.getAvatarURL(c().guild_id, 128))}
                      class={[
                        'tile',
                        {
                          speaking: $.Speaking.isSpeaking(v.userId),
                          mute: v.selfMute || v.mute,
                          deaf: v.selfDeaf || v.deaf,
                        },
                      ]}
                    >
                      <Show when={$.VideoStream.getStreamId(v.userId, c().guild_id ?? null)}>
                        {(id) => <Video id={id()} />}
                      </Show>
                      {name()}
                    </figure>
                    <Show when={v.selfStream && v.userId !== S.Auth.getId()}>
                      <StreamTile ownerId={v.userId} guildId={c().guild_id ?? null} name={name()} />
                    </Show>
                  </>
                )
              }}
            </For>
            {/* as stock, below the tiles while you're elsewhere: Join Voice, or a DM call's video and voice */}
            <Show when={$.RTCConnection.getChannelId() !== c().id}>
              <footer>
                <Show
                  when={!c().guild_id}
                  fallback={
                    <Button variant="positive" class="call-join" onClick={() => A.voice.selectVoiceChannel(c().id)}>
                      Join Voice
                    </Button>
                  }
                >
                  <IconButton
                    class="call-join-video"
                    icon="video"
                    title="Join Call with Video"
                    onClick={() => A.calls.call(c().id, true, false)}
                  />
                  <IconButton
                    class="call-join"
                    icon="call"
                    title="Join Call"
                    onClick={() => A.calls.call(c().id, false, false)}
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

// someone's Go Live, beside their tile. Discord sends a stream's video only to its viewers: Watch Stream is stock's
// watch (STREAM_WATCH), then the stream's video (its "stream" video context) fills a larger tile while shown, with Stop
// Watching (stock's: STREAM_CLOSE then STREAM_STOP). In a call, Discord's core watches a stream the other person
// starts by itself
function StreamTile(p: { ownerId: Id; guildId: Id | null; name: string }) {
  const watching = () => $.ApplicationStreaming.getActiveStreamForUser(p.ownerId, p.guildId)
  const video = () => watching() && $.VideoStream.getStreamId(p.ownerId, p.guildId, 'stream')
  const toggle = () => {
    const w = S.ApplicationStreaming.getActiveStreamForUser(p.ownerId, p.guildId)
    if (w) return A.streams.stop(streamKey(w), false)
    const s = S.ApplicationStreaming.getStreamForUser(p.ownerId, p.guildId)
    if (s) A.streams.watch(s, { noFocus: true })
  }
  return (
    <figure class={{ stream: true, watching: !!watching() }} data-id={p.ownerId}>
      <Show when={video()}>{(id) => <Video id={id()} />}</Show>
      <span>{p.name}</span>
      <Button class="stream-watch" onClick={toggle}>
        {watching() ? 'Stop Watching' : 'Watch Stream'}
      </Button>
    </figure>
  )
}

// a camera in the call: the web engine's stream, viewed while shown (as stock's Video component)
function Video(p: { id: string }) {
  const el = (<video autoplay muted playsinline />) as HTMLVideoElement
  createEffect(
    () => p.id,
    (id) => {
      A.video.watch(id)
      el.srcObject = A.video.stream(id) ?? null
      return () => {
        A.video.unwatch(id)
        el.srcObject = null
      }
    },
  )
  return el
}

// stock's DM header buttons: a voice or video call to the DM (ringing its recipients, or a 1:1 DM's user), or into the
// call already going there (no ring); gone while you're in it
export function CallButtons(p: { channel: Rec }) {
  const call = (video: boolean) =>
    A.calls.call(
      p.channel.id,
      video,
      !going(p.channel.id),
      p.channel.type === 1 ? p.channel.getRecipientId() : undefined,
    )
  return (
    <Show when={$.RTCConnection.getChannelId() !== p.channel.id}>
      <IconButton class="call-start" icon="call" title="Start Voice Call" onClick={() => call(false)} />
      <IconButton class="call-video" icon="video" title="Start Video Call" onClick={() => call(true)} />
    </Show>
  )
}

// calls ringing for you: Accept joins and opens the DM, Decline stops the ringing (stock's), and the ringtone loops
// meanwhile, as stock's (unless its sound is off)
export function IncomingCalls() {
  const ringing = createMemo(
    () => $.IncomingCall.getIncomingCalls().length > 0 && !$.NotificationSettings.isSoundDisabled('call_ringing'),
  )
  let sound: ReturnType<typeof A.sounds.forPack> | undefined
  createEffect(ringing, (on) => {
    if (on) (sound ??= A.sounds.forPack('call_ringing', S.Soundpack.getSoundpack())).loop()
    else sound?.stop()
  })
  return (
    <For each={$.IncomingCall.getIncomingCalls() as Rec[]}>
      {(call) => (
        <dialog
          class="incoming"
          data-id={call.channel.id}
          open
          style={url($.User.getUser(call.senderId)?.getAvatarURL(undefined, 80))}
        >
          {nameOf($.User.getUser(call.senderId))}
          <small>Incoming Call…</small>
          <IconButton
            class="incoming-accept"
            icon="voice"
            title="Accept"
            onClick={() => {
              A.voice.selectVoiceChannel(call.channel.id)
              A.nav.transitionTo(`/channels/@me/${call.channel.id}`)
            }}
          />
          <IconButton
            class="incoming-decline"
            icon="hangup"
            title="Decline"
            onClick={() => A.calls.stopRinging(call.channel.id)}
          />
        </dialog>
      )}
    </For>
  )
}

// Stock's voice sounds, which its UI plays (its sound hooks, b9 and Me...Ma in the app module): each watches some
// stores, and a change from the last state names a sound, played unless its sound is off. Not ported: stage
// channels' request to speak, and Activities
function sound<T>(stores: FluxStore[], state: () => T, pick: (prev: T, next: T) => string | void) {
  let prev = state()
  const check = () => {
    const next = state(),
      name = pick(prev, next)
    prev = next
    if (name && !S.NotificationSettings.isSoundDisabled(name)) A.sounds.play(name, 0.4)
  }
  for (const s of stores) s.addChangeListener(check)
}

const STAGE = 13
const voiceChannel = () => S.Channel.getChannel(S.SelectedChannel.getVoiceChannelId()!)
const streamKey = (s: Rec) =>
  (s.streamType === 'call'
    ? [s.streamType, s.channelId, s.ownerId]
    : [s.streamType, s.guildId, s.channelId, s.ownerId]
  ).join(':')

export function voiceSounds() {
  const { MediaEngine: me, SelectedChannel: sel, RTCConnection: rtc, Speaking: speaking, VoiceState: vs } = S
  sound(
    [me, sel],
    () => ({
      inVoice: sel.getVoiceChannelId() != null,
      mute: me.isSelfMute(),
      deaf: me.isSelfDeaf(),
      ready: me.isNativeAudioPermissionReady(),
      skip: me.shouldSkipMuteUnmuteSound(),
    }),
    (p, n) => {
      if (p.deaf !== n.deaf) return n.deaf ? 'deafen' : 'undeafen'
      if (n.ready && (n.inVoice || p.ready) && p.mute !== n.mute) {
        if (n.skip) return me.notifyMuteUnmuteSoundWasSkipped()
        return n.mute ? 'mute' : 'unmute'
      }
    },
  )
  sound(
    [me, sel],
    () => ({ video: me.isVideoEnabled(), inVoice: sel.getVoiceChannelId() != null }),
    (p, n) => {
      if (p.video !== n.video && p.inVoice && n.inVoice) return n.video ? 'camera_on' : 'camera_off'
    },
  )
  // joining (when the connection starts; the 2026-09-voice-connect-feedback experiment's default) and leaving
  sound(
    [S.Channel, rtc, sel, S.GameConsole],
    () => {
      const state = rtc.getState()
      return {
        stage: voiceChannel()?.type === STAGE,
        connected: state === 'RTC_CONNECTED',
        started: (!rtc.getWasEverRtcConnected() && state !== 'DISCONNECTED') || state === 'RTC_CONNECTED',
        awaitingRemote: S.GameConsole.getAwaitingRemoteSessionInfo() != null,
        remote: S.GameConsole.getRemoteSessionId() != null,
      }
    },
    (p, n) => {
      if ((!p.started && n.started) || (n.remote && !p.remote)) return n.stage ? undefined : 'user_join'
      if (p.connected && !n.connected && !n.awaitingRemote && !n.remote && !p.stage) return 'disconnect'
    },
  )
  const pttMode = (mode: string) => me.getMode() === mode && !me.isSelfMute()
  sound(
    [speaking],
    () => speaking.isCurrentUserPTTActive(),
    (p, n) => {
      if (p !== n && pttMode('PUSH_TO_TALK')) return n ? 'ptt_start' : 'ptt_stop'
    },
  )
  sound(
    [me, S.NotificationSettings],
    () => me.isSelfMutedTemporarily(),
    (p, n) => {
      if (p !== n && pttMode('VOICE_ACTIVITY') && !S.NotificationSettings.isSoundDisabled(n ? 'mute' : 'unmute'))
        return n ? 'ptt_stop' : 'ptt_start'
    },
  )
  sound(
    [speaking],
    () => speaking.isCurrentUserPrioritySpeaker(),
    (p, n) => {
      if (p !== n && pttMode('VOICE_ACTIVITY')) return n ? 'ptt_start' : 'ptt_stop'
    },
  )
  sound(
    [vs],
    () => vs.userHasBeenMovedVersion,
    (p, n) => (p !== n ? 'user_moved' : undefined),
  )
  // others joining and leaving your voice channel or call (up to 25 people), and Go Live streams starting, ending and
  // being watched (the experiment's variations count the RTC connection's users instead)
  const streams = S.ApplicationStreaming
  sound(
    [sel, streams, S.Auth, vs, S.Channel],
    () => {
      const id = sel.getVoiceChannelId(),
        me = S.Auth.getId(),
        c = id ? S.Channel.getChannel(id) : undefined,
        all = streams.getAllActiveStreams()
      let stream = all.length === 1 ? all[0] : streams.getCurrentUserActiveStream()
      if (stream?.state === 'CONNECTING') stream = null
      const key = stream ? streamKey(stream) : null
      return {
        c,
        count: c ? S.SortedVoiceState.countVoiceStatesForChannel(c.id) - +vs.isInChannel(c.id) : undefined,
        streaming: c ? streams.getAllApplicationStreamsForChannel(c.id).map((s) => s.ownerId as Id) : [],
        key,
        viewers: key ? streams.getViewerIds(key).filter((u) => u !== me).length : 0,
        me,
        owners: all.map((s) => s.ownerId as Id),
      }
    },
    (p, n) => {
      const c = n.c
      if (
        p.c?.id !== c?.id ||
        !c ||
        c.type === STAGE ||
        (c.guild_id && S.Guild.getGuild(c.guild_id)?.afkChannelId === c.id)
      )
        return
      const sameStream = n.key != null && p.key === n.key,
        small = p.count != null && n.count != null && p.count <= 25
      if (n.streaming.some((u) => !p.streaming.includes(u))) return 'stream_started'
      if (p.streaming.some((u) => !n.streaming.includes(u) && (u === n.me || p.owners.includes(u))))
        return 'stream_ended'
      if (p.viewers <= 25 && sameStream && n.viewers > p.viewers) return 'stream_user_joined'
      if (small && n.count! > p.count!) return 'user_join'
      if (small && n.count! < p.count!) return 'user_leave'
      if (p.viewers <= 25 && sameStream && n.viewers < p.viewers) return 'stream_user_left'
    },
  )
}
