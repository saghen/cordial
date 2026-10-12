/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Everything the renderer uses from Discord, declared once as a list of needs and resolved before our root mounts:
//   stores by name, with the methods we call on them;
//   action creators by props or by code strings (minified names change every build, these don't);
//   action types we dispatch ourselves, which some store must still handle.
// The self-check resolves the whole list. If a required need is missing, the anchor shows Discord's own UI instead
// and the console names each missing need, so a Discord update degrades to stock instead of to a broken client.
// After that, S and A are plain objects: no lookups or proxies on the renderer's hot paths.

import { filters, find, mapMangledModule } from "@equicord/types/webpack";
import { Flux, FluxDispatcher } from "@equicord/types/webpack/common";

import type { Actions, Stores } from "./discord";

export const S = {} as Stores;
export const A = {} as Actions;

export interface NeedResult {
    name: string;
    what: string;
    ok: boolean;
    why?: string;
}

interface Need {
    name: string;
    what: string;
    // returns why it failed, or null
    resolve(): string | null;
}

const needs: Need[] = [];

function storeNeed<K extends keyof Stores>(key: K, name: string, ...methods: (keyof Stores[K] & string)[]) {
    needs.push({
        name: `S.${key}`,
        what: `${name} { ${methods.join(", ")} }`,
        resolve() {
            const s: any = (Flux.Store as any).getAll().find((s: any) => s.getName() === name);
            if (!s) return "no store by that name";
            const gone = methods.filter(m => typeof s[m] !== "function");
            if (gone.length) return `methods gone: ${gone.join(", ")}`;
            S[key] = s;
            return null;
        }
    });
}

function moduleNeed<K extends keyof Actions>(key: K, what: string, get: () => any, members: string[] = []) {
    needs.push({
        name: `A.${key}`,
        what,
        resolve() {
            const m = get();
            if (m == null) return "no module matches";
            const gone = members.filter(k => m[k] === undefined);
            if (gone.length) return `members gone: ${gone.join(", ")}`;
            A[key] = m;
            return null;
        }
    });
}

function byProps<K extends keyof Actions>(key: K, ...props: (keyof Actions[K] & string)[]) {
    moduleNeed(key, `props ${props.join(", ")}`, () => find(filters.byProps(...props), { isIndirect: true }));
}

function byCode<K extends keyof Actions>(key: K, ...code: string[]) {
    moduleNeed(key, `code ${code.map(c => JSON.stringify(c)).join(" ")}`, () => find(filters.byCode(...code), { isIndirect: true }));
}

// a module whose exports are all minified: found by one code string, members by their own
function mangled<K extends keyof Actions>(key: K, anchor: string, members: Record<keyof Actions[K] & string, string>) {
    const names = Object.keys(members);
    moduleNeed(
        key,
        `module ${JSON.stringify(anchor)} { ${names.join(", ")} }`,
        () => {
            const m = mapMangledModule(anchor, Object.fromEntries(names.map(n => [n, filters.byCode(members[n])])));
            return Object.keys(m).length ? m : null;
        },
        names
    );
}

// an action type we dispatch ourselves (the UI's action creator for it isn't loaded without the UI)
function dispatched(type: string, why: string) {
    needs.push({
        name: `dispatch ${type}`,
        what: why,
        resolve() {
            const tokens = (FluxDispatcher as any)._actionHandlers?._tokensByActionType?.[type];
            return tokens?.length ? null : "no store handles it";
        }
    });
}

// ---- the needs ----

storeNeed("Gateway", "GatewayConnectionStore", "isConnected", "isTryingToConnect");
storeNeed("Auth", "AuthenticationStore", "getId", "isAuthenticated");
storeNeed("User", "UserStore", "getCurrentUser", "getUser");
storeNeed("Guild", "GuildStore", "getGuild", "getGuilds");
storeNeed("SortedGuild", "SortedGuildStore", "getGuildFolders", "getFlattenedGuildIds");
storeNeed("Channel", "ChannelStore", "getChannel");
storeNeed("GuildChannel", "GuildChannelStore", "getChannels");
storeNeed("PrivateChannelSort", "PrivateChannelSortStore", "getPrivateChannelIds", "getSortedChannels");
storeNeed("SelectedGuild", "SelectedGuildStore", "getGuildId");
storeNeed("SelectedChannel", "SelectedChannelStore", "getChannelId");
storeNeed("Message", "MessageStore", "getMessages", "isReady", "whenReady");
storeNeed("ReadState", "ReadStateStore", "hasUnread", "getMentionCount", "getOldestUnreadMessageId", "ackMessageId");
storeNeed("GuildReadState", "GuildReadStateStore", "hasUnread", "getMentionCount", "getPrivateChannelMentionCount");
storeNeed("PrivateChannelReadState", "PrivateChannelReadStateStore", "getUnreadPrivateChannelIds");
storeNeed("Presence", "PresenceStore", "getStatus");
storeNeed("Relationship", "RelationshipStore", "getFriendIDs");
storeNeed("Permission", "PermissionStore", "can");
storeNeed("UserGuildSettings", "UserGuildSettingsStore", "isMuted", "isChannelMuted");
storeNeed("Typing", "TypingStore", "getTypingUsers");
storeNeed("GuildMember", "GuildMemberStore", "getMember");
storeNeed("Draft", "DraftStore", "getDraft");
storeNeed("EditMessage", "EditMessageStore", "isEditing", "getEditingTextValue", "getEditingMessageId");
storeNeed("Slowmode", "SlowmodeStore", "getSlowmodeCooldownGuess");
storeNeed("CategoryCollapse", "CategoryCollapseStore", "isCollapsed");
storeNeed("SelfPresence", "SelfPresenceStore", "getStatus");

byProps("messages", "sendMessage", "editMessage", "deleteMessage", "fetchMessages", "jumpToPresent", "jumpToMessage",
    "startEditMessage", "updateEditMessage", "endEditMessage");
byProps("parser", "parse", "parsePreprocessor", "unparse");
byProps("drafts", "saveDraft", "changeDraft", "clearDraft");
byCode("setStatus", "nextStatus:", "statusExpiresAtMs=");
byCode("ack", 'type:"CHANNEL_ACK",channelId:', "immediate:", "location:");
byProps("channels", "selectChannel", "selectPrivateChannel");
byProps("guilds", "selectGuild");
mangled("nav", "transitionTo - Transitioning to", {
    transitionTo: "transitionTo -",
    transitionToGuild: "transitionToGuild -",
    replaceWith: "Replacing route with",
    back: "goBack()"
});
mangled("pages", "windowSize().height-145", { size: ".getSetting()," });
byProps("markdown", "parseToAST", "parse", "astParserFor", "defaultRules");

dispatched("TYPING_START_LOCAL", "typing: TypingStore throttles and POSTs /typing");
dispatched("TYPING_STOP_LOCAL", "typing stops when the composer empties");
dispatched("PRESENCE_SUBSCRIPTIONS_ADD", "presence of users on screen (stock adds them from a useEffect)");
dispatched("ENABLE_AUTOMATIC_ACK", "acks: ReadStateStore acks the shown channel while it's at the bottom");
dispatched("DISABLE_AUTOMATIC_ACK", "acks stop when the list leaves a channel");
needs.push({
    name: "window id",
    what: "window.__DISCORD_WINDOW_ID, the window acks are enabled for",
    resolve: () => typeof (window as any).__DISCORD_WINDOW_ID === "string" ? null : "not set"
});

// ---- the check ----

let results: NeedResult[] | null = null;
let checkedAt = 0;
let took = 0;

export function check(): NeedResult[] {
    if (results) return results;
    checkedAt = performance.now();
    results = needs.map(n => {
        let why: string | null;
        try {
            why = n.resolve();
        } catch (e) {
            why = `threw: ${e}`;
        }
        return why ? { name: n.name, what: n.what, ok: false, why } : { name: n.name, what: n.what, ok: true };
    });
    took = performance.now() - checkedAt;
    return results;
}

export function checkOk() {
    return check().every(r => r.ok);
}

export function checkReport() {
    const r = check();
    return { ok: r.every(x => x.ok), at: Math.round(checkedAt), took: Math.round(took * 10) / 10, missing: r.filter(x => !x.ok), needs: r.length };
}
