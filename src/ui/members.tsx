// The member list (stock's ChannelMemberStore: groups by hoisted role, online, offline), shown when stock's section
// state says MEMBERS. Discord fills the list only for the ranges a client subscribes to: as stock's list, ours asks
// for the rows in view (stock's own range helper) when it opens and as it scrolls.

import { createEffect, createMemo, For, Show } from "solid-js";

import { A, S } from "../adapter/core";
import type { Id, Rec } from "../adapter/discord";
import { nameOf } from "./model";
import { $ } from "./store";

const ROW = 44;

export const membersOpen = () => !!$.SelectedGuild.getGuildId() && $.ChannelSection.getSection($.SelectedChannel.getChannelId()!, false) === "MEMBERS";

export function Members() {
    let list!: HTMLElement;
    const ids = () => [$.SelectedGuild.getGuildId(), $.SelectedChannel.getChannelId()] as [Id, Id];
    const props = () => $.ChannelMember.getProps(...ids());
    // group rows carry no count: it's in groups
    const count = (id: string) => props().groups.find((g: Rec) => g.id === id)?.count;
    let frame = 0;
    const subscribe = () => frame ||= requestAnimationFrame(() => {
        frame = 0;
        const [guildId, channelId] = ids();
        A.memberSubscriptions.range({ guildId, channelId, y: list.scrollTop, height: list.clientHeight, rowHeight: ROW });
    });
    // a memo: the effect alone runs again on every store change, even with the same value
    const shown = createMemo(() => membersOpen() && ids().join());
    createEffect(shown, on => {
        if (on) subscribe();
    });

    return <Show when={membersOpen()}>
        <section ref={list} data-mc="members" onScroll={subscribe}>
            <For each={props().rows as (Rec | undefined)[]}>{r => r?.type === "GROUP"
                ? <h3>{r.title} — {count(r.id)}</h3>
                : <a data-mc={r && `member:${r.userId}`} data-status={r?.status} style={r && {
                    "--icon": `url(${r.user.getAvatarURL(r.guildId, 64)})`, color: r.colorString ?? undefined
                }}>{r && nameOf(r.user, r.nick)}</a>
            }</For>
        </section>
    </Show>;
}

export const MembersToggle = () => <Show when={$.SelectedGuild.getGuildId()}>
    <button data-mc="members-toggle" class={{ on: membersOpen() }} title="Member list"
        onClick={() => A.channelSections.toggleMembersSection()}>Members</button>
</Show>;
