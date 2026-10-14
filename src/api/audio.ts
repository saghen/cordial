// Your audio and camera: mute and deafen (a local setting, and the voice state while in a call), the camera, the
// devices, volumes, input mode and audio processing, through stock's setters. MediaEngineStore keeps them on this
// client.

import type { Rec } from '../adapter/discord'
import { A, S } from '../adapter/needs'
import { $ } from './store'

const M = () => $.MediaEngine

export const selfMuted = () => M().isSelfMute()
export const selfDeafened = () => M().isSelfDeaf()
export const toggleMute = () => A.audio.toggleSelfMute()
export const toggleDeafen = () => A.audio.toggleSelfDeaf()

export const camera = () => M().isVideoEnabled()
export const toggleCamera = () => A.audio.setVideoEnabled(!S.MediaEngine.isVideoEnabled())

// a device: its id, its name, whether it's unavailable
export interface Device {
  id: string
  name: string
  disabled: boolean
}
const list = (all: Record<string, Rec>) =>
  Object.values(all).map((d) => ({ id: d.id, name: d.name, disabled: !!d.disabled }) as Device)
export const inputs = () => list(M().getInputDevices())
export const outputs = () => list(M().getOutputDevices())
export const input = () => M().getInputDeviceId() as string
export const output = () => M().getOutputDeviceId() as string
export const setInput = (id: string) => A.audio.setInputDevice(id)
export const setOutput = (id: string) => A.audio.setOutputDevice(id)

// input 0-100, output 0-200
export const inputVolume = () => M().getInputVolume() as number
export const outputVolume = () => M().getOutputVolume() as number
export const setInputVolume = (v: number) => A.audio.setInputVolume(v)
export const setOutputVolume = (v: number) => A.audio.setOutputVolume(v)

// VOICE_ACTIVITY or PUSH_TO_TALK; voice activity's sensitivity, automatic or a threshold in dB (-100 to 0)
export const mode = () => M().getMode() as string
const modeOptions = () => M().getModeOptions() as { autoThreshold?: boolean; threshold: number }
export const autoThreshold = () => !!modeOptions().autoThreshold
export const threshold = () => modeOptions().threshold
const setModeWith = (changes: Rec, next = mode()) => A.audio.setMode(next, { ...modeOptions(), ...changes })
export const setMode = (next: string) => setModeWith({}, next)
export const setAutoThreshold = (on: boolean) => setModeWith({ autoThreshold: on })
export const setThreshold = (threshold: number) => setModeWith({ threshold })

export const noiseSuppression = () => M().getNoiseSuppression() as boolean
export const setNoiseSuppression = (on: boolean) => A.audio.setNoiseSuppression(on)
// Krisp, where the engine has it
export const krispSupported = () => M().isNoiseCancellationSupported() as boolean
export const krisp = () => M().getNoiseCancellation() as boolean
export const setKrisp = (on: boolean) => A.audio.setNoiseCancellation(on)
export const echoCancellation = () => M().getEchoCancellation() as boolean
export const setEchoCancellation = (on: boolean) => A.audio.setEchoCancellation(on)
export const gainControl = () => M().getAutomaticGainControl() as boolean
export const setGainControl = (on: boolean) => A.audio.setAutomaticGainControl(on)
