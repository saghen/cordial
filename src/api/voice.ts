// Voice: who's in a channel's voice (its voice states and their flags), your connection (its channel and its state, in
// stock's words), joining and leaving. Discord's own voice engine makes the call (stock's selectVoiceChannel).

import { A } from '../adapter/needs'
import type { Channel, Id, VoiceState } from './types'
import { $ } from './store'
import { text } from './strings'
import * as users from './users'

export const states = (channelId: Id) => Object.values($.VoiceState.getVoiceStatesForChannel(channelId)) as VoiceState[]
export const speaking = (userId: Id) => $.Speaking.isSpeaking(userId)
export const muted = (voiceState: VoiceState) => voiceState.selfMute || voiceState.mute
export const deafened = (voiceState: VoiceState) => voiceState.selfDeaf || voiceState.deaf
// muted or deafened by a moderator
export const forced = (voiceState: VoiceState) => voiceState.mute || voiceState.deaf

// your connection: the channel you're in, and whether a channel is it
export const channelId = () => $.RTCConnection.getChannelId()
export const channel = () => $.Channel.getChannel(channelId()!) as Channel | undefined
export const connected = (voiceChannel: Channel) => channelId() === voiceChannel.id
// as stock: you, connected from another client
export const elsewhere = (voiceState: VoiceState, voiceChannel: Channel) =>
  voiceState.userId === users.me()?.id && !connected(voiceChannel)

// RTCConnectionStore's state, as stock's panel says it (the steps without a name of their own are Connecting)
const STATES = {
  RTC_CONNECTED: 'CONNECTION_STATUS_VOICE_CONNECTED',
  NO_ROUTE: 'CONNECTION_STATUS_NO_ROUTE',
  DISCONNECTED: 'CONNECTION_STATUS_DISCONNECTED',
  RTC_DISCONNECTED: 'CONNECTION_STATUS_RTC_DISCONNECTED',
  AUTHENTICATING: 'CONNECTION_STATUS_AUTHENTICATING',
  RTC_CONNECTING: 'CONNECTION_STATUS_RTC_CONNECTING',
  ICE_CHECKING: 'CONNECTION_STATUS_ICE_CHECKING',
  DTLS_CONNECTING: 'CONNECTION_STATUS_DTLS_CONNECTING',
} as const
export const state = () => $.RTCConnection.getState()
export const stateText = () => text(STATES[state() as keyof typeof STATES] ?? 'CONNECTION_STATUS_CONNECTING')

// the server bar's badge on a server or a DM, as stock's: a stream, a camera, or someone in voice, green where you're
// connected (stock's events, stages and activities aren't shown)
export interface Activity {
  icon: 'screen' | 'video' | 'voice'
  connected: boolean
}
function activity(screen: boolean, video: boolean, voice: boolean, connected: boolean): Activity | undefined {
  if (screen) return { icon: 'screen', connected }
  if (video) return { icon: 'video', connected }
  if (voice) return { icon: 'voice', connected }
  return undefined
}
export function guildActivity(id: Id) {
  const media = $.GuildMediaState.getGuildMediaState(id)
  return activity(media.screenshare, media.video, media.audio, media.isCurrentUserConnected)
}
export function callActivity(voiceChannel: Channel) {
  const voiceStates = states(voiceChannel.id)
  return activity(
    $.ApplicationStreaming.getAllApplicationStreamsForChannel(voiceChannel.id).length > 0,
    voiceStates.some((voiceState) => voiceState.selfVideo),
    voiceStates.length > 0,
    connected(voiceChannel),
  )
}

export const join = (voiceChannel: Channel) => A.voice.selectVoiceChannel(voiceChannel.id)
export const leave = () => A.voice.disconnect()
