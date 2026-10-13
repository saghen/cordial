// What a message row shows, derived from the records and stores.

import { A, S } from "../../adapter/core";
import type { Id, Rec } from "../../adapter/discord";
import { $ } from "./store";

export type Message = Record<string, any> & { id: Id; content: string; timestamp: Date; author: Record<string, any>; };
export interface Attachment { url: string; proxy_url: string; filename: string; size: number; content_type?: string; width?: number; height?: number; }
export interface Reaction { emoji: { id: Id | null; name: string; animated?: boolean; }; count: number; me: boolean; }

export const PERMS = {
    ADD_REACTIONS: 64n, SEND_MESSAGES: 2048n, MANAGE_MESSAGES: 8192n, READ_MESSAGE_HISTORY: 65536n,
    MENTION_EVERYONE: 131072n, PIN_MESSAGES: 1n << 51n
};

// stock's rule: anything in a DM
export const can = (permission: bigint, channel: Rec) => channel.isPrivate() || $.Permission.can(permission, channel);

export const nameOf = (user?: Rec | null, nick?: string | null): string => nick ?? user?.globalName ?? user?.username;

export interface Author {
    id: Id;
    name: string;
    color: string | null;
    avatar: string;
    bot: boolean;
}

// Stock's grouping rule, ported from Discord's module with "IS_SCHEDULED)!==" (2026-10): it lives in a chunk only
// Discord's message list loads. A message starts a new group unless it continues the previous one: same author
// (and, for webhooks, the same name) within 7 minutes on the same day, both user messages, matching flags.
const GROUP_MS = 7 * 60 * 1000;
const USER_MESSAGE = new Set([0, 19, 20, 23, 26, 41, 45, 47, 68]);
const REPLY = 19;
const HAS_THREAD = 1 << 5, EPHEMERAL = 1 << 6, SUPPRESS_NOTIFICATIONS = 1 << 12, IS_SCHEDULED = 1 << 20;

const flag = (m: Message, f: number) => (m.flags & f) !== 0;
const orNull = (s: unknown) => s == null || s === "" ? null : s;

export function startsGroup(channel: Rec | undefined, prev: Message | undefined, m: Message) {
    if (!prev) return true;
    if (flag(m, HAS_THREAD) || m.isCommandType?.() || prev.blocked !== m.blocked || prev.ignored !== m.ignored) return true;
    if (m.applicationId !== prev.applicationId || orNull(m.additionalName) !== orNull(prev.additionalName)) return true;
    if (m.type > 0) return USER_MESSAGE.has(prev.type) || m.type === REPLY;
    const a = prev.timestamp, b = m.timestamp, apart = Math.abs(a.getTime() - b.getTime());
    return !USER_MESSAGE.has(prev.type)
        || prev.author.id !== m.author.id
        || flag(prev, EPHEMERAL) !== flag(m, EPHEMERAL)
        || flag(prev, IS_SCHEDULED) !== flag(m, IS_SCHEDULED)
        || m.webhookId != null && prev.author.username !== m.author.username
        || channel?.isForumPost?.() && prev.id === channel.id
        || !(apart <= 864e5 && a.getDate() === b.getDate())
        || !(apart < GROUP_MS)
        || flag(m, SUPPRESS_NOTIFICATIONS) && !flag(prev, SUPPRESS_NOTIFICATIONS)
        || flag(prev, SUPPRESS_NOTIFICATIONS) && !flag(m, SUPPRESS_NOTIFICATIONS)
            && (m.mentions.length > 0 || m.mentionRoles.length > 0 || m.mentionEveryone);
}

export function authorOf(m: Message, guildId: Id | null): Author {
    const u = m.author;
    const member = guildId && !m.webhookId ? S.GuildMember.getMember(guildId, u.id) : null;
    return {
        id: u.id,
        name: nameOf(u, member?.nick),
        color: member?.colorString ?? null,
        avatar: u.getAvatarURL(guildId, 80),
        bot: !!u.bot
    };
}

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

export function when(d: Date) {
    const today = new Date();
    return d.toDateString() === today.toDateString() ? time.format(d) : `${date.format(d)} ${time.format(d)}`;
}

// the date divider above a message, when it's the first loaded of its day
export function dayOf(prev: Message | undefined, m: Message) {
    return prev && prev.timestamp.toDateString() !== m.timestamp.toDateString() ? longDate.format(m.timestamp) : undefined;
}

// message content as Discord's markdown AST (what its React output is built from), with message-content options
export function contentAST(m: Message, channelId: Id): any[] {
    return A.markdown.parseToAST(m.content, true, {
        channelId, messageId: m.id, allowLinks: true, allowHeading: true, allowList: true, allowEmojiLinks: true
    });
}
