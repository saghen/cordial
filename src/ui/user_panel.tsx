// The user panel: the account and its status picker, mute and deafen with their device menus, and the voice panel
// above it while connected (stock's selectVoiceChannel: Discord's own voice engine makes the call).

import { createSignal, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Rec } from "../adapter/discord";
import { url } from "./channels";
import { nameOf } from "./lib/model";
import { popAt } from "./lib/popover";
import { $ } from "./lib/store";

export const UserPanel = () => <>
    <VoicePanel />
    <Me />
    <AudioButtons />
</>;

const STATUSES = { online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible" } as Record<string, string>;

// the user panel, and its account popout with the status picker: a popover the panel opens, placed by CSS anchor
// positioning. A pick calls stock's status setter as its menu does (a synced setting)
function Me() {
    const me = () => $.User.getCurrentUser();
    const status = () => $.SelfPresence.getStatus();
    let menu!: HTMLMenuElement;
    const pick = (next: string) => {
        menu.hidePopover();
        const prevStatus = S.SelfPresence.getStatus();
        if (next !== prevStatus) A.setStatus({ nextStatus: next, prevStatus });
    };
    return <>
        <button data-mc="me" popovertarget="mc-account" style={url(me()?.getAvatarURL(undefined, 64))} data-status={status()}>
            {nameOf(me())}<small>{STATUSES[status()] ?? status()}</small>
        </button>
        <menu ref={menu} id="mc-account" data-mc="account" popover>
            {Object.entries(STATUSES).map(([value, label]) =>
                <button data-status={value} data-mc={`status:${value}`} class={{ sel: status() === value }} onClick={() => pick(value)}>{label}</button>)}
        </menu>
    </>;
}

const STATES: Record<string, string> = { RTC_CONNECTED: "Voice Connected", NO_ROUTE: "No Route", DISCONNECTED: "Disconnected" };

function VoicePanel() {
    const channel = () => $.Channel.getChannel($.RTCConnection.getChannelId()!);
    return <Show when={channel()}>{c =>
        <footer data-mc="voice-panel" data-state={$.RTCConnection.getState()}>
            {STATES[$.RTCConnection.getState()] ?? "Connecting…"}
            <small>{c().name} / {$.Guild.getGuild(c().guild_id)?.name}</small>
            <button data-mc="voice:disconnect" title="Disconnect" onClick={() => A.voice.disconnect()} />
        </footer>
    }</Show>;
}

// the user panel's mute and deafen, in or out of a call (stock's: a local setting, and the voice state while in one);
// a right click picks the input or the output device, as on stock's
function AudioButtons() {
    const [output, setOutput] = createSignal(false);
    let menu!: HTMLMenuElement;
    const M = () => $.MediaEngine;
    const devices = () => Object.values(output() ? M().getOutputDevices() : M().getInputDevices()) as Rec[];
    const current = () => output() ? M().getOutputDeviceId() : M().getInputDeviceId();
    const pick = (out: boolean) => (e: MouseEvent) => {
        setOutput(out);
        popAt(menu, e);
    };
    return <>
        <button data-mc="mute" title="Mute" class={{ on: M().isSelfMute() }} onClick={() => A.audio.toggleSelfMute()} onContextMenu={pick(false)} />
        <button data-mc="deafen" title="Deafen" class={{ on: M().isSelfDeaf() }} onClick={() => A.audio.toggleSelfDeaf()} onContextMenu={pick(true)} />
        <menu ref={menu} data-mc="devices" popover>
            <For each={devices()}>{d =>
                <button data-mc={`device:${d.id}`} class={{ sel: current() === d.id }} disabled={d.disabled} onClick={() => {
                    menu.hidePopover();
                    if (output()) A.audio.setOutputDevice(d.id);
                    else A.audio.setInputDevice(d.id);
                }}>{d.name}</button>
            }</For>
        </menu>
    </>;
}
