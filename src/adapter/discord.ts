// The parts of Discord's stores and action creators the renderer uses, typed only as far as we call them. Every method
// named here is checked at startup (core.ts): adding one here means adding it to its need too.

export type Id = string
export type Rec = Record<string, any>

export interface FluxStore {
  getName(): string
  addChangeListener(fn: () => void): void
}

export interface Stores {
  Gateway: FluxStore & { isConnected(): boolean; isTryingToConnect(): boolean }
  Auth: FluxStore & { isAuthenticated(): boolean }
  User: FluxStore & { getCurrentUser(): Rec | undefined; getUser(id: Id): Rec | undefined }
  Guild: FluxStore & { getGuild(id: Id): Rec | undefined }
  // the server bar: single servers are folders without a folderId
  SortedGuild: FluxStore & {
    getGuildFolders(): { folderId?: number; folderName?: string; folderColor?: number; guildIds: Id[] }[]
  }
  // voice states by user id
  VoiceState: FluxStore & { getVoiceStatesForChannel(channelId: Id): Record<Id, Rec> }
  Speaking: FluxStore & { isSpeaking(userId: Id): boolean }
  // getState: CONNECTING, AUTHENTICATING, AWAITING_ENDPOINT, RTC_CONNECTING, RTC_CONNECTED, NO_ROUTE, DISCONNECTED...
  RTCConnection: FluxStore & {
    getState(): string
    getChannelId(): Id | null
  }
  // a DM's call: { channelId, ringing, ... }, null without one
  Call: FluxStore & { getCall(channelId: Id): Rec | null }
  // calls ringing for you: { channel, senderId }
  IncomingCall: FluxStore & { getIncomingCalls(): Rec[] }
  ChannelStatus: FluxStore & {
    hasRequestedStatuses(guildId: Id): boolean
    getChannelStatus(channel: Rec): string | undefined
  }
  // when a voice channel's call started (ms), from the same channel info request as the statuses
  VoiceChannelStartTime: FluxStore & { getStartTime(channel: Rec): number | undefined }
  // most used first: servers and channels (records) mixed
  Frecency: FluxStore & { getFrequentlyWithoutFetchingLatest(): Rec[] }
  // devices by id: { id, name, disabled }
  MediaEngine: FluxStore & {
    isSelfMute(): boolean
    isSelfDeaf(): boolean
    getInputDevices(): Record<string, Rec>
    getOutputDevices(): Record<string, Rec>
    getInputDeviceId(): string
    getOutputDeviceId(): string
    getInputVolume(): number
    getOutputVolume(): number
    getMode(): string
    getModeOptions(): Rec
    getNoiseSuppression(): boolean
    getNoiseCancellation(): boolean
    getEchoCancellation(): boolean
    getAutomaticGainControl(): boolean
    isNoiseCancellationSupported(): boolean
  }
  ExpandedGuildFolder: FluxStore & { isFolderExpanded(folderId: number): boolean }
  Channel: FluxStore & { getChannel(id: Id): Rec | undefined }
  GuildChannel: FluxStore & { getChannels(guildId: Id): Rec }
  // getSortedChannels: [pinned (Discord's DM favorites), the rest], newest first
  PrivateChannelSort: FluxStore & { getSortedChannels(): [Rec[], Rec[]] }
  SelectedGuild: FluxStore & { getGuildId(): Id | null }
  SelectedChannel: FluxStore & { getChannelId(guildId?: Id): Id | null }
  Message: FluxStore & {
    getMessages(channelId: Id): Rec & { ready: boolean }
    getMessage(channelId: Id, messageId: Id): Rec | undefined
    // what Up in an empty composer edits
    getLastEditableMessage(channelId: Id): Rec | undefined
  }
  ReadState: FluxStore & {
    hasUnread(channelId: Id): boolean
    getMentionCount(channelId: Id): number
    getOldestUnreadMessageId(channelId: Id): Id | null
    // 0 without unreads
    getOldestUnreadTimestamp(channelId: Id): number
    getUnreadCount(channelId: Id): number
    // the count is a guess (more than a page unread): stock shows it as "N+"
    isEstimated(channelId: Id): boolean
    ackMessageId(channelId: Id): Id | null
  }
  GuildReadState: FluxStore & {
    hasUnread(guildId: Id): boolean
    getMentionCount(guildId: Id): number
    getGuildHasUnreadIgnoreMuted(guildId: Id): boolean
    // every server's and DM's mentions, and whether anything is unread: the app badge
    getTotalMentionCount(): number
    hasAnyUnread(): boolean
  }
  NotificationSettings: FluxStore & { getDisableUnreadBadge(): boolean; isSoundDisabled(sound: string): boolean }
  Soundpack: FluxStore & { getSoundpack(): string }
  PrivateChannelReadState: FluxStore & { getUnreadPrivateChannelIds(): Id[] }
  // activities: { type, name, state }; type 4 is the custom status
  // this client's own activities (games, Rich Presence, a custom status): { type, name, state, details }
  LocalActivity: FluxStore & { getPrimaryActivity(): Rec | null }
  Presence: FluxStore & { getStatus(userId: Id): string; getActivities(userId: Id): Rec[] }
  // friend nicknames
  Relationship: FluxStore & {
    getNickname(userId: Id): string | undefined
    isBlocked(userId: Id): boolean
    // incoming friend requests
    getPendingCount(): number
  }
  // ms left before the next message may be sent (type 0: messages)
  Slowmode: FluxStore & { getSlowmodeCooldownGuess(channelId: Id, type?: number): number }
  Permission: FluxStore & { can(permission: bigint, context: Rec): boolean }
  UserGuildSettings: FluxStore & { isMuted(guildId: Id): boolean; isChannelMuted(guildId: Id, channelId: Id): boolean }
  GuildMember: FluxStore & { getMember(guildId: Id, userId: Id): Rec | null }
  // { userId: when they started typing }
  Typing: FluxStore & { getTypingUsers(channelId: Id): Record<Id, number> }
  // draftType 0: the channel's composer
  Draft: FluxStore & { getDraft(channelId: Id, draftType: number): string }
  EditMessage: FluxStore & {
    getEditingTextValue(channelId: Id): string | undefined
    getEditingMessageId(channelId: Id): Id | undefined
  }
  CategoryCollapse: FluxStore & { isCollapsed(categoryId: Id): boolean }
  // { message, channel, shouldMention, showMentionToggle } while the composer replies
  PendingReply: FluxStore & { getPendingReply(channelId: Id): Rec | undefined }
  // a reply's message, if loaded: { state, message }
  ReferencedMessage: FluxStore & { getMessageByReference(ref: Rec): Rec & { message?: Rec | null } }
  // intention 0: for a reaction. Emoji: { id, name, surrogates, url, animated }
  Emoji: FluxStore & {
    searchWithoutFetchingLatest(o: { channel: Rec; query: string; count: number; intention: number }): {
      unlocked: Rec[]
    }
    readonly emojiReactionFrecencyWithoutFetchingLatest: { frequently: Rec[] }
  }
  // files staged for the next message (draft type 0: the channel's composer); { id, filename, ... }
  UploadAttachment: FluxStore & { getUploads(channelId: Id, draftType: number): Rec[] }
  // "MEMBERS" while the member list is open (isPrivate false for a guild channel)
  ChannelSection: FluxStore & { getSection(channelId: Id, isPrivate: boolean): string }
  // { groups, rows }: GROUP rows { title, count }, MEMBER rows { userId, nick, colorString, status, user }, empty
  // slots for rows not subscribed to
  ChannelMember: FluxStore & { getProps(guildId: Id, channelId: Id): Rec }
  // who reacted, by user id; the first read fetches them (type 0: normal reactions)
  MessageReactions: FluxStore & {
    getReactions(channelId: Id, messageId: Id, emoji: Rec, limit: number, type: number): Map<Id, Rec>
  }
  SelfPresence: FluxStore & { getStatus(): string }
  // a getter: "/channels/@me" (its lastViewedPath isn't used for it)
  DefaultRoute: FluxStore & { readonly defaultRoute: string }
}

export interface Actions {
  dispatcher: {
    dispatch(action: Rec & { type: string }): void
    subscribe(type: string, fn: (action: Rec) => void): void
    _actionHandlers: Rec
  }
  flux: { connectStores: unknown; Store: { getAll(): FluxStore[] } }
  react: { createElement(type: unknown, props?: Rec | null, ...children: unknown[]): unknown; useEffect: unknown }
  messages: {
    sendMessage(channelId: Id, message: Rec, waitForReady?: boolean, options?: Rec): Promise<unknown>
    editMessage(channelId: Id, messageId: Id, message: Rec): Promise<unknown>
    // local: only the client's copy (a failed send)
    deleteMessage(channelId: Id, messageId: Id, local?: boolean): Promise<unknown>
    // sendMessage's options for a pending reply: messageReference, allowedMentions
    getSendMessageOptionsForReply(reply: Rec | undefined): Rec
    fetchMessages(options: {
      channelId: Id
      limit?: number
      before?: Id
      after?: Id
      truncate?: boolean
    }): Promise<unknown>
    jumpToPresent(channelId: Id, limit: number): void
    // a fetch around the message (or none, if loaded), then ChannelMessages' jumpTargetId and jumpSequenceId. offset: a
    // jump to the message after it (stock's to unread, from the last read message)
    jumpToMessage(o: {
      channelId: Id
      messageId: Id
      flash?: boolean
      offset?: number
      context?: string
      returnMessageId?: Id
    }): void
    // edit mode, kept in EditMessageStore. startEditMessageRecord is what stock's Up and its menu's Edit call
    startEditMessageRecord(channelId: Id, message: Rec): void
    updateEditMessage(channelId: Id, textValue: string): void
    endEditMessage(channelId: Id, response?: unknown): void
  }
  // the composer's text to a message and back: @name, #channel and :emoji: become ids
  parser: {
    parse(channel: Rec, text: string): Rec & { content: string }
    unparse(text: string, channelId: Id, ...rest: unknown[]): string
  }
  drafts: {
    saveDraft(channelId: Id, draft: string, draftType: number): void
    changeDraft(channelId: Id, draft: string, draftType: number): void
  }
  // the composer's reply state (PendingReplyStore)
  replies: {
    create(options: { message: Rec; channel: Rec; shouldMention: boolean; showMentionToggle: boolean }): void
    remove(channelId: Id): void
    mention(channelId: Id, on: boolean): void
  }
  // location: where it came from, as stock names it ("Message Inline Button" for a chip, "Message Context Menu")
  reactions: {
    add(channelId: Id, messageId: Id, emoji: Rec, location?: string): Promise<void>
    remove(o: { channelId: Id; messageId: Id; emoji: Rec; location?: string }): Promise<void>
  }
  uploads: {
    addFiles(o: Rec): void
    remove(channelId: Id, id: string, draftType: number): void
    clearAll(channelId: Id, draftType: number): void
  }
  promptToUpload: { prompt(files: File[], channel: Rec, draftType: number): Promise<void> }
  // stock's autocomplete queries. Mentions: users as { user, nick }, roles as records, globals as { text }
  autocomplete: {
    queryMentionResults(o: { query: string; channel: Rec; canMentionEveryone?: boolean; request?: boolean }): {
      users: Rec[]
      roles: Rec[]
      globals: Rec[]
    }
    queryChannelResults(o: { query: string; channel: Rec }): { channels: Rec[] }
    queryEmojiResults(o: { query: string; channel: Rec; intention: number; maxCount?: number }): {
      emojis: { unlocked: Rec[] }
    }
  }
  guilds: { toggleGuildFolderExpand(folderId: number): void }
  // reason: the analytics label stock passes ("muted", "unmuted")
  notifications: {
    updateGuildNotificationSettings(guildId: Id, settings: Rec, reason?: string): void
    // label: the analytics label stock passes ("muted", "unmuted")
    updateChannelOverrideSettings(o: {
      guildId: Id
      channelId: Id
      settings: Rec
      label?: string
      location?: string
    }): void
  }
  // location: where stock's menu says the ack came from
  acks: { markRead(channel: Rec, location?: string): void; ack(channelId: Id, location?: Rec | string): void }
  voice: { selectVoiceChannel(channelId: Id | null): void; disconnect(): void }
  sounds: { forPack(name: string, soundpack: string): { play(): void; loop(): void; stop(): void } }
  calls: {
    // video, ring; recipientId: a 1:1 DM's user (stock checks the call is allowed first)
    call(channelId: Id, video: boolean, ring: boolean, recipientId?: Id): void
    ring(channelId: Id, recipients?: Id[]): void
    stopRinging(channelId: Id, recipients?: Id[]): Promise<unknown>
  }
  // an invite by code: resolve (no write) gives { invite: { code, guild, channel, approximate_*_count } }; accepting
  // joins and opens the channel it points to
  invites: {
    resolveInvite(code: string, location?: string): Promise<{ invite?: Rec; code: string }>
    acceptInviteAndTransitionToInviteChannel(o: { inviteKey: string; context?: Rec }): Promise<unknown>
  }
  channelInfo(guildId: Id): void
  rest: Record<
    'del' | 'get' | 'patch' | 'post' | 'put',
    (o: { url: string; body?: Rec; oldFormErrors?: boolean; rejectWithError?: boolean }) => Promise<Rec>
  >
  endpoints: { PIN(channelId: Id, messageId: Id): string; MESSAGE_ACK(channelId: Id, messageId: Id): string }
  readStates: { countsAsMention(message: Rec, user: Rec): boolean }
  audio: {
    toggleSelfMute(): Promise<void>
    toggleSelfDeaf(): void
    setInputDevice(id: string): void
    setOutputDevice(id: string): void
    // the voice settings (local to this client, MediaEngineStore): input 0-100, output 0-200
    setInputVolume(volume: number): void
    setOutputVolume(volume: number): void
    // mode: VOICE_ACTIVITY or PUSH_TO_TALK; options: getModeOptions() with changes (autoThreshold, threshold in dB)
    setMode(mode: string, options: Rec): void
    setNoiseSuppression(on: boolean): void
    // Krisp
    setNoiseCancellation(on: boolean): void
    setEchoCancellation(on: boolean): void
    setAutomaticGainControl(on: boolean): void
  }
  markGuildsRead(guildIds: Id[], source: string): void
  channelSections: { toggleMembersSection(): void; toggleUserProfileSidebarSection(): void }
  memberSubscriptions: { range(o: { guildId: Id; channelId: Id; y: number; height: number; rowHeight: number }): void }
  // stock's status picker: writes the status user setting (it syncs to every client)
  setStatus(options: { nextStatus: string; prevStatus?: string; durationMillis?: number }): Promise<void>
  nav: {
    transitionTo(path: string, state?: Rec): void
    transitionToGuild(guildId: Id, channelId?: Id): void
    replaceWith(path: string): void
  }
  // stock's page size: the messages that fit the window's height (at least 10, at most 30), from its window size,
  // density and font size; the argument is only a label
  pages: { size(label?: string): number }
  markdown: { parseToAST(text: string, inline?: boolean, state?: Rec): Rec[] }
  frecencySettings: { loadIfNecessary(): Promise<void> }
  // a unicode emoji's image (Discord's SVG)
  emojis: { getURL(surrogate: string): string; sanitizeEmojiName: unknown }
  // a group DM's icon, its default one when it has none
  icons: {
    getChannelIconURL(o: { id: Id; icon?: string | null; applicationId?: Id; size?: number }): string
    getGuildIconURL: unknown
  }
}
