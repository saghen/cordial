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

// stock's volume for its voice sounds
const VOLUME = 0.4
// past this many in the call or watching a stream, no sound for others joining and leaving
const SMALL = 25

// Stock's voice sounds, which its UI plays (its sound hooks in the app module): each watches some stores, and a change
// from the last state names a sound, played unless its sound is off. Not ported: stage channels' request to speak, and
// Activities
function sound<T>(stores: FluxStore[], state: () => T, pick: (prev: T, next: T) => string | void) {
  let prev = state()
  function check() {
    const next = state()
    const name = pick(prev, next)
    prev = next
    if (name && !S.NotificationSettings.isSoundDisabled(name)) A.sounds.play(name, VOLUME)
  }
  for (const store of stores) store.addChangeListener(check)
}

const STAGE = ChannelType.Stage
const voiceChannel = () => S.Channel.getChannel(S.SelectedChannel.getVoiceChannelId()!)

export function useVoiceSounds() {
  const {
    MediaEngine: mediaEngine,
    SelectedChannel: selectedChannel,
    RTCConnection: rtcConnection,
    Speaking: speaking,
    VoiceState: voiceStates,
  } = S
  sound(
    [mediaEngine, selectedChannel],
    () => ({
      inVoice: selectedChannel.getVoiceChannelId() != null,
      mute: mediaEngine.isSelfMute(),
      deaf: mediaEngine.isSelfDeaf(),
      ready: mediaEngine.isNativeAudioPermissionReady(),
      skip: mediaEngine.shouldSkipMuteUnmuteSound(),
    }),
    (prev, next) => {
      if (prev.deaf !== next.deaf) return next.deaf ? 'deafen' : 'undeafen'
      if (next.ready && (next.inVoice || prev.ready) && prev.mute !== next.mute) {
        if (next.skip) return mediaEngine.notifyMuteUnmuteSoundWasSkipped()
        return next.mute ? 'mute' : 'unmute'
      }
    },
  )
  sound(
    [mediaEngine, selectedChannel],
    () => ({ video: mediaEngine.isVideoEnabled(), inVoice: selectedChannel.getVoiceChannelId() != null }),
    (prev, next) => {
      if (prev.video !== next.video && prev.inVoice && next.inVoice) return next.video ? 'camera_on' : 'camera_off'
    },
  )
  // joining (when the connection starts; the 2026-09-voice-connect-feedback experiment's default) and leaving
  sound(
    [S.Channel, rtcConnection, selectedChannel, S.GameConsole],
    () => {
      const state = rtcConnection.getState()
      return {
        stage: voiceChannel()?.type === STAGE,
        connected: state === 'RTC_CONNECTED',
        started: (!rtcConnection.getWasEverRtcConnected() && state !== 'DISCONNECTED') || state === 'RTC_CONNECTED',
        awaitingRemote: S.GameConsole.getAwaitingRemoteSessionInfo() != null,
        remote: S.GameConsole.getRemoteSessionId() != null,
      }
    },
    (prev, next) => {
      if ((!prev.started && next.started) || (next.remote && !prev.remote)) return next.stage ? undefined : 'user_join'
      if (prev.connected && !next.connected && !next.awaitingRemote && !next.remote && !prev.stage) return 'disconnect'
    },
  )
  const pttMode = (mode: string) => mediaEngine.getMode() === mode && !mediaEngine.isSelfMute()
  sound(
    [speaking],
    () => speaking.isCurrentUserPTTActive(),
    (prev, next) => {
      if (prev !== next && pttMode('PUSH_TO_TALK')) return next ? 'ptt_start' : 'ptt_stop'
    },
  )
  sound(
    [mediaEngine, S.NotificationSettings],
    () => mediaEngine.isSelfMutedTemporarily(),
    (prev, next) => {
      if (
        prev !== next &&
        pttMode('VOICE_ACTIVITY') &&
        !S.NotificationSettings.isSoundDisabled(next ? 'mute' : 'unmute')
      )
        return next ? 'ptt_stop' : 'ptt_start'
    },
  )
  sound(
    [speaking],
    () => speaking.isCurrentUserPrioritySpeaker(),
    (prev, next) => {
      if (prev !== next && pttMode('VOICE_ACTIVITY')) return next ? 'ptt_start' : 'ptt_stop'
    },
  )
  sound(
    [voiceStates],
    () => voiceStates.userHasBeenMovedVersion,
    (prev, next) => (prev !== next ? 'user_moved' : undefined),
  )
  // others joining and leaving your voice channel or call (up to 25 people), and Go Live streams starting, ending and
  // being watched (the experiment's variations count the RTC connection's users instead)
  const streaming = S.ApplicationStreaming
  sound(
    [selectedChannel, streaming, S.Auth, voiceStates, S.Channel],
    () => {
      const id = selectedChannel.getVoiceChannelId()
      const myId = S.Auth.getId()
      const channel = id ? S.Channel.getChannel(id) : undefined
      const all = streaming.getAllActiveStreams()
      let stream = all.length === 1 ? all[0] : streaming.getCurrentUserActiveStream()
      if (stream?.state === 'CONNECTING') stream = null
      const key = stream ? streams.key(stream) : null
      return {
        channel,
        count: channel
          ? S.SortedVoiceState.countVoiceStatesForChannel(channel.id) - Number(voiceStates.isInChannel(channel.id))
          : undefined,
        streaming: channel
          ? streaming.getAllApplicationStreamsForChannel(channel.id).map((channelStream) => channelStream.ownerId as Id)
          : [],
        key,
        viewers: key ? streaming.getViewerIds(key).filter((userId) => userId !== myId).length : 0,
        myId,
        owners: all.map((active) => active.ownerId as Id),
      }
    },
    (prev, next) => {
      const channel = next.channel
      if (
        prev.channel?.id !== channel?.id ||
        !channel ||
        channel.type === STAGE ||
        (channel.guild_id && S.Guild.getGuild(channel.guild_id)?.afkChannelId === channel.id)
      )
        return
      const sameStream = next.key != null && prev.key === next.key
      const small = prev.count != null && next.count != null && prev.count <= SMALL
      if (next.streaming.some((userId) => !prev.streaming.includes(userId))) return 'stream_started'
      if (
        prev.streaming.some(
          (userId) => !next.streaming.includes(userId) && (userId === next.myId || prev.owners.includes(userId)),
        )
      )
        return 'stream_ended'
      if (prev.viewers <= SMALL && sameStream && next.viewers > prev.viewers) return 'stream_user_joined'
      if (small && next.count! > prev.count!) return 'user_join'
      if (small && next.count! < prev.count!) return 'user_leave'
      if (prev.viewers <= SMALL && sameStream && next.viewers < prev.viewers) return 'stream_user_left'
    },
  )
}
