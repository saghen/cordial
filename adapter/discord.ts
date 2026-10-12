/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The parts of Discord's stores and action creators the renderer uses, typed only as far as we call them. Records
// (users, channels, messages) stay loose until a feature needs their fields. Every method named here is checked at
// startup (core.ts), so adding one to an interface means adding it to its need too.

export type Id = string;
export type Rec = Record<string, any>;

export interface FluxStore {
    addChangeListener(fn: () => void): void;
    removeChangeListener(fn: () => void): void;
}

export interface Stores {
    Gateway: FluxStore & { isConnected(): boolean; isTryingToConnect(): boolean; };
    Auth: FluxStore & { getId(): Id | null; };
    User: FluxStore & { getCurrentUser(): Rec | undefined; getUser(id: Id): Rec | undefined; };
    Guild: FluxStore & { getGuild(id: Id): Rec | undefined; getGuilds(): Record<Id, Rec>; };
    SortedGuild: FluxStore & { getGuildFolders(): Rec[]; getFlattenedGuildIds(): Id[]; };
    Channel: FluxStore & { getChannel(id: Id): Rec | undefined; };
    GuildChannel: FluxStore & { getChannels(guildId: Id): Rec; };
    PrivateChannelSort: FluxStore & { getPrivateChannelIds(): Id[]; };
    SelectedGuild: FluxStore & { getGuildId(): Id | null; };
    SelectedChannel: FluxStore & { getChannelId(guildId?: Id): Id | null; };
    Message: FluxStore & {
        getMessages(channelId: Id): Rec & { ready: boolean; };
        isReady(channelId: Id): boolean;
        whenReady(channelId: Id, fn: () => void): void;
    };
    ReadState: FluxStore & { hasUnread(channelId: Id): boolean; getMentionCount(channelId: Id): number; };
    Presence: FluxStore & { getStatus(userId: Id): string; };
    Relationship: FluxStore & { getFriendIDs(): Id[]; };
    Permission: FluxStore & { can(permission: bigint, context: Rec): boolean; };
    UserGuildSettings: FluxStore & { isMuted(guildId: Id): boolean; isChannelMuted(guildId: Id, channelId: Id): boolean; };
    Typing: FluxStore & { getTypingUsers(channelId: Id): Record<Id, unknown>; };
    GuildMember: FluxStore & { getMember(guildId: Id, userId: Id): Rec | null; };
}

export interface Actions {
    messages: {
        sendMessage(channelId: Id, message: Rec, waitForReady?: boolean, options?: Rec): Promise<unknown>;
        editMessage(channelId: Id, messageId: Id, message: Rec): Promise<unknown>;
        deleteMessage(channelId: Id, messageId: Id): Promise<unknown>;
        fetchMessages(options: { channelId: Id; limit?: number; before?: Id; after?: Id; jump?: Rec; }): Promise<unknown>;
        jumpToPresent(channelId: Id, limit?: number): void;
        jumpToMessage(options: Rec): void;
    };
    // dispatches CHANNEL_ACK: (channelId, location, immediate?, force?, messageId?)
    ack(channelId: Id, location?: unknown, immediate?: boolean, force?: boolean, messageId?: Id): void;
    channels: { selectChannel(options: { guildId?: Id | null; channelId: Id; messageId?: Id; }): void; selectPrivateChannel(channelId: Id): void; };
    guilds: { selectGuild(guildId: Id): void; };
    nav: { transitionTo(path: string, state?: Rec): void; transitionToGuild(guildId: Id, channelId?: Id): void; replaceWith(path: string): void; back(): void; };
    markdown: { parseToAST(text: string, inline?: boolean, state?: Rec): Rec[]; parse(text: string, inline?: boolean, state?: Rec): unknown; astParserFor(rules: Rec): unknown; defaultRules: Rec; };
}
