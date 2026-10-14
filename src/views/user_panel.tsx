// The user panel: the account and its status picker, mute and deafen with their device menus, and the voice panel
// above it while connected: its status, the channel, the camera, Go Live, the soundboard, the voice settings and
// Disconnect.

import { createSignal, For, onCleanup, Show } from 'solid-js'

import * as screen from '../../screen-capture/src/renderer'

import * as audio from '../api/audio'
import * as channels from '../api/channels'
import * as guilds from '../api/guilds'
import type { Channel, PrivateChannel } from '../api/records'
import * as soundboard from '../api/soundboard'
import { text } from '../api/strings'
import * as streams from '../api/streams'
import * as users from '../api/users'
import * as voice from '../api/voice'
import { Avatar } from '../components/avatar'
import { Emoji } from '../components/emoji'
import { GuildIcon } from '../components/guild_icon'
import { Button, IconButton, Toggle } from '../primitives/button'
import { Check, Radios, Range, Select } from '../primitives/fields'
import { Icon } from '../primitives/icon'
import { contextMenu, Items } from '../primitives/menu'
import { modal } from '../primitives/modal'
import { Popout } from '../primitives/popout'
import { SearchInput } from '../primitives/search'
import { Sections } from '../primitives/sections'

export const UserPanel = () => (
  <>
    <VoicePanel />
    <Me />
    <AudioButtons />
  </>
)

// the account, with what you're doing (or your status) under your name; its popout picks the status
function Me() {
  const status = users.selfStatus
  return (
    <>
      <button class="user-panel" popovertarget="mc-account">
        <Show when={users.me()}>{(u) => <Avatar user={u()} size={32} status={status()} />}</Show>
        {users.nameOf(users.me())}
        <small>{users.activity() ?? (users.STATUSES[status()] ? text(users.STATUSES[status()]) : status())}</small>
      </button>
      <Popout name="account" class="account">
        <Items
          items={Object.entries(users.STATUSES).map(([value, label]) => ({
            name: 'set-status',
            id: value,
            label: text(label),
            status: value,
            class: { sel: status() === value },
            run: () => users.setStatus(value),
          }))}
        />
      </Popout>
    </>
  )
}

function VoicePanel() {
  // the voice settings open as a section above the panel's line
  const [settings, setSettings] = createSignal(false)
  return (
    <Show when={voice.channel()}>
      {(c) => (
        <footer class="voice-panel" data-state={voice.state()}>
          <Show when={settings()}>
            <VoiceSettings />
          </Show>
          <b>{voice.stateText()}</b>
          <small>
            {c().guild_id ? `${c().name} / ${guilds.get(c().guild_id!)?.name}` : channels.dmName(c() as PrivateChannel)}
          </small>
          <div class="voice-buttons">
            <Toggle
              class="voice-camera"
              on={audio.camera()}
              icon="video-slash"
              onIcon="video"
              title={text('CAMERA_ON')}
              onTitle={text('CAMERA_OFF')}
              onClick={audio.toggleCamera}
            />
            <Toggle
              class="voice-screen"
              on={streams.live()}
              icon="screen"
              onIcon="screen-x"
              title={text('SHARE_YOUR_SCREEN')}
              onTitle={text('STOP_STREAMING')}
              onClick={() => streams.toggleLive(c())}
            />
            <IconButton
              class="voice-soundboard"
              icon="soundboard"
              title={text('SOUNDBOARD_OPEN_SOUNDBOARD')}
              popovertarget="mc-soundboard"
            />
            <Toggle
              class="voice-settings-button"
              on={settings()}
              icon="settings"
              title={text('VOICE_SETTINGS')}
              onClick={() => setSettings((on) => !on)}
            />
            <IconButton class="voice-disconnect" icon="hangup" title={text('DISCONNECT_SELF')} onClick={voice.leave} />
          </div>
          <Soundboard channel={c()} />
          <ScreenPicker />
        </footer>
      )}
    </Show>
  )
}

// the soundboard: each server's sounds on Sections, with stock's search and a rail (stock's popout has neither), the
// ones you can't use greyed; a click plays one in the call
function Soundboard(p: { channel: Channel }) {
  const [query, setQuery] = createSignal('')
  const all = () => soundboard.sections(p.channel)
  return (
    <Popout name="soundboard" class="soundboard" onOpen={soundboard.fetch} onClose={() => setQuery('')}>
      <Sections
        search={
          <SearchInput
            class="sound-search"
            placeholder={text('SOUNDBOARD_SEARCH_PLACEHOLDER')}
            autofocus
            value={query()}
            onInput={setQuery}
          />
        }
        all={all()}
        shown={query() ? [{ id: 'results', name: '', items: soundboard.search(p.channel, query()) }] : all()}
        rail={(s) => (s.guild ? <GuildIcon guild={s.guild} size={24} /> : <Icon name="soundboard" />)}
        chunk={30}
        item={(sound) => (
          <button
            class={['sound', { on: soundboard.playing(sound) }]}
            data-id={sound.soundId}
            disabled={!soundboard.usable(sound, p.channel)}
            onClick={() => soundboard.play(sound, p.channel)}
          >
            <Show when={sound.emojiId} fallback={sound.emojiName}>
              <Emoji emoji={{ id: sound.emojiId, name: sound.emojiName ?? '' }} />
            </Show>
            {sound.name}
          </button>
        )}
      />
    </Popout>
  )
}

// the voice settings (Liam's, in place of stock's noise suppression button): devices, volumes, input mode and
// sensitivity, and the audio processing
function VoiceSettings() {
  const devices = (all: audio.Device[]) => all.map((d) => [d.id, d.name, d.disabled] as const)
  return (
    <form class="voice-settings" onSubmit={(e) => e.preventDefault()}>
      <Select
        label={text('FORM_LABEL_INPUT_DEVICE')}
        options={devices(audio.inputs())}
        value={audio.input()}
        onChange={audio.setInput}
      />
      <Select
        label={text('FORM_LABEL_OUTPUT_DEVICE')}
        options={devices(audio.outputs())}
        value={audio.output()}
        onChange={audio.setOutput}
      />
      <Range
        label={text('FORM_LABEL_INPUT_VOLUME')}
        max={100}
        value={audio.inputVolume()}
        onInput={audio.setInputVolume}
      />
      <Range
        label={text('FORM_LABEL_OUTPUT_VOLUME')}
        max={200}
        value={audio.outputVolume()}
        onInput={audio.setOutputVolume}
      />
      <Radios
        label={text('FORM_LABEL_INPUT_MODE')}
        name="mode"
        options={[
          ['VOICE_ACTIVITY', text('INPUT_MODE_VAD')],
          ['PUSH_TO_TALK', text('INPUT_MODE_PTT')],
        ]}
        value={audio.mode()}
        onChange={audio.setMode}
      />
      <Show when={audio.mode() === 'VOICE_ACTIVITY'}>
        <Check
          label={text('FORM_LABEL_AUTOMATIC_VAD')}
          checked={audio.autoThreshold()}
          onChange={audio.setAutoThreshold}
        />
        <Range
          label={text('FORM_LABEL_INPUT_SENSITIVTY')}
          min={-100}
          max={0}
          value={audio.threshold()}
          disabled={audio.autoThreshold()}
          onChange={audio.setThreshold}
        />
      </Show>
      <Check
        label={text('NOISE_SUPPRESSION')}
        checked={audio.noiseSuppression()}
        onChange={audio.setNoiseSuppression}
      />
      <Show when={audio.krispSupported()}>
        <Check label={text('KRISP')} checked={audio.krisp()} onChange={audio.setKrisp} />
      </Show>
      <Check
        label={text('ECHO_CANCELLATION')}
        checked={audio.echoCancellation()}
        onChange={audio.setEchoCancellation}
      />
      <Check label={text('AUTOMATIC_GAIN_CONTROL')} checked={audio.gainControl()} onChange={audio.setGainControl} />
    </form>
  )
}

// mute and deafen, in or out of a call; a right click picks the input or the output device, as on stock's
function AudioButtons() {
  const menu = contextMenu({
    class: 'devices',
    // the output's devices from deafen, the input's from mute
    find: (e) => ((e.target as Element).closest('.self-deafen') ? 'output' : 'input'),
    children: (kind) => {
      const output = () => kind() === 'output'
      return (
        <Items
          items={(output() ? audio.outputs() : audio.inputs()).map((d) => ({
            name: 'device',
            id: d.id,
            label: d.name,
            checked: (output() ? audio.output() : audio.input()) === d.id,
            disabled: d.disabled,
            run: () => (output() ? audio.setOutput(d.id) : audio.setInput(d.id)),
          }))}
        />
      )
    },
  })
  return (
    <>
      <Toggle
        class="self-mute"
        on={audio.selfMuted()}
        icon="mic"
        onIcon="mic-off"
        title={text('MUTE')}
        onTitle={text('UNMUTE')}
        onClick={audio.toggleMute}
        onContextMenu={menu.open}
      />
      <Toggle
        class="self-deafen"
        on={audio.selfDeafened()}
        icon="headphones"
        onIcon="deaf"
        title={text('DEAFEN')}
        onTitle={text('UNDEAFEN')}
        onClick={audio.toggleDeafen}
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
            <Button class={['source', s.kind]} data-id={s.id} onClick={() => pick(a(), s)}>
              {s.name}
              <small>
                {s.detail} · {s.width}×{s.height}
              </small>
            </Button>
          )}
        </For>
        <Select
          label="Priority"
          options={PRIORITIES}
          value={screen.settings.priority}
          onChange={(v) => (screen.settings.priority = v)}
        />
        <Button variant="link" class="screen-cancel" onClick={picker.close}>
          Cancel
        </Button>
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
