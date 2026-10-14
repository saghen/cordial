// Your audio and camera: mute and deafen (a local setting, and the voice state while in a call), the camera, the
// devices, volumes, input mode and audio processing, through stock's setters. MediaEngineStore keeps them per client.

import type { AnyRecord } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import { $ } from './store'

const mediaEngine = () => $.MediaEngine

export const selfMuted = () => mediaEngine().isSelfMute()
export const selfDeafened = () => mediaEngine().isSelfDeaf()
export const toggleMute = () => A.audio.toggleSelfMute()
export const toggleDeafen = () => A.audio.toggleSelfDeaf()

export const camera = () => mediaEngine().isVideoEnabled()
export const toggleCamera = () => A.audio.setVideoEnabled(!S.MediaEngine.isVideoEnabled())

// a device: its id, its name, whether it's unavailable
export interface Device {
  id: string
  name: string
  disabled: boolean
}
const list = (all: Record<string, AnyRecord>) =>
  Object.values(all).map(
    (device) => ({ id: device.id, name: device.name, disabled: Boolean(device.disabled) }) as Device,
  )
export const inputs = () => list(mediaEngine().getInputDevices())
export const outputs = () => list(mediaEngine().getOutputDevices())
export const input = () => mediaEngine().getInputDeviceId() as string
export const output = () => mediaEngine().getOutputDeviceId() as string
export const setInput = (id: string) => A.audio.setInputDevice(id)
export const setOutput = (id: string) => A.audio.setOutputDevice(id)

// input 0-100, output 0-200
export const inputVolume = () => mediaEngine().getInputVolume() as number
export const outputVolume = () => mediaEngine().getOutputVolume() as number
export const setInputVolume = (volume: number) => A.audio.setInputVolume(volume)
export const setOutputVolume = (volume: number) => A.audio.setOutputVolume(volume)

// VOICE_ACTIVITY or PUSH_TO_TALK; voice activity's sensitivity, automatic or a threshold in dB (-100 to 0)
export const mode = () => mediaEngine().getMode() as string
const modeOptions = () => mediaEngine().getModeOptions() as { autoThreshold?: boolean; threshold: number }
export const autoThreshold = () => Boolean(modeOptions().autoThreshold)
export const threshold = () => modeOptions().threshold
const setModeWith = (changes: AnyRecord, next = mode()) => A.audio.setMode(next, { ...modeOptions(), ...changes })
export const setMode = (next: string) => setModeWith({}, next)
export const setAutoThreshold = (on: boolean) => setModeWith({ autoThreshold: on })
export const setThreshold = (threshold: number) => setModeWith({ threshold })

export const noiseSuppression = () => mediaEngine().getNoiseSuppression() as boolean
export const setNoiseSuppression = (on: boolean) => A.audio.setNoiseSuppression(on)
// Krisp, where the engine has it
export const krispSupported = () => mediaEngine().isNoiseCancellationSupported() as boolean
export const krisp = () => mediaEngine().getNoiseCancellation() as boolean
export const setKrisp = (on: boolean) => A.audio.setNoiseCancellation(on)
export const echoCancellation = () => mediaEngine().getEchoCancellation() as boolean
export const setEchoCancellation = (on: boolean) => A.audio.setEchoCancellation(on)
export const gainControl = () => mediaEngine().getAutomaticGainControl() as boolean
export const setGainControl = (on: boolean) => A.audio.setAutomaticGainControl(on)
