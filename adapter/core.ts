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

import { localStorage } from "@equicord/types/utils";
import { cache, filters, find, findModuleId, wreq } from "@equicord/types/webpack";
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
    // for the lab: whether a full search finds what was resolved
    searched?(): boolean;
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

// Module ids found on this Discord build. A search walks every loaded module (11k of them, 18 MB of code for the
// lookups by code string): ~86 ms for the needs below. With the ids from the last start, each need is verified in its
// own module instead, with the same test the search applies; a miss (or another build) searches again and rewrites them
const ID_CACHE = "mincord:needs";
let ids: Record<string, string> = {};
let idsChanged = false;
let cacheHits = 0;

function build(): string | null {
    const env = (window as any).GLOBAL_ENV;
    return env?.SENTRY_TAGS?.buildId ?? env?.BUILD_NUMBER ?? null;
}

function loadIds() {
    try {
        const saved = JSON.parse(localStorage.getItem(ID_CACHE) ?? "null");
        if (saved?.build && saved.build === build()) ids = saved.ids ?? {};
    } catch { }
}

function saveIds() {
    if (!idsChanged || !build()) return;
    try {
        localStorage.setItem(ID_CACHE, JSON.stringify({ build: build(), ids }));
    } catch { }
}

// find's test for one module: its exports, else each of their members
function inModule(id: string, filter: (m: any) => boolean) {
    const mod = cache[id as any];
    if (!mod?.loaded || mod.exports == null) return null;
    if (filter(mod.exports)) return mod.exports;
    if (typeof mod.exports !== "object") return null;
    for (const k in mod.exports) {
        const nested = mod.exports[k];
        if (nested && filter(nested)) return nested;
    }
    return null;
}

function moduleNeed<K extends keyof Actions>(
    key: K, what: string,
    search: () => [any, string] | null,
    at: (id: string) => any,
    members: string[] = []
) {
    const name = `A.${key}`;
    const complete = (m: any) => m != null && members.every(k => m[k] !== undefined);
    needs.push({
        name,
        what,
        resolve() {
            const known = ids[name];
            let m = known != null ? at(known) : null;
            if (complete(m)) {
                cacheHits++;
            } else {
                const found = search();
                m = found?.[0];
                if (found && m != null) {
                    if (ids[name] !== found[1]) idsChanged = true;
                    ids[name] = found[1];
                } else if (known != null) {
                    delete ids[name];
                    idsChanged = true;
                }
            }
            if (m == null) return "no module matches";
            const gone = members.filter(k => m[k] === undefined);
            if (gone.length) return `members gone: ${gone.join(", ")}`;
            A[key] = m;
            return null;
        },
        searched() {
            const m = search()?.[0];
            return members.length ? m != null && members.every(k => m[k] === A[key][k]) : m === A[key];
        }
    });
}

function byFilter<K extends keyof Actions>(key: K, what: string, filter: (m: any) => boolean) {
    moduleNeed(
        key, what,
        () => {
            const [m, id] = find(filter, { isIndirect: true, isWaitFor: true }) as [any, PropertyKey | null];
            return m == null ? null : [m, String(id)];
        },
        id => inModule(id, filter)
    );
}

function byProps<K extends keyof Actions>(key: K, ...props: (keyof Actions[K] & string)[]) {
    byFilter(key, `props ${props.join(", ")}`, filters.byProps(...props));
}

function byCode<K extends keyof Actions>(key: K, ...code: string[]) {
    byFilter(key, `code ${code.map(c => JSON.stringify(c)).join(" ")}`, filters.byCode(...code));
}

// a module whose exports are all minified: found by one code string in its factory, members by their own
function mangled<K extends keyof Actions>(key: K, anchor: string, members: Record<keyof Actions[K] & string, string>) {
    const names = Object.keys(members);
    const mappers = names.map(n => [n, filters.byCode(members[n])] as const);
    // as mapMangledModule does once it has the module
    const map = (id: string) => {
        const mod = wreq(id as any), out: Record<string, any> = {};
        for (const k of Object.keys(mod)) {
            const member = mod[k];
            const hit = mappers.find(([, f]) => f(member));
            if (hit) out[hit[0]] = member;
        }
        return out;
    };
    moduleNeed(
        key,
        `module ${JSON.stringify(anchor)} { ${names.join(", ")} }`,
        () => {
            const id = findModuleId(anchor);
            return id == null ? null : [map(id), id];
        },
        id => {
            const factory = wreq.m[id as any];
            return factory && Function.prototype.toString.call(factory).includes(anchor) ? map(id) : null;
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
    loadIds();
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
    saveIds();
    return results;
}

export function checkOk() {
    return check().every(r => r.ok);
}

// the lab's test of the id cache (lab/adapter.py): the needs a full search resolves differently
export function searchMismatches() {
    return needs.filter(n => n.searched && !n.searched()).map(n => n.name);
}

export function checkReport() {
    const r = check();
    return { ok: r.every(x => x.ok), at: Math.round(checkedAt), took: Math.round(took * 10) / 10, missing: r.filter(x => !x.ok), needs: r.length, cached: cacheHits };
}
