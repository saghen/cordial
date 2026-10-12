// The parts of Discord's stores and action creators the renderer uses, typed only as far as we call them. Every method
// named here is checked at startup (core.ts): adding one here means adding it to its need too.

export type Id = string;
export type Rec = Record<string, any>;

export interface FluxStore {
    getName(): string;
    addChangeListener(fn: () => void): void;
    removeChangeListener(fn: () => void): void;
}

export interface Stores {
    Gateway: FluxStore & { isConnected(): boolean; isTryingToConnect(): boolean; };
    Auth: FluxStore & { isAuthenticated(): boolean; };
    User: FluxStore & { getCurrentUser(): Rec | undefined; getUser(id: Id): Rec | undefined; };
    Guild: FluxStore & { getGuild(id: Id): Rec | undefined; };
    SortedGuild: FluxStore & { getFlattenedGuildIds(): Id[]; };
    Channel: FluxStore & { getChannel(id: Id): Rec | undefined; };
    GuildChannel: FluxStore & { getChannels(guildId: Id): Rec; };
    // getSortedChannels: [pinned (Discord's DM favorites), the rest], newest first
    PrivateChannelSort: FluxStore & { getSortedChannels(): [Rec[], Rec[]]; };
    SelectedGuild: FluxStore & { getGuildId(): Id | null; };
    SelectedChannel: FluxStore & { getChannelId(guildId?: Id): Id | null; };
    Message: FluxStore & {
        getMessages(channelId: Id): Rec & { ready: boolean; };
        getMessage(channelId: Id, messageId: Id): Rec | undefined;
        // what Up in an empty composer edits
        getLastEditableMessage(channelId: Id): Rec | undefined;
    };
    ReadState: FluxStore & {
        hasUnread(channelId: Id): boolean;
        getMentionCount(channelId: Id): number;
        getOldestUnreadMessageId(channelId: Id): Id | null;
    };
    GuildReadState: FluxStore & { hasUnread(guildId: Id): boolean; getMentionCount(guildId: Id): number; getPrivateChannelMentionCount(): number; };
    PrivateChannelReadState: FluxStore & { getUnreadPrivateChannelIds(): Id[]; };
    Presence: FluxStore & { getStatus(userId: Id): string; };
    Permission: FluxStore & { can(permission: bigint, context: Rec): boolean; };
    UserGuildSettings: FluxStore & { isMuted(guildId: Id): boolean; isChannelMuted(guildId: Id, channelId: Id): boolean; };
    GuildMember: FluxStore & { getMember(guildId: Id, userId: Id): Rec | null; };
    // draftType 0: the channel's composer
    Draft: FluxStore & { getDraft(channelId: Id, draftType: number): string; };
    EditMessage: FluxStore & {
        getEditingTextValue(channelId: Id): string | undefined;
        getEditingMessageId(channelId: Id): Id | undefined;
    };
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
        fetchMessages(options: { channelId: Id; limit?: number; before?: Id; after?: Id; jump?: Rec; truncate?: boolean; }): Promise<unknown>;
        // edit mode, kept in EditMessageStore. startEditMessageRecord is what stock's Up and its menu's Edit call
        startEditMessageRecord(channelId: Id, message: Rec): void;
        updateEditMessage(channelId: Id, textValue: string): void;
        endEditMessage(channelId: Id, response?: unknown): void;
    };
    // the composer's text to a message and back: @name, #channel and :emoji: become ids
    parser: {
        parse(channel: Rec, text: string): Rec & { content: string; };
        unparse(text: string, channelId: Id, ...rest: unknown[]): string;
    };
    drafts: {
        saveDraft(channelId: Id, draft: string, draftType: number): void;
        changeDraft(channelId: Id, draft: string, draftType: number): void;
    };
    // stock's status picker: writes the status user setting (it syncs to every client)
    setStatus(options: { nextStatus: string; prevStatus?: string; durationMillis?: number; }): Promise<void>;
    nav: { transitionTo(path: string, state?: Rec): void; transitionToGuild(guildId: Id, channelId?: Id): void; replaceWith(path: string): void; };
    // stock's page size: the messages that fit the window's height (at least 10, at most 30), from its window size,
    // density and font size; the argument is only a label
    pages: { size(label?: string): number; };
    markdown: { parseToAST(text: string, inline?: boolean, state?: Rec): Rec[]; };
}
