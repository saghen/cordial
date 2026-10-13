// The user panel: the account and its status picker, mute and deafen with their device menus, and the voice panel
// above it while connected (stock's selectVoiceChannel: Discord's own voice engine makes the call).

import { createSignal, For, onCleanup, Show } from 'solid-js'

import * as screen from '../../screen-capture/src/renderer'

import { A, S } from '../adapter/needs'
import type { Rec } from '../adapter/discord'
import { dmName, url } from './channels'
import { emojiSrc, nameOf } from '../api/model'
import { contextMenu, Items } from '../primitives/menu'
import { $ } from '../api/store'

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
  const pick = (next: string) => {
    const prevStatus = S.SelfPresence.getStatus()
    if (next !== prevStatus) A.setStatus({ nextStatus: next, prevStatus })
  }
  return (
    <>
      <button
        class="user-panel"
        popovertarget="mc-account"
        style={url(me()?.getAvatarURL(undefined, 64))}
        data-status={status()}
      >
        {nameOf(me())}
        <small>{playing() ?? STATUSES[status()] ?? status()}</small>
      </button>
      <menu id="mc-account" class="account" popover>
        <Items
          items={Object.entries(STATUSES).map(([value, label]) => ({
            name: 'status',
            label,
            status: value,
            class: { sel: status() === value },
            run: () => pick(value),
          }))}
        />
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
  // the voice settings open as a section above the panel's line
  const [settings, setSettings] = createSignal(false)
  return (
    <Show when={channel()}>
      {(c) => (
        <footer class="voice-panel" data-state={$.RTCConnection.getState()}>
          <Show when={settings()}>
            <VoiceSettings />
          </Show>
          <b>{STATES[$.RTCConnection.getState()] ?? 'Connecting…'}</b>
          <small>{c().guild_id ? `${c().name} / ${$.Guild.getGuild(c().guild_id)?.name}` : dmName(c())}</small>
          <button
            class={['voice-camera', { on: $.MediaEngine.isVideoEnabled() }]}
            title={$.MediaEngine.isVideoEnabled() ? 'Turn Off Camera' : 'Turn On Camera'}
            onClick={() => A.audio.setVideoEnabled(!S.MediaEngine.isVideoEnabled())}
          />
          <button
            class={['voice-screen', { on: !!$.ApplicationStreaming.getCurrentUserActiveStream() }]}
            title={$.ApplicationStreaming.getCurrentUserActiveStream() ? 'Stop Streaming' : 'Share Your Screen'}
            onClick={() =>
              S.ApplicationStreaming.getCurrentUserActiveStream()
                ? A.streams.stopOwn(false)
                : A.goLive.start(c().guild_id ?? null, c().id, [])
            }
          />
          <button class="voice-soundboard" title="Open Soundboard" popovertarget="mc-soundboard" />
          <button
            class={['voice-settings-button', { on: settings() }]}
            title="Voice Settings"
            onClick={() => setSettings((on) => !on)}
          />
          <button class="voice-disconnect" title="Disconnect" onClick={() => A.voice.disconnect()} />
          <Soundboard channel={c()} />
          <ScreenPicker />
        </footer>
      )}
    </Show>
  )
}

// the soundboard, as stock's: the sounds of this server, the others' and Discord's, the ones you can't use greyed (stock's
// rule: Nitro for other servers' sounds); a click plays it in the call, unless you're muted. The sounds load on open
function Soundboard(p: { channel: Rec }) {
  const sections = () => {
    const all = $.Soundboard.getSounds(),
      here = p.channel.guild_id
    const ids = [here, ...[...all.keys()].filter((id) => id !== here && id !== '0'), '0']
    return ids
      .filter((id) => all.get(id)?.length)
      .map((id) => [id === '0' ? 'Default' : $.Guild.getGuild(id)?.name, all.get(id)!] as const)
  }
  const usable = (sound: Rec) => A.soundboard.canUse(S.User.getCurrentUser(), sound, p.channel, true)
  return (
    <menu
      id="mc-soundboard"
      class="soundboard"
      popover
      onToggle={(e) => e.newState === 'open' && A.soundboardSounds.fetch()}
    >
      <For each={sections()}>
        {([name, sounds]) => (
          <>
            <h3>{name}</h3>
            <p>
              <For each={sounds}>
                {(sound) => (
                  <button
                    class={['sound', { on: $.Soundboard.isPlayingSound(sound.soundId) }]}
                    data-id={sound.soundId}
                    disabled={!usable(sound)}
                    onClick={() => A.soundboard.canPlay(p.channel) && A.soundboard.play(sound, p.channel.id, [])}
                  >
                    <Show when={sound.emojiId} fallback={sound.emojiName}>
                      <img alt="" src={emojiSrc({ id: sound.emojiId })} />
                    </Show>
                    {sound.name}
                  </button>
                )}
              </For>
            </p>
          </>
        )}
      </For>
    </menu>
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
    <form class="voice-settings" onSubmit={(e) => e.preventDefault()}>
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
  const menu = contextMenu((e) => !!(e.target as Element).closest('.self-deafen'))
  const M = () => $.MediaEngine
  const output = () => !!menu.target()
  const devices = () => Object.values(output() ? M().getOutputDevices() : M().getInputDevices()) as Rec[]
  const current = () => (output() ? M().getOutputDeviceId() : M().getInputDeviceId())
  return (
    <>
      <button
        class={['self-mute', { on: M().isSelfMute() }]}
        title="Mute"
        onClick={() => A.audio.toggleSelfMute()}
        onContextMenu={menu.open}
      />
      <button
        class={['self-deafen', { on: M().isSelfDeaf() }]}
        title="Deafen"
        onClick={() => A.audio.toggleSelfDeaf()}
        onContextMenu={menu.open}
      />
      <menu ref={menu.ref} class="devices" popover>
        <Items
          items={devices().map((d) => ({
            name: 'device',
            id: d.id,
            label: d.name,
            class: { sel: current() === d.id },
            disabled: d.disabled,
            run: () => (output() ? A.audio.setOutputDevice(d.id) : A.audio.setInputDevice(d.id)),
          }))}
        />
      </menu>
    </>
  )
}

// Go Live's picker (screen-capture's host.pick), which stock's start asks for through getDisplayMedia: niri's outputs
// and windows, a click streams one; the priority is what to give up first when the encoder or network can't keep up
// (resolution and frame rate follow the source and what the account allows). Escape or Cancel declines, as Chromium's
// own picker
const PRIORITIES = { balanced: 'Balanced', smoothness: 'Smoothness', clarity: 'Clarity' }

function ScreenPicker() {
  type Ask = { sources: screen.CastSource[]; resolve: (p: screen.CastPick) => void; reject: (e: Error) => void }
  const [ask, setAsk] = createSignal<Ask>()
  let dialog!: HTMLDialogElement
  screen.host.pick = (sources) =>
    new Promise((resolve, reject) => {
      setAsk({ sources, resolve, reject })
      dialog.showModal()
    })
  onCleanup(() => (screen.host.pick = null))
  const pick = (s: screen.CastSource) => {
    const a = ask()!
    setAsk()
    dialog.close()
    a.resolve({
      source: s.id,
      name: s.name,
      width: s.width,
      height: s.height,
      priority: screen.settings.priority,
      codec: screen.settings.codec,
    })
  }
  return (
    <dialog
      ref={dialog}
      class="screen-picker"
      // closed without a pick (Escape, Cancel)
      onClose={() => {
        ask()?.reject(new Error('cancelled'))
        setAsk()
      }}
    >
      <h2>Share Your Screen</h2>
      <For each={ask()?.sources}>
        {(s) => (
          <button class={['source', s.kind]} data-id={s.id} onClick={() => pick(s)}>
            {s.name}
            <small>
              {s.detail} · {s.width}×{s.height}
            </small>
          </button>
        )}
      </For>
      <label>
        Priority
        <select onChange={(e) => (screen.settings.priority = e.currentTarget.value as keyof typeof PRIORITIES)}>
          <For each={Object.entries(PRIORITIES)}>
            {([v, label]) => (
              <option value={v} selected={v === screen.settings.priority}>
                {label}
              </option>
            )}
          </For>
        </select>
      </label>
      <button class="screen-cancel" onClick={() => dialog.close()}>
        Cancel
      </button>
    </dialog>
  )
}
