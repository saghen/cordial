// The shell: one grid (style.ts), one element per region and per list row.

import { createSignal, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Rec } from "../adapter/discord";
import { Channels, dmIcon, dmName, dmStatus, kindOf, url } from "./channels";
import { Chat } from "./chat";
import { warm } from "./lib/preload";
import { $, selected, selectedGuild } from "./lib/store";
import { MembersList, MembersToggle } from "./members";
import { MessageInput } from "./message_input";
import { ServerBar } from "./server_bar";
import { CSS } from "./style";
import { UserPanel } from "./user_panel";

// GatewayConnectionStore reads the socket and doesn't emit when it drops or comes back, so follow the actions (the
// socket's own state changes only after CONNECTION_INTERRUPTED)
function Connection() {
    const [connected, setConnected] = createSignal(S.Gateway.isConnected());
    let once = connected();
    const on = (type: string, now: boolean) => A.dispatcher.subscribe(type, () => {
        once ||= now;
        setConnected(now);
    });
    on("CONNECTION_OPEN", true);
    on("CONNECTION_RESUMED", true);
    on("CONNECTION_INTERRUPTED", false);
    on("CONNECTION_CLOSED", false);
    return <Show when={!connected()}>
        <p data-mc="notice">{!S.Gateway.isTryingToConnect() ? "Disconnected" : once ? "Reconnecting…" : "Connecting…"}</p>
    </Show>;
}

// stock's age gate, over the messages and the composer. Discord's core loads nothing behind it. Continue is for
// accounts Discord allows; for the rest stock's Confirm Age starts its age verification, which mincord leaves to Discord
function Gate(p: { channel: Rec; }) {
    const allowed = () => $.User.getCurrentUser()?.nsfwAllowed !== false;
    // stock's rule reads its stores itself: reading them through $ first subscribes to them
    const gated = () => {
        void $.GuildNSFWAgree, void $.Guild;
        return allowed() !== undefined && A.ageGate.gated(p.channel);
    };
    return <Show when={gated()}>
        <figure data-mc="gate">
            <h2>Age-Restricted Channel</h2>
            <p>This channel is for adults (18+) only.{allowed() ? "" : " Confirm your age in Discord to see it."}</p>
            <button data-mc="gate:back" onClick={() => A.guilds.nsfwReturnToSafety(p.channel.guild_id)}>Go Back</button>
            <Show when={allowed()}>
                <button data-mc="gate:continue" onClick={() => A.guilds.nsfwAgree(p.channel.guild_id)}>Continue</button>
            </Show>
        </figure>
    </Show>;
}

export function App(p: { root: HTMLElement; }) {
    const channel = () => $.Channel.getChannel(selected()!);
    warm();
    return <>
        <style>{CSS}</style>
        <Connection />
        <ServerBar />
        <h1>{selectedGuild() ? $.Guild.getGuild(selectedGuild()!)?.name : "Direct Messages"}</h1>
        <Channels />
        <UserPanel />
        <header style={channel()?.guild_id ? undefined : url(dmIcon(channel()))} data-status={channel()?.guild_id ? undefined : dmStatus(channel())}
            class={channel()?.guild_id ? ["channel", kindOf(channel()!)] : undefined}>
            <Show when={channel()}>{c => <>{c().guild_id ? c().name : dmName(c())}<small>{c().topic}</small></>}</Show>
            <MembersToggle />
        </header>
        <Chat root={p.root} />
        <MessageInput />
        <Show when={channel()?.guild_id && channel()}>{c => <Gate channel={c()} />}</Show>
        <MembersList />
    </>;
}
