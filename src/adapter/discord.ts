// The parts of Discord's stores and action creators the renderer uses, typed only as far as we call them. Every method
// named here is checked at startup (needs.ts): adding one here means adding it to its need too.

export type Id = string
export type AnyRecord = Record<string, any>

export interface FluxStore {
  getName(): string
  addChangeListener(listener: () => void): void
}

export interface Stores {
  Gateway: FluxStore & { isConnected(): boolean; isTryingToConnect(): boolean }
  Auth: FluxStore & {
    isAuthenticated(): boolean
    getId(): Id
    // NONE, LOGGING_IN, MFA_STEP, LOGGING_IN_MFA, ACCOUNT_DISABLED, PHONE_IP_AUTHORIZATION...
    getLoginStatus(): string
    getMFATicket(): string
    // { type: totp, sms, backup, webauthn, ... }
    getMFAMethods(): AnyRecord[]
    getLoginInstanceId(): string | null
  }
  User: FluxStore & { getCurrentUser(): AnyRecord | undefined; getUser(id: Id): AnyRecord | undefined }
  Guild: FluxStore & { getGuild(id: Id): AnyRecord | undefined; getGuildCount(): number }
  // the server bar: single servers are folders without a folderId
  SortedGuild: FluxStore & {
    getGuildFolders(): { folderId?: number; folderName?: string; folderColor?: number; guildIds: Id[] }[]
  }
  // voice states by user id; userHasBeenMovedVersion is bumped when someone moves you to another channel
  VoiceState: FluxStore & {
    getVoiceStatesForChannel(channelId: Id): Record<Id, AnyRecord>
    isInChannel(channelId: Id): boolean
    userHasBeenMovedVersion: number
  }
  SortedVoiceState: FluxStore & { countVoiceStatesForChannel(channelId: Id): number }
  // what goes on in a server's voice, as the server bar's badge shows it (stock leaves out muted servers' unless you're
  // in one, AFK channels and blocked users)
  GuildMediaState: FluxStore & {
    getGuildMediaState(guildId: Id): {
      audio: boolean
      video: boolean
      screenshare: boolean
      isCurrentUserConnected: boolean
    }
  }
  Speaking: FluxStore & {
    isSpeaking(userId: Id): boolean
    isCurrentUserPTTActive(): boolean
    isCurrentUserPrioritySpeaker(): boolean
  }
  // Go Live streams: { streamType, guildId, channelId, ownerId, state }; viewers by stream key
  ApplicationStreaming: FluxStore & {
    getAllActiveStreams(): AnyRecord[]
    getAllApplicationStreamsForChannel(channelId: Id): AnyRecord[]
    getCurrentUserActiveStream(): AnyRecord | null
    getViewerIds(streamKey: string): Id[]
    // a user's Go Live in a server (or a call: guildId null), and the one you're connected to (watching)
    getStreamForUser(userId: Id, guildId: Id | null): AnyRecord | null
    getActiveStreamForUser(userId: Id, guildId: Id | null): AnyRecord | null
  }
  // voice handed to a console (Xbox, PlayStation)
  GameConsole: FluxStore & { getAwaitingRemoteSessionInfo(): AnyRecord | null; getRemoteSessionId(): Id | null }
  // getState: CONNECTING, AUTHENTICATING, AWAITING_ENDPOINT, RTC_CONNECTING, RTC_CONNECTED, NO_ROUTE, DISCONNECTED...
  RTCConnection: FluxStore & {
    getState(): string
    getChannelId(): Id | null
    getWasEverRtcConnected(): boolean
    getUserIds(): Id[] | undefined
  }
  // a DM's call: { channelId, ringing, ... }, null without one
  Call: FluxStore & { getCall(channelId: Id): AnyRecord | null }
  // calls ringing for you: { channel, senderId }
  IncomingCall: FluxStore & { getIncomingCalls(): AnyRecord[] }
  ChannelStatus: FluxStore & {
    hasRequestedStatuses(guildId: Id): boolean
    getChannelStatus(channel: AnyRecord): string | undefined
  }
  // when a voice channel's call started (ms), from the same channel info request as the statuses
  VoiceChannelStartTime: FluxStore & { getStartTime(channel: AnyRecord): number | undefined }
  // most used first: servers and channels (records) mixed
  Frecency: FluxStore & { getFrequentlyWithoutFetchingLatest(): AnyRecord[] }
  // devices by id: { id, name, disabled }
  MediaEngine: FluxStore & {
    isSelfMute(): boolean
    isSelfDeaf(): boolean
    isSelfMutedTemporarily(): boolean
    isVideoEnabled(): boolean
    isNativeAudioPermissionReady(): boolean
    shouldSkipMuteUnmuteSound(): boolean
    notifyMuteUnmuteSoundWasSkipped(): void
    getInputDevices(): Record<string, AnyRecord>
    getOutputDevices(): Record<string, AnyRecord>
    getInputDeviceId(): string
    getOutputDeviceId(): string
    getInputVolume(): number
    getOutputVolume(): number
    getMode(): string
    getModeOptions(): AnyRecord
    getNoiseSuppression(): boolean
    getNoiseCancellation(): boolean
    getEchoCancellation(): boolean
    getAutomaticGainControl(): boolean
    isNoiseCancellationSupported(): boolean
    // the voice engine: its connections (Go Live's among them, screen-capture's quality)
    getMediaEngine(): { connections: Iterable<any> }
  }
  ExpandedGuildFolder: FluxStore & { isFolderExpanded(folderId: number): boolean }
  Channel: FluxStore & { getChannel(id: Id): AnyRecord | undefined }
  GuildChannel: FluxStore & { getChannels(guildId: Id): AnyRecord }
  // getSortedChannels: [pinned (Discord's DM favorites), the rest], newest first
  PrivateChannelSort: FluxStore & { getSortedChannels(): [AnyRecord[], AnyRecord[]] }
  SelectedGuild: FluxStore & { getGuildId(): Id | null }
  SelectedChannel: FluxStore & { getChannelId(guildId?: Id): Id | null; getVoiceChannelId(): Id | null }
  Message: FluxStore & {
    getMessages(channelId: Id): AnyRecord & { ready: boolean }
    getMessage(channelId: Id, messageId: Id): AnyRecord | undefined
    // what Up in an empty composer edits
    getLastEditableMessage(channelId: Id): AnyRecord | undefined
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
    // pins newer than the last time the channel's pins were seen (the header's dot)
    hasUnreadPins(channelId: Id): boolean
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
  // the GIF picker's results ({ id, url, src, width, height }) and trending categories ({ type, name, src })
  GIFPickerView: FluxStore & { getResultItems(): AnyRecord[]; getTrendingCategories(): AnyRecord[] }
  // stickers by server id; Discord's packs once fetched ({ id, name, stickers })
  Stickers: FluxStore & {
    getAllGuildStickers(): Map<Id, AnyRecord[]>
    getPremiumPacks(): AnyRecord[]
    getStickerById(id: Id): AnyRecord | undefined
    getStickerPack(id: Id): AnyRecord | undefined
  }
  // a user's camera in a call: its stream id for the web engine (guildId null in DMs)
  // context: "default" (a camera) or "stream" (a Go Live)
  VideoStream: FluxStore & {
    getStreamId(userId: Id, guildId: Id | null, context?: 'default' | 'stream'): string | undefined
    // with the quality its owner announced: maxResolution { type: "fixed" | "source", width, height }, maxFrameRate
    getUserStreamData(userId: Id, guildId: Id | null, context?: 'default' | 'stream'): AnyRecord | undefined
  }
  // sounds by server id ("0": Discord's)
  Soundboard: FluxStore & { getSounds(): Map<Id, AnyRecord[]>; isPlayingSound(soundId: Id): boolean }
  // a search's results by its id (the server's id, or the channel's): the matching messages, 25 a page
  Search: FluxStore & {
    getMessages(id: Id): AnyRecord[] | null
    getTotalCount(id: Id): number | null
    getIsFetching(id: Id): boolean
    getError(id: Id): AnyRecord | null
  }
  // a channel's pins: items { message, pinnedAt }, state LOADING, LOADED_HAS_MORE, LOADING_FINISHED (sic) or FAILED
  ChannelPins: FluxStore & { getPins(channelId: Id): { state: string; items: AnyRecord[] } | undefined }
  PrivateChannelReadState: FluxStore & { getUnreadPrivateChannelIds(): Id[] }
  // this client's own activities (games, Rich Presence, a custom status): { type, name, state, details }
  LocalActivity: FluxStore & { getPrimaryActivity(): AnyRecord | null }
  // activities: { type, name, state }; type 4 is the custom status
  Presence: FluxStore & { getStatus(userId: Id): string; getActivities(userId: Id): AnyRecord[] }
  // friend nicknames
  Relationship: FluxStore & {
    getNickname(userId: Id): string | undefined
    isBlocked(userId: Id): boolean
    // incoming friend requests
    getPendingCount(): number
  }
  // ms left before the next message may be sent (type 0: messages)
  Slowmode: FluxStore & { getSlowmodeCooldownGuess(channelId: Id, type?: number): number }
  Permission: FluxStore & { can(permission: bigint, context: AnyRecord): boolean }
  // levels (message_notifications): 0 all messages, 1 mentions, 2 nothing, 3 the default; unread settings: 0 unset,
  // 1 all messages, 2 mentions; overrides by channel: { muted, mute_config.end_time, message_notifications, flags }
  UserGuildSettings: FluxStore & {
    isMuted(guildId: Id): boolean
    isChannelMuted(guildId: Id, channelId: Id): boolean
    getChannelMuteConfig(guildId: Id, channelId: Id): AnyRecord | null
    getChannelOverrides(guildId: Id): Record<Id, AnyRecord>
    getChannelMessageNotifications(guildId: Id, channelId: Id): number
    getMessageNotifications(guildId: Id): number
    resolveUnreadSetting(channel: AnyRecord): number
    getChannelUnreadSetting(guildId: Id, channelId: Id): number
    getGuildUnreadSetting(guildId: Id): number
    getChannelIdFlags(guildId: Id, channelId: Id): number
    useNewNotifications: boolean
  }
  GuildMember: FluxStore & { getMember(guildId: Id, userId: Id): AnyRecord | null }
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
  PendingReply: FluxStore & { getPendingReply(channelId: Id): AnyRecord | undefined }
  // a reply's message, if loaded: { state, message }
  ReferencedMessage: FluxStore & { getMessageByReference(ref: AnyRecord): AnyRecord & { message?: AnyRecord | null } }
  // intention 0: for a reaction. Emoji: { id, name, surrogates, url, animated }
  Emoji: FluxStore & {
    searchWithoutFetchingLatest(opts: { channel: AnyRecord; query: string; count: number; intention: number }): {
      unlocked: AnyRecord[]
    }
    readonly emojiReactionFrecencyWithoutFetchingLatest: { frequently: AnyRecord[] }
    readonly emojiFrecencyWithoutFetchingLatest: { frequently: AnyRecord[] }
    getUsableGuildEmoji(guildId: Id): AnyRecord[]
    // the picker's: favorites, the most used, every server's custom emoji by server
    getDisambiguatedEmojiContext(guildId?: Id): {
      readonly favoriteEmojisWithoutFetchingLatest: AnyRecord[]
      getFrequentlyUsedEmojisWithoutFetchingLatest(): AnyRecord[]
      getGroupedCustomEmoji(): Map<Id, AnyRecord[]>
    }
  }
  // the frecency settings proto: { favoriteGifs: { gifs: { [url]: { src, width, height, format, order } } },
  // favoriteStickers?: { stickerIds } }
  UserSettingsProto: FluxStore & { readonly frecencyWithoutFetchingLatest: AnyRecord; getFullState(): AnyRecord }
  // the most used stickers
  StickersPersisted: FluxStore & {
    readonly stickerFrecencyWithoutFetchingLatest: { frequently: AnyRecord[] }
    hasPendingUsage(): boolean
  }
  // files staged for the next message (draft type 0: the channel's composer); { id, filename, ... }
  UploadAttachment: FluxStore & { getUploads(channelId: Id, draftType: number): AnyRecord[] }
  // "MEMBERS" while the member list is open (isPrivate false for a guild channel)
  ChannelSection: FluxStore & { getSection(channelId: Id, isPrivate: boolean): string }
  // { groups, rows }: GROUP rows { title, count }, MEMBER rows { userId, nick, colorString, status, user }, empty
  // slots for rows not subscribed to
  ChannelMember: FluxStore & { getProps(guildId: Id, channelId: Id): AnyRecord }
  // who reacted, by user id; the first read fetches them (type 0: normal reactions)
  MessageReactions: FluxStore & {
    getReactions(channelId: Id, messageId: Id, emoji: AnyRecord, limit: number, type: number): Map<Id, AnyRecord>
  }
  SelfPresence: FluxStore & { getStatus(): string }
  // a getter: "/channels/@me" (its lastViewedPath isn't used for it)
  DefaultRoute: FluxStore & { readonly defaultRoute: string }
}

export interface Actions {
  dispatcher: {
    dispatch(action: AnyRecord & { type: string }): void
    subscribe(type: string, listener: (action: AnyRecord) => void): void
    unsubscribe(type: string, listener: (action: AnyRecord) => void): void
    _actionHandlers: AnyRecord
  }
  flux: { connectStores: unknown; Store: { getAll(): FluxStore[] } }
  react: { createElement(type: unknown, props?: AnyRecord | null, ...children: unknown[]): unknown; useEffect: unknown }
  messages: {
    sendMessage(channelId: Id, message: AnyRecord, waitForReady?: boolean, options?: AnyRecord): Promise<unknown>
    sendStickers(channelId: Id, stickerIds: Id[], content?: string, options?: AnyRecord): Promise<unknown>
    editMessage(channelId: Id, messageId: Id, message: AnyRecord): Promise<unknown>
    // local: only the client's copy (a failed send)
    deleteMessage(channelId: Id, messageId: Id, local?: boolean): Promise<unknown>
    // sendMessage's options for a pending reply: messageReference, allowedMentions
    getSendMessageOptionsForReply(reply: AnyRecord | undefined): AnyRecord
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
    jumpToMessage(opts: {
      channelId: Id
      messageId: Id
      flash?: boolean
      offset?: number
      context?: string
      returnMessageId?: Id
    }): void
    // edit mode, kept in EditMessageStore. startEditMessageRecord is what stock's Up and its menu's Edit call
    startEditMessageRecord(channelId: Id, message: AnyRecord): void
    updateEditMessage(channelId: Id, textValue: string): void
    endEditMessage(channelId: Id, response?: unknown): void
  }
  // the composer's text to a message and back: @name, #channel and :emoji: become ids
  parser: {
    parse(channel: AnyRecord, text: string): AnyRecord & { content: string }
    unparse(text: string, channelId: Id, ...rest: unknown[]): string
  }
  drafts: {
    saveDraft(channelId: Id, draft: string, draftType: number): void
    changeDraft(channelId: Id, draft: string, draftType: number): void
  }
  // the composer's reply state (PendingReplyStore)
  replies: {
    create(options: {
      message: AnyRecord
      channel: AnyRecord
      shouldMention: boolean
      showMentionToggle: boolean
    }): void
    remove(channelId: Id): void
    mention(channelId: Id, on: boolean): void
  }
  // location: where it came from, as stock names it ("Message Inline Button" for a chip, "Message Context Menu")
  reactions: {
    add(channelId: Id, messageId: Id, emoji: AnyRecord, location?: string): Promise<void>
    remove(opts: { channelId: Id; messageId: Id; emoji: AnyRecord; location?: string }): Promise<void>
  }
  uploads: {
    addFiles(opts: AnyRecord): void
    remove(channelId: Id, id: string, draftType: number): void
    clearAll(channelId: Id, draftType: number): void
  }
  promptToUpload: { prompt(files: File[], channel: AnyRecord, draftType: number): Promise<void> }
  // stock's autocomplete queries. Mentions: users as { user, nick }, roles as records, globals as { text }
  autocomplete: {
    queryMentionResults(opts: { query: string; channel: AnyRecord; canMentionEveryone?: boolean; request?: boolean }): {
      users: AnyRecord[]
      roles: AnyRecord[]
      globals: AnyRecord[]
    }
    queryChannelResults(opts: { query: string; channel: AnyRecord }): { channels: AnyRecord[] }
    queryEmojiResults(opts: { query: string; channel: AnyRecord; intention: number; maxCount?: number }): {
      emojis: { unlocked: AnyRecord[] }
    }
  }
  guilds: { toggleGuildFolderExpand(folderId: number): void }
  // reason: the analytics label stock passes ("muted", "unmuted")
  notifications: {
    updateGuildNotificationSettings(guildId: Id, settings: AnyRecord, reason?: string): void
    // label: the analytics label stock passes ("muted", "unmuted")
    updateChannelOverrideSettings(opts: {
      guildId: Id
      channelId: Id
      settings: AnyRecord
      label?: string
      location?: string
    }): void
  }
  // location: where stock's menu says the ack came from
  acks: {
    markRead(channel: AnyRecord, location?: string): void
    ack(channelId: Id, location?: AnyRecord | string): void
  }
  voice: { selectVoiceChannel(channelId: Id | null): void; disconnect(): void }
  // play: a sound of the user's soundpack at a volume (stock's UI sounds at 0.4)
  sounds: {
    forPack(name: string, soundpack: string): { play(): void; loop(): void; stop(): void }
    play(name: string, volume: number): void
  }
  calls: {
    // video, ring; recipientId: a 1:1 DM's user (stock checks the call is allowed first)
    call(channelId: Id, video: boolean, ring: boolean, recipientId?: Id): void
    ring(channelId: Id, recipients?: Id[]): void
    stopRinging(channelId: Id, recipients?: Id[]): Promise<unknown>
  }
  // sendability: 0 sendable, 1 with Nitro, 2 not, 3 with a boosted server
  stickers: {
    fetchPacks(): void
    sendability(sticker: AnyRecord, user: AnyRecord | undefined, channel: AnyRecord | undefined): number
  }
  // the unicode emoji by category: people, nature, food, activity, travel, objects, symbols, flags
  unicodeEmoji: { getCategories(): string[]; getByCategory(category: string): AnyRecord[] }
  // type: the kind of result (Search, Category, Trending), for stock's analytics
  gifs: {
    initialize(): void
    trendingCategories(): void
    trending(limit: number): void
    search(query: string, type: string, immediate?: boolean, limit?: number): void
    clear(): void
    select(opts: AnyRecord): void
  }
  // sounds are { soundId, guildId ("0": Discord's), name, emojiId, emojiName, volume, available }; play's locations is
  // its analytics location stack
  soundboard: {
    play(sound: AnyRecord, channelId: Id, locations: string[]): void
    canUse(user: AnyRecord | undefined, sound: AnyRecord, channel: AnyRecord, needAvailable?: boolean): boolean
    canPlay(channel: AnyRecord): boolean
  }
  soundboardSounds: { fetch(): Promise<unknown> }
  // stock's loading screen's animated logo, the dark theme's
  spinner: { webm: string }
  video: {
    stream(streamId: string): MediaStream | undefined
    watch(streamId: string): void
    unwatch(streamId: string): void
  }
  // stock's message search, from its lazy chunks (loaded the first time): fetchMessages runs a search (stock's parser
  // reads from:, in:, has: and the rest out of searchQueryString) into SearchMessageStore under the context's id
  search: {
    load(): Promise<{
      fetchMessages(opts: {
        searchContext: AnyRecord
        searchQueryString: string
        pagination: { offset: number }
        searchMode: string
        searchEverywhere: boolean
        searchAnalyticsIds: null
        onFetchStart?: () => void
      }): void
      clearSearchMessages(id: Id): void
    }>
  }
  // undefined for a type it has no text for
  systemMessages: { stringify(message: AnyRecord): string | undefined }
  // an invite by code: resolve (no write) gives { invite: { code, guild, channel, approximate_*_count } }; accepting
  // joins and opens the channel it points to
  invites: {
    resolveInvite(code: string, location?: string): Promise<{ invite?: AnyRecord; code: string }>
    acceptInviteAndTransitionToInviteChannel(opts: { inviteKey: string; context?: AnyRecord }): Promise<unknown>
  }
  channelInfo(guildId: Id): void
  rest: Record<
    'del' | 'get' | 'patch' | 'post' | 'put',
    (opts: {
      url: string
      body?: AnyRecord
      query?: AnyRecord
      retries?: number
      oldFormErrors?: boolean
      rejectWithError?: boolean
    }) => Promise<AnyRecord>
  >
  endpoints: {
    PIN(channelId: Id, messageId: Id): string
    PINS(channelId: Id): string
    MESSAGE_ACK(channelId: Id, messageId: Id): string
  }
  readStates: { countsAsMention(message: AnyRecord, user: AnyRecord): boolean }
  audio: {
    // the camera (stock's: MEDIA_ENGINE_SET_VIDEO_ENABLED)
    setVideoEnabled(on: boolean): void
    toggleSelfMute(): Promise<void>
    toggleSelfDeaf(): void
    setInputDevice(id: string): void
    setOutputDevice(id: string): void
    // the voice settings (local to this client, MediaEngineStore): input 0-100, output 0-200
    setInputVolume(volume: number): void
    setOutputVolume(volume: number): void
    // mode: VOICE_ACTIVITY or PUSH_TO_TALK; options: getModeOptions() with changes (autoThreshold, threshold in dB)
    setMode(mode: string, options: AnyRecord): void
    setNoiseSuppression(on: boolean): void
    // Krisp
    setNoiseCancellation(on: boolean): void
    setEchoCancellation(on: boolean): void
    setAutomaticGainControl(on: boolean): void
  }
  // push to talk held (true) or released: with the media engine (MediaEngineStore.getMediaEngine())
  ptt: { set(engine: unknown, active: boolean, priority?: boolean): void }
  markGuildsRead(guildIds: Id[], source: string): void
  channelSections: { toggleMembersSection(): void; toggleUserProfileSidebarSection(): void }
  memberSubscriptions: {
    range(opts: { guildId: Id; channelId: Id; y: number; height: number; rowHeight: number }): void
  }
  // stock's status picker: writes the status user setting (it syncs to every client)
  setStatus(options: { nextStatus: string; prevStatus?: string; durationMillis?: number }): Promise<void>
  // which Go Live resolution and frame rate the user and the server's boost level allow (screen-capture)
  canStreamWithSettings(preset: number, resolution: number, fps: number, user: unknown, tier?: number): boolean
  goLive: { start(guildId: Id | null, channelId: Id, analyticsLocations: string[]): void }
  // feedback: stock's stream feedback prompt after it ends
  // streamKey: "guild:{guildId}:{channelId}:{ownerId}" or "call:{channelId}:{ownerId}"
  streams: {
    stopOwn(feedback?: boolean): void
    watch(stream: AnyRecord, opts?: { noFocus?: boolean }): void
    stop(streamKey: string, feedback?: boolean): void
  }
  // stock's login actions: each dispatches its result (LOGIN_MFA_STEP, LOGIN_SUCCESS, LOGIN_FAILURE...) and rejects
  // with the request's error (its fields' messages) on a failure
  auth: {
    login(opts: { login: unknown; password: unknown; source: null }): Promise<void>
    loginMFAv2(opts: {
      code: string
      ticket: string
      mfaType: string
      loginInstanceId: string | null
      source: null
    }): Promise<void>
  }
  nav: {
    transitionTo(path: string, state?: AnyRecord): void
    transitionToGuild(guildId: Id, channelId?: Id): void
    replaceWith(path: string): void
  }
  // stock's page size: the messages that fit the window's height (at least 10, at most 30), from its window size,
  // density and font size; the argument is only a label
  pages: { size(label?: string): number }
  markdown: { parseToAST(text: string, inline?: boolean, state?: AnyRecord): AnyRecord[] }
  frecencySettings: { loadIfNecessary(): Promise<void> }
  // a unicode emoji's image (Discord's SVG)
  emojis: { getURL(surrogate: string): string; sanitizeEmojiName: unknown }
  // stock's text: `t` maps a message's key to its message, in the current locale
  intl: {
    intl: {
      currentLocale: string
      string(message: unknown): string
      formatToPlainString(message: unknown, values: AnyRecord): string
    }
    t: Record<string, unknown> & { $$loader: { messages: Record<string, Record<string, unknown>> } }
    international: unknown
  }
  // a message's key: xxhash64 of its name, the first 6 bytes in base64
  messageKey: { runtimeHashMessageKey(name: string): string }
  // moment-style formats in the user's locale and 12/24 h setting; calendar(date, true) is a message's timestamp
  dates: { calendar(date: Date, short?: boolean): string; format(date: Date, format: string): string }
  names: { acronym(name: string | null | undefined): string }
  // a group DM's icon, its default one when it has none
  icons: {
    getChannelIconURL(opts: { id: Id; icon?: string | null; applicationId?: Id; size?: number }): string
    // undefined when the guild has none
    getGuildIconURL(opts: { id: Id; icon: string | null; size: number; canAnimate?: boolean }): string | undefined
  }
}
