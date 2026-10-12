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
    getName(): string;
    addChangeListener(fn: () => void): void;
    removeChangeListener(fn: () => void): void;
}

export interface Stores {
    Gateway: FluxStore & { isConnected(): boolean; isTryingToConnect(): boolean; };
    Auth: FluxStore & { getId(): Id | null; isAuthenticated(): boolean; };
    User: FluxStore & { getCurrentUser(): Rec | undefined; getUser(id: Id): Rec | undefined; };
    Guild: FluxStore & { getGuild(id: Id): Rec | undefined; getGuilds(): Record<Id, Rec>; };
    SortedGuild: FluxStore & { getGuildFolders(): Rec[]; getFlattenedGuildIds(): Id[]; };
    Channel: FluxStore & { getChannel(id: Id): Rec | undefined; };
    GuildChannel: FluxStore & { getChannels(guildId: Id): Rec; };
    // getSortedChannels: [pinned (Discord's DM favorites), the rest], newest first
    PrivateChannelSort: FluxStore & { getPrivateChannelIds(): Id[]; getSortedChannels(): [Rec[], Rec[]]; };
    SelectedGuild: FluxStore & { getGuildId(): Id | null; };
    SelectedChannel: FluxStore & { getChannelId(guildId?: Id): Id | null; };
    Message: FluxStore & {
        getMessages(channelId: Id): Rec & { ready: boolean; };
        isReady(channelId: Id): boolean;
        whenReady(channelId: Id, fn: () => void): void;
    };
    ReadState: FluxStore & {
        hasUnread(channelId: Id): boolean;
        getMentionCount(channelId: Id): number;
        getOldestUnreadMessageId(channelId: Id): Id | null;
        ackMessageId(channelId: Id): Id | null;
    };
    GuildReadState: FluxStore & { hasUnread(guildId: Id): boolean; getMentionCount(guildId: Id): number; getPrivateChannelMentionCount(): number; };
    PrivateChannelReadState: FluxStore & { getUnreadPrivateChannelIds(): Id[]; };
    Presence: FluxStore & { getStatus(userId: Id): string; };
    Relationship: FluxStore & { getFriendIDs(): Id[]; };
    Permission: FluxStore & { can(permission: bigint, context: Rec): boolean; };
    UserGuildSettings: FluxStore & { isMuted(guildId: Id): boolean; isChannelMuted(guildId: Id, channelId: Id): boolean; };
    Typing: FluxStore & { getTypingUsers(channelId: Id): Record<Id, unknown>; };
    GuildMember: FluxStore & { getMember(guildId: Id, userId: Id): Rec | null; };
    // draftType 0: the channel's composer
    Draft: FluxStore & { getDraft(channelId: Id, draftType: number): string; };
    EditMessage: FluxStore & {
        isEditing(channelId: Id, messageId: Id): boolean;
        getEditingTextValue(channelId: Id): string | undefined;
        getEditingMessageId(channelId: Id): Id | undefined;
    };
    Slowmode: FluxStore & { getSlowmodeCooldownGuess(channelId: Id, type?: number): number; };
    CategoryCollapse: FluxStore & { isCollapsed(categoryId: Id): boolean; };
    SelfPresence: FluxStore & { getStatus(): string; };
    // a getter: "/channels/@me" (its lastViewedPath isn't used for it)
    DefaultRoute: FluxStore & { readonly defaultRoute: string; };
}

export interface Actions {
    dispatcher: { dispatch(action: Rec & { type: string; }): void; subscribe(type: string, fn: (action: Rec) => void): void; _actionHandlers: Rec; };
    flux: { connectStores: unknown; Store: { getAll(): FluxStore[]; }; };
    react: { createElement(type: unknown, props?: Rec | null, ...children: unknown[]): unknown; useEffect: unknown; };
    messages: {
        sendMessage(channelId: Id, message: Rec, waitForReady?: boolean, options?: Rec): Promise<unknown>;
        editMessage(channelId: Id, messageId: Id, message: Rec): Promise<unknown>;
        deleteMessage(channelId: Id, messageId: Id): Promise<unknown>;
        fetchMessages(options: { channelId: Id; limit?: number; before?: Id; after?: Id; jump?: Rec; truncate?: boolean; }): Promise<unknown>;
        jumpToPresent(channelId: Id, limit?: number): void;
        jumpToMessage(options: Rec): void;
        // edit mode, kept in EditMessageStore
        startEditMessage(channelId: Id, messageId: Id, content: string): void;
        updateEditMessage(channelId: Id, textValue: string): void;
        endEditMessage(channelId: Id, response?: unknown): void;
    };
    // the composer's text to a message: @name, #channel and :emoji: become ids. Returns { content, tts, invalidEmojis, ... }
    // parsePreprocessor and unparse aren't used yet: they tell this module from the markdown one, which also has parse
    parser: {
        parse(channel: Rec, text: string): Rec & { content: string; };
        parsePreprocessor(channel: Rec, text: string): string;
        unparse(text: string, channelId: Id, ...rest: unknown[]): string;
    };
    drafts: {
        saveDraft(channelId: Id, draft: string, draftType: number): void;
        changeDraft(channelId: Id, draft: string, draftType: number): void;
        clearDraft(channelId: Id, draftType: number): void;
    };
    // stock's status picker: writes the status user setting (it syncs to every client)
    setStatus(options: { nextStatus: string; prevStatus?: string; durationMillis?: number; }): Promise<void>;
    // dispatches CHANNEL_ACK: (channelId, location, immediate?, force?, messageId?)
    ack(channelId: Id, location?: unknown, immediate?: boolean, force?: boolean, messageId?: Id): void;
    channels: { selectChannel(options: { guildId?: Id | null; channelId: Id; messageId?: Id; }): void; selectPrivateChannel(channelId: Id): void; };
    guilds: { selectGuild(guildId: Id): void; };
    nav: { transitionTo(path: string, state?: Rec): void; transitionToGuild(guildId: Id, channelId?: Id): void; replaceWith(path: string): void; back(): void; };
    // stock's page size: the messages that fit the window's height (at least 10, at most 30), from its window size,
    // density and font size; the argument is only a label
    pages: { size(label?: string): number; };
    markdown: { parseToAST(text: string, inline?: boolean, state?: Rec): Rec[]; parse(text: string, inline?: boolean, state?: Rec): unknown; astParserFor(rules: Rec): unknown; defaultRules: Rec; };
}
