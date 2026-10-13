// The user panel: the account and its status picker, mute and deafen with their device menus, and the voice panel
// above it while connected (stock's selectVoiceChannel: Discord's own voice engine makes the call).

import { createSignal, For, Show } from 'solid-js'

import { A, S } from '../adapter/core'
import type { Rec } from '../adapter/discord'
import { url } from './channels'
import { nameOf } from './lib/model'
import { popAt } from './lib/popover'
import { $ } from './lib/store'

export const UserPanel = () => (
  <>
    <VoicePanel />
    <Me />
    <AudioButtons />
  </>
)

const STATUSES = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' } as Record<
  string,
  string
>

// the user panel, and its account popout with the status picker: a popover the panel opens, placed by CSS anchor
// positioning. A pick calls stock's status setter as its menu does (a synced setting)
// what you're doing, as stock words it under your name: Playing, Streaming, Listening to, Watching, Competing in
const VERBS = ['Playing', 'Streaming', 'Listening to', 'Watching', '', 'Competing in']

function Me() {
  const me = () => $.User.getCurrentUser()
  const status = () => $.SelfPresence.getStatus()
  const playing = () => {
    const a = $.LocalActivity.getPrimaryActivity()
    return a && a.type !== 4 && VERBS[a.type] ? `${VERBS[a.type]} ${a.name}` : undefined
  }
  let menu!: HTMLMenuElement
  const pick = (next: string) => {
    menu.hidePopover()
    const prevStatus = S.SelfPresence.getStatus()
    if (next !== prevStatus) A.setStatus({ nextStatus: next, prevStatus })
  }
  return (
    <>
      <button
        data-mc="me"
        popovertarget="mc-account"
        style={url(me()?.getAvatarURL(undefined, 64))}
        data-status={status()}
      >
        {nameOf(me())}
        <small>{playing() ?? STATUSES[status()] ?? status()}</small>
      </button>
      <menu ref={menu} id="mc-account" data-mc="account" popover>
        {Object.entries(STATUSES).map(([value, label]) => (
          <button
            data-status={value}
            data-mc={`status:${value}`}
            class={{ sel: status() === value }}
            onClick={() => pick(value)}
          >
            {label}
          </button>
        ))}
      </menu>
    </>
  )
}

const STATES: Record<string, string> = {
  RTC_CONNECTED: 'Voice Connected',
  NO_ROUTE: 'No Route',
  DISCONNECTED: 'Disconnected',
}

function VoicePanel() {
  const channel = () => $.Channel.getChannel($.RTCConnection.getChannelId()!)
  return (
    <Show when={channel()}>
      {(c) => (
        <footer data-mc="voice-panel" data-state={$.RTCConnection.getState()}>
          {STATES[$.RTCConnection.getState()] ?? 'Connecting…'}
          <small>
            {c().name} / {$.Guild.getGuild(c().guild_id)?.name}
          </small>
          <button data-mc="voice:settings" title="Voice Settings" popovertarget="mc-voice-settings" />
          <button data-mc="voice:disconnect" title="Disconnect" onClick={() => A.voice.disconnect()} />
          <VoiceSettings />
        </footer>
      )}
    </Show>
  )
}

// the voice settings (Liam's, in place of stock's noise suppression button): devices, volumes, input mode and
// sensitivity, and the audio processing, through stock's setters; MediaEngineStore keeps them on this client
function VoiceSettings() {
  const M = () => $.MediaEngine
  const options = (devices: Record<string, Rec>, current: string) =>
    Object.values(devices).map((d) => (
      <option value={d.id} selected={d.id === current} disabled={d.disabled}>
        {d.name}
      </option>
    ))
  const mode = (changes: Rec, next = M().getMode()) => A.audio.setMode(next, { ...M().getModeOptions(), ...changes })
  const check = (label: string, on: boolean, set: (on: boolean) => void) => (
    <label>
      <input type="checkbox" checked={on} onChange={(e) => set(e.currentTarget.checked)} />
      {label}
    </label>
  )
  return (
    <form id="mc-voice-settings" data-mc="voice-settings" popover onSubmit={(e) => e.preventDefault()}>
      <label>
        Input Device
        <select onChange={(e) => A.audio.setInputDevice(e.currentTarget.value)}>
          {options(M().getInputDevices(), M().getInputDeviceId())}
        </select>
      </label>
      <label>
        Output Device
        <select onChange={(e) => A.audio.setOutputDevice(e.currentTarget.value)}>
          {options(M().getOutputDevices(), M().getOutputDeviceId())}
        </select>
      </label>
      <label>
        Input Volume
        <input
          type="range"
          max={100}
          value={M().getInputVolume()}
          onInput={(e) => A.audio.setInputVolume(+e.currentTarget.value)}
        />
      </label>
      <label>
        Output Volume
        <input
          type="range"
          max={200}
          value={M().getOutputVolume()}
          onInput={(e) => A.audio.setOutputVolume(+e.currentTarget.value)}
        />
      </label>
      <fieldset>
        <legend>Input Mode</legend>
        {(
          [
            ['VOICE_ACTIVITY', 'Voice Activity'],
            ['PUSH_TO_TALK', 'Push to Talk'],
          ] as const
        ).map(([value, label]) => (
          <label>
            <input type="radio" name="mode" checked={M().getMode() === value} onChange={() => mode({}, value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <Show when={M().getMode() === 'VOICE_ACTIVITY'}>
        {check('Automatically determine input sensitivity', !!M().getModeOptions().autoThreshold, (on) =>
          mode({ autoThreshold: on }),
        )}
        <label>
          Input Sensitivity
          <input
            type="range"
            min={-100}
            max={0}
            value={M().getModeOptions().threshold}
            disabled={!!M().getModeOptions().autoThreshold}
            onChange={(e) => mode({ threshold: +e.currentTarget.value })}
          />
        </label>
      </Show>
      {check('Noise Suppression', M().getNoiseSuppression(), A.audio.setNoiseSuppression)}
      <Show when={M().isNoiseCancellationSupported()}>
        {check('Krisp', M().getNoiseCancellation(), A.audio.setNoiseCancellation)}
      </Show>
      {check('Echo Cancellation', M().getEchoCancellation(), A.audio.setEchoCancellation)}
      {check('Automatic Gain Control', M().getAutomaticGainControl(), A.audio.setAutomaticGainControl)}
    </form>
  )
}

// the user panel's mute and deafen, in or out of a call (stock's: a local setting, and the voice state while in one);
// a right click picks the input or the output device, as on stock's
function AudioButtons() {
  const [output, setOutput] = createSignal(false)
  let menu!: HTMLMenuElement
  const M = () => $.MediaEngine
  const devices = () => Object.values(output() ? M().getOutputDevices() : M().getInputDevices()) as Rec[]
  const current = () => (output() ? M().getOutputDeviceId() : M().getInputDeviceId())
  const pick = (out: boolean) => (e: MouseEvent) => {
    setOutput(out)
    popAt(menu, e)
  }
  return (
    <>
      <button
        data-mc="mute"
        title="Mute"
        class={{ on: M().isSelfMute() }}
        onClick={() => A.audio.toggleSelfMute()}
        onContextMenu={pick(false)}
      />
      <button
        data-mc="deafen"
        title="Deafen"
        class={{ on: M().isSelfDeaf() }}
        onClick={() => A.audio.toggleSelfDeaf()}
        onContextMenu={pick(true)}
      />
      <menu ref={menu} data-mc="devices" popover>
        <For each={devices()}>
          {(d) => (
            <button
              data-mc={`device:${d.id}`}
              class={{ sel: current() === d.id }}
              disabled={d.disabled}
              onClick={() => {
                menu.hidePopover()
                if (output()) A.audio.setOutputDevice(d.id)
                else A.audio.setInputDevice(d.id)
              }}
            >
              {d.name}
            </button>
          )}
        </For>
      </menu>
    </>
  )
}
