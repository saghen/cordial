// DM calls: whether one is going, starting or joining one (stock's call), and the calls ringing for you, accepted or
// declined (stock's stopRinging).

import { A } from '../adapter/needs'
import * as channels from './channels'
import { ChannelType, type Channel, type Id, type PrivateChannel } from './types'
import { $ } from './store'
import * as users from './users'
import * as voice from './voice'

// a DM's call with someone in it (a call record can outlive its last participant)
const going = (channelId: Id) => Boolean($.Call.getCall(channelId)) && voice.states(channelId).length > 0

// what the call view shows: voice and stage channels, and DMs with a call going
export const callIn = (channel: Channel | undefined) =>
  channel &&
  (channel.type === ChannelType.Voice || channel.type === ChannelType.Stage || (!channel.guild_id && going(channel.id)))
    ? channel
    : undefined

// stock's DM header buttons: a voice or video call to the DM, ringing its recipients (a 1:1 DM's user), or into the
// call already going there (no ring)
export const start = (channel: PrivateChannel, video: boolean) =>
  A.calls.call(
    channel.id,
    video,
    !going(channel.id),
    channel.type === ChannelType.DM ? channel.recipients[0] : undefined,
  )
// below a call you're not in: join it, with or without the camera
export const join = (channel: Channel, video: boolean) => A.calls.call(channel.id, video, false)

// ringing for you: the DM, and who's calling
export interface Incoming {
  channel: Channel
  senderId: Id
}
export const incoming = () => $.IncomingCall.getIncomingCalls() as Incoming[]
export const caller = (call: Incoming) => users.get(call.senderId)
// Accept joins and opens the DM; Decline stops the ringing
export function accept(call: Incoming) {
  voice.join(call.channel)
  channels.open(call.channel)
}
export const decline = (call: Incoming) => A.calls.stopRinging(call.channel.id)
