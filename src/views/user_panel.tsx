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
import { IconButton, Toggle } from '../primitives/button'
import { modal } from '../primitives/modal'
import { Popout } from '../primitives/popout'
import { Check, Radios, Range, Select } from '../primitives/fields'

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
      <Popout name="account" class="account">
        <Items
          items={Object.entries(STATUSES).map(([value, label]) => ({
            name: 'status',
            label,
            status: value,
            checked: status() === value,
            run: () => pick(value),
          }))}
        />
      </Popout>
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
          <Toggle
            class="voice-camera"
            on={$.MediaEngine.isVideoEnabled()}
            icon="video-slash"
            onIcon="video"
            title="Turn On Camera"
            onTitle="Turn Off Camera"
            onClick={() => A.audio.setVideoEnabled(!S.MediaEngine.isVideoEnabled())}
          />
          <Toggle
            class="voice-screen"
            on={!!$.ApplicationStreaming.getCurrentUserActiveStream()}
            icon="screen"
            onIcon="screen-x"
            title="Share Your Screen"
            onTitle="Stop Streaming"
            onClick={() =>
              S.ApplicationStreaming.getCurrentUserActiveStream()
                ? A.streams.stopOwn(false)
                : A.goLive.start(c().guild_id ?? null, c().id, [])
            }
          />
          <IconButton
            class="voice-soundboard"
            icon="soundboard"
            title="Open Soundboard"
            popovertarget="mc-soundboard"
          />
          <Toggle
            class="voice-settings-button"
            on={settings()}
            icon="settings"
            title="Voice Settings"
            onClick={() => setSettings((on) => !on)}
          />
          <IconButton class="voice-disconnect" icon="hangup" title="Disconnect" onClick={() => A.voice.disconnect()} />
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
    <Popout name="soundboard" class="soundboard" onOpen={() => A.soundboardSounds.fetch()}>
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
    </Popout>
  )
}

// the voice settings (Liam's, in place of stock's noise suppression button): devices, volumes, input mode and
// sensitivity, and the audio processing, through stock's setters; MediaEngineStore keeps them on this client
function VoiceSettings() {
  const M = () => $.MediaEngine
  const devices = (all: Record<string, Rec>) =>
    Object.values(all).map((d) => [d.id as string, d.name as string, !!d.disabled] as const)
  const mode = (changes: Rec, next = M().getMode()) => A.audio.setMode(next, { ...M().getModeOptions(), ...changes })
  return (
    <form class="voice-settings" onSubmit={(e) => e.preventDefault()}>
      <Select
        label="Input Device"
        options={devices(M().getInputDevices())}
        value={M().getInputDeviceId()}
        onChange={A.audio.setInputDevice}
      />
      <Select
        label="Output Device"
        options={devices(M().getOutputDevices())}
        value={M().getOutputDeviceId()}
        onChange={A.audio.setOutputDevice}
      />
      <Range label="Input Volume" max={100} value={M().getInputVolume()} onInput={A.audio.setInputVolume} />
      <Range label="Output Volume" max={200} value={M().getOutputVolume()} onInput={A.audio.setOutputVolume} />
      <Radios
        label="Input Mode"
        name="mode"
        options={[
          ['VOICE_ACTIVITY', 'Voice Activity'],
          ['PUSH_TO_TALK', 'Push to Talk'],
        ]}
        value={M().getMode()}
        onChange={(value) => mode({}, value)}
      />
      <Show when={M().getMode() === 'VOICE_ACTIVITY'}>
        <Check
          label="Automatically determine input sensitivity"
          checked={!!M().getModeOptions().autoThreshold}
          onChange={(on) => mode({ autoThreshold: on })}
        />
        <Range
          label="Input Sensitivity"
          min={-100}
          max={0}
          value={M().getModeOptions().threshold}
          disabled={!!M().getModeOptions().autoThreshold}
          onChange={(threshold) => mode({ threshold })}
        />
      </Show>
      <Check label="Noise Suppression" checked={M().getNoiseSuppression()} onChange={A.audio.setNoiseSuppression} />
      <Show when={M().isNoiseCancellationSupported()}>
        <Check label="Krisp" checked={M().getNoiseCancellation()} onChange={A.audio.setNoiseCancellation} />
      </Show>
      <Check label="Echo Cancellation" checked={M().getEchoCancellation()} onChange={A.audio.setEchoCancellation} />
      <Check
        label="Automatic Gain Control"
        checked={M().getAutomaticGainControl()}
        onChange={A.audio.setAutomaticGainControl}
      />
    </form>
  )
}

// the user panel's mute and deafen, in or out of a call (stock's: a local setting, and the voice state while in one);
// a right click picks the input or the output device, as on stock's
function AudioButtons() {
  const M = () => $.MediaEngine
  const menu = contextMenu({
    class: 'devices',
    // the output's devices from deafen, the input's from mute
    find: (e) => ((e.target as Element).closest('.self-deafen') ? 'output' : 'input'),
    children: (kind) => {
      const output = () => kind() === 'output'
      const devices = () => Object.values(output() ? M().getOutputDevices() : M().getInputDevices()) as Rec[]
      const current = () => (output() ? M().getOutputDeviceId() : M().getInputDeviceId())
      return (
        <Items
          items={devices().map((d) => ({
            name: 'device',
            id: d.id,
            label: d.name,
            checked: current() === d.id,
            disabled: d.disabled,
            run: () => (output() ? A.audio.setOutputDevice(d.id) : A.audio.setInputDevice(d.id)),
          }))}
        />
      )
    },
  })
  return (
    <>
      <Toggle
        class="self-mute"
        on={M().isSelfMute()}
        icon="mic"
        onIcon="mic-off"
        title="Mute"
        onTitle="Unmute"
        onClick={() => A.audio.toggleSelfMute()}
        onContextMenu={menu.open}
      />
      <Toggle
        class="self-deafen"
        on={M().isSelfDeaf()}
        icon="headphones"
        onIcon="deaf"
        title="Deafen"
        onTitle="Undeafen"
        onClick={() => A.audio.toggleSelfDeaf()}
        onContextMenu={menu.open}
      />
      {menu.view}
    </>
  )
}

// Go Live's picker (screen-capture's host.pick), which stock's start asks for through getDisplayMedia: niri's outputs
// and windows, a click streams one; the priority is what to give up first when the encoder or network can't keep up
// (resolution and frame rate follow the source and what the account allows). Escape or Cancel declines, as Chromium's
// own picker
const PRIORITIES = [
  ['balanced', 'Balanced'],
  ['smoothness', 'Smoothness'],
  ['clarity', 'Clarity'],
] as const

function ScreenPicker() {
  type Ask = { sources: screen.CastSource[]; resolve: (p: screen.CastPick) => void; reject: (e: Error) => void }
  const picker = modal<Ask>({
    class: 'screen-picker',
    // closed without a pick (Escape, Cancel, the backdrop); after one, the promise is settled already
    onClose: (a) => a.reject(new Error('cancelled')),
    children: (a) => (
      <>
        <h2>Share Your Screen</h2>
        <For each={a().sources}>
          {(s) => (
            <button class={['source', s.kind]} data-id={s.id} onClick={() => pick(a(), s)}>
              {s.name}
              <small>
                {s.detail} · {s.width}×{s.height}
              </small>
            </button>
          )}
        </For>
        <Select
          label="Priority"
          options={PRIORITIES}
          value={screen.settings.priority}
          onChange={(v) => (screen.settings.priority = v)}
        />
        <button class="screen-cancel" onClick={picker.close}>
          Cancel
        </button>
      </>
    ),
  })
  screen.host.pick = (sources) => new Promise((resolve, reject) => picker.open({ sources, resolve, reject }))
  onCleanup(() => (screen.host.pick = null))
  const pick = (a: Ask, s: screen.CastSource) => {
    a.resolve({
      source: s.id,
      name: s.name,
      width: s.width,
      height: s.height,
      priority: screen.settings.priority,
      codec: screen.settings.codec,
    })
    picker.close()
  }
  return picker.view
}
