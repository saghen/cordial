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
    // { message, channel, shouldMention, showMentionToggle } while the composer replies
    PendingReply: FluxStore & { getPendingReply(channelId: Id): Rec | undefined; };
    // a reply's message, if loaded: { state, message }
    ReferencedMessage: FluxStore & { getMessageByReference(ref: Rec): Rec & { message?: Rec | null; }; };
    // intention 0: for a reaction. Emoji: { id, name, surrogates, url, animated }
    Emoji: FluxStore & {
        searchWithoutFetchingLatest(o: { channel: Rec; query: string; count: number; intention: number; }): { unlocked: Rec[]; };
        readonly emojiReactionFrecencyWithoutFetchingLatest: { frequently: Rec[]; };
    };
    // files staged for the next message (draft type 0: the channel's composer); { id, filename, ... }
    UploadAttachment: FluxStore & { getUploads(channelId: Id, draftType: number): Rec[]; };
    // "MEMBERS" while the member list is open (isPrivate false for a guild channel)
    ChannelSection: FluxStore & { getSection(channelId: Id, isPrivate: boolean): string; };
    // { groups, rows }: GROUP rows { title, count }, MEMBER rows { userId, nick, colorString, status, user }, empty
    // slots for rows not subscribed to
    ChannelMember: FluxStore & { getProps(guildId: Id, channelId: Id): Rec; };
    // who reacted, by user id; the first read fetches them (type 0: normal reactions)
    MessageReactions: FluxStore & { getReactions(channelId: Id, messageId: Id, emoji: Rec, limit: number, type: number): Map<Id, Rec>; };
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
        // sendMessage's options for a pending reply: messageReference, allowedMentions
        getSendMessageOptionsForReply(reply: Rec | undefined): Rec;
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
    // the composer's reply state (PendingReplyStore)
    replies: {
        create(options: { message: Rec; channel: Rec; shouldMention: boolean; showMentionToggle: boolean; }): void;
        remove(channelId: Id): void;
        mention(channelId: Id, on: boolean): void;
    };
    // location: where it came from, as stock names it ("Message Inline Button" for a chip, "Message Context Menu")
    reactions: {
        add(channelId: Id, messageId: Id, emoji: Rec, location?: string): Promise<void>;
        remove(o: { channelId: Id; messageId: Id; emoji: Rec; location?: string; }): Promise<void>;
    };
    uploads: { addFiles(o: Rec): void; remove(channelId: Id, id: string, draftType: number): void; clearAll(channelId: Id, draftType: number): void; };
    promptToUpload: { prompt(files: File[], channel: Rec, draftType: number): Promise<void>; };
    // stock's autocomplete queries. Mentions: users as { user, nick }, roles as records, globals as { text }
    autocomplete: {
        queryMentionResults(o: { query: string; channel: Rec; canMentionEveryone?: boolean; request?: boolean; }): { users: Rec[]; roles: Rec[]; globals: Rec[]; };
        queryChannelResults(o: { query: string; channel: Rec; }): { channels: Rec[]; };
        queryEmojiResults(o: { query: string; channel: Rec; intention: number; maxCount?: number; }): { emojis: { unlocked: Rec[]; }; };
    };
    channelSections: { toggleMembersSection(): void; toggleUserProfileSidebarSection(): void; };
    memberSubscriptions: { range(o: { guildId: Id; channelId: Id; y: number; height: number; rowHeight: number; }): void; };
    setStatus(options: { nextStatus: string; prevStatus?: string; durationMillis?: number; }): Promise<void>;
    nav: { transitionTo(path: string, state?: Rec): void; transitionToGuild(guildId: Id, channelId?: Id): void; replaceWith(path: string): void; };
    // stock's page size: the messages that fit the window's height (at least 10, at most 30), from its window size,
    // density and font size; the argument is only a label
    pages: { size(label?: string): number; };
    markdown: { parseToAST(text: string, inline?: boolean, state?: Rec): Rec[]; };
}
