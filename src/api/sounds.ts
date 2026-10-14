// Stock's sounds that its UI plays: the voice sounds (joining, leaving, mute, deafen, the camera, push to talk, others
// joining and leaving, streams) and the ringtone of a call ringing for you.

import { createEffect, createMemo } from 'solid-js'

import type { FluxStore, Id } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import { ChannelType } from './types'
import { $ } from './store'
import * as streams from './streams'

// while a call rings for you, the ringtone loops, as stock's (unless its sound is off)
export function useRingtone() {
  const ringing = createMemo(
    () => $.IncomingCall.getIncomingCalls().length > 0 && !$.NotificationSettings.isSoundDisabled('call_ringing'),
  )
  let sound: ReturnType<typeof A.sounds.forPack> | undefined
  createEffect(ringing, (on) => {
    if (on) (sound ??= A.sounds.forPack('call_ringing', S.Soundpack.getSoundpack())).loop()
    else sound?.stop()
  })
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

const STAGE = ChannelType.Stage
const voiceChannel = () => S.Channel.getChannel(S.SelectedChannel.getVoiceChannelId()!)

export function useVoiceSounds() {
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
  const streaming = S.ApplicationStreaming
  sound(
    [sel, streaming, S.Auth, vs, S.Channel],
    () => {
      const id = sel.getVoiceChannelId(),
        me = S.Auth.getId(),
        c = id ? S.Channel.getChannel(id) : undefined,
        all = streaming.getAllActiveStreams()
      let stream = all.length === 1 ? all[0] : streaming.getCurrentUserActiveStream()
      if (stream?.state === 'CONNECTING') stream = null
      const key = stream ? streams.key(stream) : null
      return {
        c,
        count: c ? S.SortedVoiceState.countVoiceStatesForChannel(c.id) - +vs.isInChannel(c.id) : undefined,
        streaming: c ? streaming.getAllApplicationStreamsForChannel(c.id).map((s) => s.ownerId as Id) : [],
        key,
        viewers: key ? streaming.getViewerIds(key).filter((u) => u !== me).length : 0,
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
