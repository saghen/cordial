// Voice: who's in a channel's voice (its voice states and their flags), your connection (its channel and its state, in
// stock's words), joining and leaving. Discord's own voice engine makes the call (stock's selectVoiceChannel).

import { A } from '../adapter/needs'
import type { Channel, Id, VoiceState } from './records'
import { $ } from './store'
import { text } from './strings'
import * as users from './users'

export const states = (channelId: Id) => Object.values($.VoiceState.getVoiceStatesForChannel(channelId)) as VoiceState[]
export const speaking = (userId: Id) => $.Speaking.isSpeaking(userId)
export const muted = (v: VoiceState) => v.selfMute || v.mute
export const deafened = (v: VoiceState) => v.selfDeaf || v.deaf
// muted or deafened by a moderator
export const forced = (v: VoiceState) => v.mute || v.deaf

// your connection: the channel you're in, and whether a channel is it
export const channelId = () => $.RTCConnection.getChannelId()
export const channel = () => $.Channel.getChannel(channelId()!) as Channel | undefined
export const connected = (c: Channel) => channelId() === c.id
// as stock: you, connected from another client
export const elsewhere = (v: VoiceState, c: Channel) => v.userId === users.me()?.id && !connected(c)

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
const activity = (screen: boolean, video: boolean, voice: boolean, connected: boolean): Activity | undefined =>
  screen || video || voice ? { icon: screen ? 'screen' : video ? 'video' : 'voice', connected } : undefined
export function guildActivity(id: Id) {
  const m = $.GuildMediaState.getGuildMediaState(id)
  return activity(m.screenshare, m.video, m.audio, m.isCurrentUserConnected)
}
export function callActivity(c: Channel) {
  const s = states(c.id)
  return activity(
    $.ApplicationStreaming.getAllApplicationStreamsForChannel(c.id).length > 0,
    s.some((v) => v.selfVideo),
    s.length > 0,
    connected(c),
  )
}

export const join = (c: Channel) => A.voice.selectVoiceChannel(c.id)
export const leave = () => A.voice.disconnect()
