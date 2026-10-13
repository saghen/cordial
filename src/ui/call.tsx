// The call view: who's in the selected voice channel, or in the DM's call, as tiles above its messages (a voice
// channel's text chat), with Join while elsewhere; the DM header's call button; incoming calls with Accept and Decline.
// Discord's voice engine does the call (stock's selectVoiceChannel, call and stopRinging)

import { createEffect, createMemo, For, Show } from 'solid-js'

import { A, S } from '../adapter/core'
import type { FluxStore, Id, Rec } from '../adapter/discord'
import { url } from './channels'
import { nameOf } from './lib/model'
import { $, selectedChannel } from './lib/store'

// voice and stage channels, and DMs with a call going
const callOf = () => {
  const c = selectedChannel()
  return c && (c.type === 2 || c.type === 13 || (!c.guild_id && $.Call.getCall(c.id))) ? c : null
}

export function CallView() {
  return (
    <Show when={callOf()}>
      {(c) => {
        const states = () => Object.values($.VoiceState.getVoiceStatesForChannel(c().id)) as Rec[]
        return (
          <section data-mc="call">
            <For each={states()}>
              {(v) => {
                const user = () => $.User.getUser(v.userId)
                return (
                  <figure
                    data-mc={`tile:${v.userId}`}
                    style={url(user()?.getAvatarURL(c().guild_id, 128))}
                    class={{
                      speaking: $.Speaking.isSpeaking(v.userId),
                      mute: v.selfMute || v.mute,
                      deaf: v.selfDeaf || v.deaf,
                    }}
                  >
                    <Show when={$.VideoStream.getStreamId(v.userId, c().guild_id ?? null)}>
                      {(id) => <Video id={id()} />}
                    </Show>
                    {nameOf(user(), c().guild_id && $.GuildMember.getMember(c().guild_id, v.userId)?.nick)}
                  </figure>
                )
              }}
            </For>
            <Show when={$.RTCConnection.getChannelId() !== c().id}>
              <button data-mc="call:join" onClick={() => A.voice.selectVoiceChannel(c().id)}>
                {states().length ? 'Join Voice' : c().guild_id ? 'Join Voice' : 'Join Call'}
              </button>
            </Show>
          </section>
        )
      }}
    </Show>
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

// stock's DM header button: a call to the DM (ringing its recipients), or to a 1:1 DM's user
export const CallButton = (p: { channel: Rec }) => (
  <button
    data-mc="call:start"
    title="Start Voice Call"
    onClick={() =>
      A.calls.call(p.channel.id, false, true, p.channel.type === 1 ? p.channel.getRecipientId() : undefined)
    }
  />
)

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
          data-mc={`incoming:${call.channel.id}`}
          open
          style={url($.User.getUser(call.senderId)?.getAvatarURL(undefined, 80))}
        >
          {nameOf($.User.getUser(call.senderId))}
          <small>Incoming Call…</small>
          <button
            data-mc="incoming:accept"
            title="Accept"
            onClick={() => {
              A.voice.selectVoiceChannel(call.channel.id)
              A.nav.transitionTo(`/channels/@me/${call.channel.id}`)
            }}
          />
          <button data-mc="incoming:decline" title="Decline" onClick={() => A.calls.stopRinging(call.channel.id)} />
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
