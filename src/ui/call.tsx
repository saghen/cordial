// The call view: who's in the selected voice channel, or in the DM's call, as tiles above its messages (a voice
// channel's text chat), with Join while elsewhere; the DM header's call button; incoming calls with Accept and Decline.
// Discord's voice engine does the call (stock's selectVoiceChannel, call and stopRinging)

import { createEffect, createMemo, For, Show } from 'solid-js'

import { A, S } from '../adapter/core'
import type { Rec } from '../adapter/discord'
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
