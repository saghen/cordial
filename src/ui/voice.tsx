// Voice: channel rows with who's in them, joining by a click (stock's selectVoiceChannel: Discord's own voice engine
// makes the call), and the panel above the user panel while connected.

import { createEffect, createSignal, For, Show } from "solid-js";

import { A } from "../adapter/core";
import type { Id, Rec } from "../adapter/discord";
import { popAt } from "./menu";
import { nameOf } from "./model";
import { $ } from "./store";

// as stock's voice rows: a server's voice channel statuses, once until a resume clears them (op 43)
export function useChannelInfo(guildId: () => Id | null) {
    createEffect(() => {
        const id = guildId();
        return id && $.GuildChannel.getChannels(id).VOCAL?.length && !$.ChannelStatus.hasRequestedStatuses(id) ? id : null;
    }, id => {
        if (id) A.channelInfo(id);
    });
}

export function VoiceRow(p: { channel: Rec; }) {
    const users = () => Object.values($.VoiceState.getVoiceStatesForChannel(p.channel.id)) as Rec[];
    return <>
        <a data-mc={`voice:${p.channel.id}`} class={{ voice: true, sel: $.RTCConnection.getChannelId() === p.channel.id }}
            onClick={() => A.voice.selectVoiceChannel(p.channel.id)}>
            {p.channel.name}<small>{$.ChannelStatus.getChannelStatus(p.channel)}</small>
        </a>
        <For each={users()}>{v => {
            const user = () => $.User.getUser(v.userId);
            return <a data-mc={`voice-user:${v.userId}`} style={{ "--icon": `url(${user()?.getAvatarURL(p.channel.guild_id, 32)})` }}
                class={{ speaking: $.Speaking.isSpeaking(v.userId), muted: v.selfMute || v.mute, deaf: v.selfDeaf || v.deaf }}>
                {nameOf(user(), $.GuildMember.getMember(p.channel.guild_id, v.userId)?.nick)}
            </a>;
        }}</For>
    </>;
}

const STATES: Record<string, string> = { RTC_CONNECTED: "Voice Connected", NO_ROUTE: "No Route", DISCONNECTED: "Disconnected" };

export function VoicePanel() {
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
export function AudioButtons() {
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
