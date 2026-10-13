// Everything the renderer uses from Discord, as a list of needs resolved at the App's first render: stores by name,
// action creators by props or code strings (minified names change every build, these don't), and action types we
// dispatch ourselves. If one is missing, the anchor shows Discord's own UI and the console names it.

import type { Actions, Stores } from "./discord";
import { byCode as hasCode, byProps as hasProps, find, findModuleId, wreq } from "./webpack";

export const S = {} as Stores;
export const A = {} as Actions;

interface Need {
    name: string;
    what: string;
    // why it failed, or null
    resolve(): string | null;
}

const needs: Need[] = [];

function storeNeed<K extends keyof Stores>(key: K, name: string, ...methods: (keyof Stores[K] & string)[]) {
    needs.push({
        name: `S.${key}`,
        what: `${name} { ${methods.join(", ")} }`,
        resolve() {
            const s: any = A.flux.Store.getAll().find(s => s.getName() === name);
            if (!s) return "no store by that name";
            const gone = methods.filter(m => typeof s[m] !== "function");
            if (gone.length) return `methods gone: ${gone.join(", ")}`;
            S[key] = s;
            return null;
        }
    });
}

function moduleNeed<K extends keyof Actions>(key: K, what: string, search: () => any) {
    needs.push({
        name: `A.${key}`,
        what,
        resolve() {
            const m = search();
            if (m == null) return "no module matches";
            A[key] = m;
            return null;
        }
    });
}

const byProps = <K extends keyof Actions>(key: K, ...props: (keyof Actions[K] & string)[]) =>
    moduleNeed(key, `props ${props.join(", ")}`, () => find(hasProps(...props))?.[0]);

const byCode = <K extends keyof Actions>(key: K, ...code: string[]) =>
    moduleNeed(key, `code ${code.map(c => JSON.stringify(c)).join(" ")}`, () => find(hasCode(...code))?.[0]);

// a module whose exports are all minified: found by one code string in its factory, members by their own
function mangled<K extends keyof Actions>(key: K, anchor: string, members: Record<keyof Actions[K] & string, string>) {
    moduleNeed(key, `module ${JSON.stringify(anchor)} { ${Object.keys(members).join(", ")} }`, () => {
        const id = findModuleId(anchor);
        if (id == null) return null;
        const mod = wreq(id), out: Record<string, any> = {};
        for (const [name, code] of Object.entries(members)) {
            const member = Object.values(mod).find(hasCode(code as string));
            if (member === undefined) return null;
            out[name] = member;
        }
        return out;
    });
}

// an action type we dispatch ourselves: some store must still handle it
function dispatched(type: string, why: string) {
    needs.push({
        name: `dispatch ${type}`,
        what: why,
        resolve: () => A.dispatcher._actionHandlers?._tokensByActionType?.[type]?.length ? null : "no store handles it"
    });
}

// first: the store needs look stores up through Flux, the dispatch needs through the dispatcher
byProps("dispatcher", "dispatch", "subscribe", "_actionHandlers");
byProps("flux", "connectStores", "Store");
byProps("react", "createElement", "useEffect");

storeNeed("Gateway", "GatewayConnectionStore", "isConnected", "isTryingToConnect");
storeNeed("Auth", "AuthenticationStore", "isAuthenticated");
storeNeed("User", "UserStore", "getCurrentUser", "getUser");
storeNeed("Guild", "GuildStore", "getGuild");
storeNeed("SortedGuild", "SortedGuildStore", "getFlattenedGuildIds");
storeNeed("Channel", "ChannelStore", "getChannel");
storeNeed("GuildChannel", "GuildChannelStore", "getChannels");
storeNeed("PrivateChannelSort", "PrivateChannelSortStore", "getSortedChannels");
storeNeed("SelectedGuild", "SelectedGuildStore", "getGuildId");
storeNeed("SelectedChannel", "SelectedChannelStore", "getChannelId");
storeNeed("Message", "MessageStore", "getMessages", "getMessage", "getLastEditableMessage");
storeNeed("ReadState", "ReadStateStore", "hasUnread", "getMentionCount", "getOldestUnreadMessageId");
storeNeed("GuildReadState", "GuildReadStateStore", "hasUnread", "getMentionCount", "getPrivateChannelMentionCount");
storeNeed("PrivateChannelReadState", "PrivateChannelReadStateStore", "getUnreadPrivateChannelIds");
storeNeed("Presence", "PresenceStore", "getStatus");
storeNeed("Permission", "PermissionStore", "can");
storeNeed("UserGuildSettings", "UserGuildSettingsStore", "isMuted", "isChannelMuted");
storeNeed("GuildMember", "GuildMemberStore", "getMember");
storeNeed("Draft", "DraftStore", "getDraft");
storeNeed("EditMessage", "EditMessageStore", "getEditingTextValue", "getEditingMessageId");
storeNeed("CategoryCollapse", "CategoryCollapseStore", "isCollapsed");
storeNeed("PendingReply", "PendingReplyStore", "getPendingReply");
storeNeed("ReferencedMessage", "ReferencedMessageStore", "getMessageByReference");
storeNeed("MessageReactions", "MessageReactionsStore", "getReactions");
storeNeed("Emoji", "EmojiStore", "searchWithoutFetchingLatest");
storeNeed("UploadAttachment", "UploadAttachmentStore", "getUploads");
storeNeed("SelfPresence", "SelfPresenceStore", "getStatus");
storeNeed("DefaultRoute", "DefaultRouteStore");
needs.push({
    name: "S.DefaultRoute.defaultRoute",
    what: "DefaultRouteStore.defaultRoute, where stock's /app route redirects",
    resolve: () => typeof S.DefaultRoute?.defaultRoute === "string" ? null : "not a path"
});

byProps("messages", "sendMessage", "editMessage", "deleteMessage", "fetchMessages", "getSendMessageOptionsForReply",
    "startEditMessageRecord", "updateEditMessage", "endEditMessage");
byProps("parser", "parse", "unparse");
byProps("drafts", "saveDraft", "changeDraft");
byProps("uploads", "addFiles", "remove", "clearAll");
// stock's file chooser handler: size and count limits, then the files staged in UploadAttachmentStore
mangled("promptToUpload", "Unexpected mismatch between files and file metadata", { prompt: "requireConfirm" });
byCode("setStatus", "nextStatus:", "statusExpiresAtMs=");
mangled("nav", "transitionTo - Transitioning to", {
    transitionTo: "transitionTo -",
    transitionToGuild: "transitionToGuild -",
    replaceWith: "Replacing route with"
});
mangled("replies", 'type:"CREATE_PENDING_REPLY"', {
    create: 'type:"CREATE_PENDING_REPLY"',
    remove: 'type:"DELETE_PENDING_REPLY"',
    mention: 'type:"SET_PENDING_REPLY_SHOULD_MENTION"'
});
mangled("reactions", "REMOVE_EMOJI_REACTIONS(", {
    add: "userHasReactedWithEmoji(",
    remove: '??"@me"'
});
mangled("pages", "windowSize().height-145", { size: ".getSetting()," });
byProps("markdown", "parseToAST");

dispatched("TYPING_START_LOCAL", "typing: TypingStore throttles and POSTs /typing");
dispatched("TYPING_STOP_LOCAL", "typing stops when the composer empties");
dispatched("ENABLE_AUTOMATIC_ACK", "acks: ReadStateStore acks the shown channel while it's at the bottom");
dispatched("DISABLE_AUTOMATIC_ACK", "acks stop when the list leaves a channel");
dispatched("CATEGORY_COLLAPSE", "a category's channels hide: CategoryCollapseStore, and a user guild setting (it syncs)");
dispatched("CATEGORY_EXPAND", "a category's channels show again");
needs.push({
    name: "window id",
    what: "window.__DISCORD_WINDOW_ID, the window acks are enabled for",
    resolve: () => typeof (window as any).__DISCORD_WINDOW_ID === "string" ? null : "not set"
});

let report: { ok: boolean; took: number; needs: number; missing: { name: string; what: string; why: string; }[]; } | null = null;

// once: the result sticks
export function check() {
    if (report) return report;
    const t = performance.now();
    const missing = needs.flatMap(n => {
        let why: string | null;
        try {
            why = n.resolve();
        } catch (e) {
            why = `threw: ${e}`;
        }
        return why ? [{ name: n.name, what: n.what, why }] : [];
    });
    return report = { ok: !missing.length, took: Math.round(performance.now() - t), needs: needs.length, missing };
}
