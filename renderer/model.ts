/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What a channel's message list shows, derived from the stores. Every list variant renders from this, so they differ
// only in how they turn it into DOM.

import { A, S } from "../adapter/core";
import type { Id } from "../adapter/discord";

export type Message = Record<string, any> & { id: Id; content: string; timestamp: Date; author: Record<string, any>; };

export interface Author {
    id: Id;
    name: string;
    color: string | null;
    avatar: string;
}

// stock groups a message under the previous one's header when the same author wrote both within 7 minutes
const GROUP_MS = 7 * 60 * 1000;

export function messagesOf(channelId: Id): Message[] {
    return S.Message.getMessages(channelId).toArray() as Message[];
}

export function startsGroup(prev: Message | undefined, m: Message) {
    return !prev || prev.author.id !== m.author.id || m.type !== 0 && m.type !== 19 || prev.type !== 0 && prev.type !== 19
        || m.timestamp.getTime() - prev.timestamp.getTime() > GROUP_MS || m.messageReference != null;
}

export function authorOf(m: Message, guildId: Id | null): Author {
    const u = m.author;
    const member = guildId && !m.webhookId ? S.GuildMember.getMember(guildId, u.id) : null;
    return {
        id: u.id,
        name: member?.nick ?? u.globalName ?? u.username,
        color: member?.colorString ?? null,
        avatar: u.getAvatarURL(guildId, 80)
    };
}

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });

export function when(d: Date) {
    const today = new Date();
    return d.toDateString() === today.toDateString() ? time.format(d) : `${date.format(d)} ${time.format(d)}`;
}

// message content as Discord's markdown AST (what its React output is built from), with message-content options
export function contentAST(m: Message, channelId: Id): any[] {
    return A.markdown.parseToAST(m.content, true, {
        channelId, messageId: m.id, allowLinks: true, allowHeading: true, allowList: true, allowEmojiLinks: true
    });
}
