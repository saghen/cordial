// Everything the renderer uses from Discord, as a list of needs resolved at the App's first render: stores by name,
// action creators by props or code strings (minified names change every build, these don't), and action types we
// dispatch ourselves. If one is missing, the anchor shows Discord's own UI and the console names it.

import type { Actions, Stores } from './discord'
import { byCode as hasCode, byProps as hasProps, find, findModuleId, wreq } from './webpack'

export const S = {} as Stores
export const A = {} as Actions

interface Need {
  name: string
  what: string
  // why it failed, or null
  resolve(): string | null
}

const needs: Need[] = []

function storeNeed<K extends keyof Stores>(key: K, name: string, ...methods: (keyof Stores[K] & string)[]) {
  needs.push({
    name: `S.${key}`,
    what: `${name} { ${methods.join(', ')} }`,
    resolve() {
      // two stores can share a name (stock has two SearchMessageStores): the one with the methods
      const all: any[] = A.flux.Store.getAll().filter((store) => store.getName() === name)
      if (!all.length) return 'no store by that name'
      const store = all.find((candidate) => methods.every((method) => typeof candidate[method] === 'function'))
      if (!store) return `methods gone: ${methods.filter((method) => typeof all[0][method] !== 'function').join(', ')}`
      S[key] = store
      return null
    },
  })
}

function moduleNeed<K extends keyof Actions>(key: K, what: string, search: () => any) {
  needs.push({
    name: `A.${key}`,
    what,
    resolve() {
      const found = search()
      if (found == null) return 'no module matches'
      A[key] = found
      return null
    },
  })
}

const byProps = <K extends keyof Actions>(key: K, ...props: (keyof Actions[K] & string)[]) =>
  moduleNeed(key, `props ${props.join(', ')}`, () => find(hasProps(...props))?.[0])

const byCode = <K extends keyof Actions>(key: K, ...code: string[]) =>
  moduleNeed(key, `code ${code.map((snippet) => JSON.stringify(snippet)).join(' ')}`, () => find(hasCode(...code))?.[0])

// a module whose exports are all minified: found by one code string in its factory, members by their own
function mangled<K extends keyof Actions>(key: K, anchor: string, members: Record<keyof Actions[K] & string, string>) {
  moduleNeed(key, `module ${JSON.stringify(anchor)} { ${Object.keys(members).join(', ')} }`, () => {
    const id = findModuleId(anchor)
    if (id == null) return null
    const exports = wreq(id)
    const out: Record<string, any> = {}
    for (const [name, code] of Object.entries(members)) {
      const member = Object.values(exports).find(hasCode(code as string))
      if (member === undefined) return null
      out[name] = member
    }
    return out
  })
}

// an action type we dispatch ourselves: some store must still handle it
function dispatched(type: string, why: string) {
  needs.push({
    name: `dispatch ${type}`,
    what: why,
    resolve: () => (A.dispatcher._actionHandlers?._tokensByActionType?.[type]?.length ? null : 'no store handles it'),
  })
}

// first: the store needs look stores up through Flux, the dispatch needs through the dispatcher
byProps('dispatcher', 'dispatch', 'subscribe', 'unsubscribe', '_actionHandlers')
byProps('flux', 'connectStores', 'Store')
byProps('react', 'createElement', 'useEffect')

storeNeed('Gateway', 'GatewayConnectionStore', 'isConnected', 'isTryingToConnect')
storeNeed(
  'Auth',
  'AuthenticationStore',
  'isAuthenticated',
  'getId',
  'getLoginStatus',
  'getMFATicket',
  'getMFAMethods',
  'getLoginInstanceId',
)
storeNeed('User', 'UserStore', 'getCurrentUser', 'getUser')
storeNeed('Guild', 'GuildStore', 'getGuild')
storeNeed('SortedGuild', 'SortedGuildStore', 'getGuildFolders')
storeNeed('ExpandedGuildFolder', 'ExpandedGuildFolderStore', 'isFolderExpanded')
storeNeed('Channel', 'ChannelStore', 'getChannel')
storeNeed('GuildChannel', 'GuildChannelStore', 'getChannels')
storeNeed('PrivateChannelSort', 'PrivateChannelSortStore', 'getSortedChannels')
storeNeed('SelectedGuild', 'SelectedGuildStore', 'getGuildId')
storeNeed('SelectedChannel', 'SelectedChannelStore', 'getChannelId', 'getVoiceChannelId')
storeNeed('Message', 'MessageStore', 'getMessages', 'getMessage', 'getLastEditableMessage')
storeNeed(
  'ReadState',
  'ReadStateStore',
  'hasUnread',
  'getMentionCount',
  'getOldestUnreadMessageId',
  'getOldestUnreadTimestamp',
  'getUnreadCount',
  'isEstimated',
  'ackMessageId',
  'hasUnreadPins',
)
storeNeed(
  'GuildReadState',
  'GuildReadStateStore',
  'hasUnread',
  'getMentionCount',
  'getGuildHasUnreadIgnoreMuted',
  'getTotalMentionCount',
  'hasAnyUnread',
)
storeNeed('NotificationSettings', 'NotificationSettingsStore', 'getDisableUnreadBadge', 'isSoundDisabled')
storeNeed('Soundpack', 'SoundpackStore', 'getSoundpack')
storeNeed('Search', 'SearchMessageStore', 'getMessages', 'getTotalCount', 'getIsFetching', 'getError')
storeNeed('Soundboard', 'SoundboardStore', 'getSounds', 'isPlayingSound')
storeNeed('VideoStream', 'VideoStreamStore', 'getStreamId', 'getUserStreamData')
storeNeed('ChannelPins', 'ChannelPinsStore', 'getPins')
storeNeed('Stickers', 'StickersStore', 'getAllGuildStickers', 'getPremiumPacks', 'getStickerById', 'getStickerPack')
storeNeed('StickersPersisted', 'StickersPersistedStore', 'hasPendingUsage')
storeNeed('UserSettingsProto', 'UserSettingsProtoStore', 'getFullState')
storeNeed('GIFPickerView', 'GIFPickerViewStore', 'getResultItems', 'getTrendingCategories')
// the pins popout's fetch and ack (its chunk isn't loaded without stock's UI)
dispatched('LOAD_PINNED_MESSAGES_SUCCESS', 'the pins fetch, as stock')
dispatched('CHANNEL_PINS_ACK', "the pins popout's ack")
storeNeed('PrivateChannelReadState', 'PrivateChannelReadStateStore', 'getUnreadPrivateChannelIds')
storeNeed('Presence', 'PresenceStore', 'getStatus', 'getActivities')
storeNeed('Relationship', 'RelationshipStore', 'getNickname', 'isBlocked', 'getPendingCount')
storeNeed('Slowmode', 'SlowmodeStore', 'getSlowmodeCooldownGuess')
storeNeed('Permission', 'PermissionStore', 'can')
storeNeed(
  'UserGuildSettings',
  'UserGuildSettingsStore',
  'isMuted',
  'isChannelMuted',
  'getChannelMuteConfig',
  'getChannelOverrides',
  'getChannelMessageNotifications',
  'getMessageNotifications',
  'resolveUnreadSetting',
  'getChannelUnreadSetting',
  'getGuildUnreadSetting',
  'getChannelIdFlags',
)
storeNeed('GuildMember', 'GuildMemberStore', 'getMember')
storeNeed('Typing', 'TypingStore', 'getTypingUsers')
storeNeed('Draft', 'DraftStore', 'getDraft')
storeNeed('EditMessage', 'EditMessageStore', 'getEditingTextValue', 'getEditingMessageId')
storeNeed('CategoryCollapse', 'CategoryCollapseStore', 'isCollapsed')
storeNeed('PendingReply', 'PendingReplyStore', 'getPendingReply')
storeNeed('ReferencedMessage', 'ReferencedMessageStore', 'getMessageByReference')
storeNeed('MessageReactions', 'MessageReactionsStore', 'getReactions')
storeNeed('Emoji', 'EmojiStore', 'searchWithoutFetchingLatest', 'getUsableGuildEmoji', 'getDisambiguatedEmojiContext')
byProps('unicodeEmoji', 'getCategories', 'getByCategory')
storeNeed('UploadAttachment', 'UploadAttachmentStore', 'getUploads')
storeNeed('ChannelSection', 'ChannelSectionStore', 'getSection')
storeNeed('ChannelMember', 'ChannelMemberStore', 'getProps')
storeNeed('VoiceState', 'VoiceStateStore', 'getVoiceStatesForChannel', 'isInChannel')
storeNeed('SortedVoiceState', 'SortedVoiceStateStore', 'countVoiceStatesForChannel')
storeNeed('GuildMediaState', 'GuildMediaStateStore', 'getGuildMediaState')
storeNeed('Speaking', 'SpeakingStore', 'isSpeaking', 'isCurrentUserPTTActive', 'isCurrentUserPrioritySpeaker')
storeNeed(
  'ApplicationStreaming',
  'ApplicationStreamingStore',
  'getAllActiveStreams',
  'getAllApplicationStreamsForChannel',
  'getCurrentUserActiveStream',
  'getViewerIds',
  'getStreamForUser',
  'getActiveStreamForUser',
)
storeNeed('GameConsole', 'GameConsoleStore', 'getAwaitingRemoteSessionInfo', 'getRemoteSessionId')
storeNeed('RTCConnection', 'RTCConnectionStore', 'getState', 'getChannelId', 'getWasEverRtcConnected', 'getUserIds')
storeNeed('Call', 'CallStore', 'getCall')
storeNeed('IncomingCall', 'IncomingCallStore', 'getIncomingCalls')
storeNeed('ChannelStatus', 'ChannelStatusStore', 'hasRequestedStatuses', 'getChannelStatus')
storeNeed('VoiceChannelStartTime', 'VoiceChannelStartTimeStore', 'getStartTime')
storeNeed('Frecency', 'FrecencyStore', 'getFrequentlyWithoutFetchingLatest')
storeNeed(
  'MediaEngine',
  'MediaEngineStore',
  'isSelfMute',
  'isSelfDeaf',
  'isSelfMutedTemporarily',
  'isVideoEnabled',
  'isNativeAudioPermissionReady',
  'shouldSkipMuteUnmuteSound',
  'notifyMuteUnmuteSoundWasSkipped',
  'getInputDevices',
  'getOutputDevices',
  'getInputDeviceId',
  'getOutputDeviceId',
  'getInputVolume',
  'getOutputVolume',
  'getMode',
  'getModeOptions',
  'getNoiseSuppression',
  'getNoiseCancellation',
  'getEchoCancellation',
  'getAutomaticGainControl',
  'isNoiseCancellationSupported',
  'getMediaEngine',
)
storeNeed('SelfPresence', 'SelfPresenceStore', 'getStatus')
storeNeed('LocalActivity', 'LocalActivityStore', 'getPrimaryActivity')
storeNeed('DefaultRoute', 'DefaultRouteStore')
needs.push({
  name: 'S.DefaultRoute.defaultRoute',
  what: "DefaultRouteStore.defaultRoute, where stock's /app route redirects",
  resolve: () => (typeof S.DefaultRoute?.defaultRoute === 'string' ? null : 'not a path'),
})

byProps(
  'messages',
  'sendMessage',
  'editMessage',
  'deleteMessage',
  'fetchMessages',
  'jumpToPresent',
  'jumpToMessage',
  'getSendMessageOptionsForReply',
  'sendStickers',
  'startEditMessageRecord',
  'updateEditMessage',
  'endEditMessage',
)
byProps('parser', 'parse', 'unparse')
byProps('drafts', 'saveDraft', 'changeDraft')
byProps('uploads', 'addFiles', 'remove', 'clearAll')
byProps('autocomplete', 'queryMentionResults', 'queryChannelResults', 'queryEmojiResults')
byProps('guilds', 'toggleGuildFolderExpand')
byProps('notifications', 'updateGuildNotificationSettings', 'updateChannelOverrideSettings')
// stock's Mark As Read for a channel (an immediate ack), or for a category (each channel and active thread in it); ack
// is the new messages bar's
mangled('acks', 'type:"CHANNEL_LOCAL_ACK"', { markRead: 'e.isCategory()?', ack: 'type:"CHANNEL_ACK"' })
// stock's Mark As Read for servers: every channel, thread and event read state up to its last message, as BULK_ACK
byCode('markGuildsRead', 'getActiveJoinedThreadsForGuild', 'GUILD_ONBOARDING_QUESTION')
byProps('voice', 'selectVoiceChannel', 'disconnect')
// DM calls: call selects the DM's voice and rings, stopRinging declines
byProps('calls', 'call', 'ring', 'stopRinging')
// stock's push to talk: the state (PUSH_TO_TALK_STATE_CHANGE: SpeakingStore, the ptt sounds) and each voice
// connection's forced input while active (its release delay is the connection's); the shell's global keybind holds it
mangled('ptt', 'type:"PUSH_TO_TALK_STATE_CHANGE",isActive', { set: 'setForceAudioInput(' })
// stock's sounds: a sound of the user's soundpack by name, with play, loop and stop (the ringtone); play plays one
mangled('sounds', '"SoundUtils"', { forPack: '(t)[e]??e', play: 'disableSounds)return' })
byProps('invites', 'resolveInvite', 'acceptInviteAndTransitionToInviteChannel')
// stock's login: email and password, then a two-factor code (its request layer asks for a captcha when needed)
byProps('auth', 'login', 'loginMFAv2')
// stock's sticker packs fetch (once), and its rule for which stickers you can send
moduleNeed(
  'stickers',
  'module "STICKER_PACKS_FETCH_START" { fetchPacks }, "SENDABLE_WITH_BOOSTED_GUILD" { sendability }',
  () => {
    const packs = findModuleId('type:"STICKER_PACKS_FETCH_START"')
    const rule = findModuleId('SENDABLE_WITH_BOOSTED_GUILD"')
    if (packs == null || rule == null) return null
    const fetchPacks = Object.values(wreq(packs)).find(hasCode('STICKER_PACKS_FETCH_START'))
    const sendability = Object.values(wreq(rule)).find((member) => typeof member === 'function')
    return fetchPacks && sendability ? { fetchPacks, sendability } : null
  },
)
// stock's GIF picker actions (GIFPickerViewStore keeps what they fetch)
mangled('gifs', 'type:"GIF_PICKER_INITIALIZE"', {
  initialize: 'GIF_PICKER_INITIALIZE',
  trendingCategories: 'GIF_PICKER_TRENDING_FETCH_SUCCESS',
  trending: 'GIFS_TRENDING_GIFS',
  search: 'GIF_PICKER_QUERY",query:e',
  clear: 'GIF_PICKER_QUERY",query:""',
  select: 'GIFS_SELECT',
})
// the web engine's video: a stream id's MediaStream, and its count of views (the first asks for the video, the last
// stops it), as its own Video component uses them
moduleNeed('video', 'modules ("VideoStream") { stream }, (?.(e,!0),i[e]=t+1) { watch, unwatch }', () => {
  const streams = findModuleId('("VideoStream")')
  const views = findModuleId('?.(e,!0),i[e]=t+1')
  if (streams == null || views == null) return null
  const functions = (id: string) =>
    Object.values(wreq(id)).filter((member) => typeof member === 'function') as Function[]
  const stream = functions(streams).find((member) => !/VideoStream|delete/.test(String(member)))
  const watch = functions(views).find((member) => String(member).includes('+1'))
  const unwatch = functions(views).find((member) => String(member).includes('--'))
  return stream && watch && unwatch ? { stream, watch, unwatch } : null
})
// stock's soundboard: play (its request, then the sound here), its rules for which sounds you can use and whether you
// can play in a channel, and its fetch of the sounds (Discord's over REST, the servers' over the gateway)
mangled('soundboard', 'SEND_SOUNDBOARD_SOUND(', {
  play: 'SEND_SOUNDBOARD_SOUND(',
  canUse: 'canUseSoundboardEverywhere',
  canPlay: 'suppress:',
})
mangled('soundboardSounds', 'type:"SOUNDBOARD_FETCH_DEFAULT_SOUNDS"', { fetch: 'REQUEST_SOUNDBOARD_SOUNDS' })
// stock's message search: its actions are in the chunks of the lazy "Search" component (its header's search bar),
// loaded as stock loads them, the first time
moduleNeed('search', 'the lazy "Search" component\'s chunks { load }', () => {
  const id = findModuleId('name:"Search",render')
  if (id == null) return null
  const src = String(wreq.m[id])
  const end = src.indexOf('name:"Search",render')
  const chunks = [...src.slice(src.lastIndexOf('Promise.all([', end), end).matchAll(/\.e\("(\w+)"\)/g)].map(
    (match) => match[1],
  )
  if (!chunks.length) return null
  let actions: any
  const load = async () => {
    await Promise.all(chunks.map((chunk) => wreq.e(chunk)))
    const exports = wreq(findModuleId('type:"SEARCH_MESSAGES_START"')!)
    return Object.values(exports).find((member: any) => typeof member?.fetchMessages === 'function')
  }
  return {
    load: () => {
      actions ??= load()
      return actions
    },
  }
})
// stock's text for a system message (joins, pins, boosts, calls...), as its notifications and reply previews use
moduleNeed('systemMessages', 'the system message formatter { stringify }', () => {
  const id = findModuleId('"234395307759108106":"https://groovy.bot/commands"')
  if (id == null) return null
  return Object.values(wreq(id)).find((member: any) => typeof member?.stringify === 'function')
})
// Discord's REST client and its endpoint paths: pins and Mark Unread are stock requests from its menu's chunk, which
// isn't loaded without its UI
moduleNeed(
  'rest',
  'the REST client: del, get, patch, post, put',
  () => find((candidate) => Object.keys(candidate).sort().join() === 'del,get,patch,post,put')?.[0],
)
byProps('endpoints', 'PIN', 'PINS', 'MESSAGE_ACK')
// whether a message counts towards a channel's mentions (suppress settings; every message in a DM)
mangled('readStates', '"ReadStateStore"', { countsAsMention: 'isSuppressRolesEnabled' })
byProps(
  'audio',
  'setVideoEnabled',
  'toggleSelfMute',
  'toggleSelfDeaf',
  'setInputDevice',
  'setOutputDevice',
  'setInputVolume',
  'setOutputVolume',
  'setMode',
  'setNoiseSuppression',
  'setNoiseCancellation',
  'setEchoCancellation',
  'setAutomaticGainControl',
)
// stock's voice rows: FETCH_CHANNEL_INFO and op 43 for a server's voice channel statuses, once until a resume
byCode('channelInfo', 'type:"FETCH_CHANNEL_INFO"', 'requestChannelInfo')
byProps('channelSections', 'toggleMembersSection', 'toggleUserProfileSidebarSection')
// stock's member list range helper: the rows in view, in pages of 100, as GUILD_SUBSCRIPTIONS_CHANNEL
mangled('memberSubscriptions', 'GUILD_SUBSCRIPTIONS_MEMBERS_REMOVE",guildId', { range: 'rowHeight' })
// stock's file chooser handler: size and count limits, then the files staged in UploadAttachmentStore
mangled('promptToUpload', 'Unexpected mismatch between files and file metadata', { prompt: 'requireConfirm' })
byCode('setStatus', 'nextStatus:', 'statusExpiresAtMs=')
byCode('canStreamWithSettings', 'location:"canStreamWithSettings"')
// stock's Go Live on the web engine: the stream settings by its rule, then getDisplayMedia (screen-capture's picker,
// views/user_panel.tsx), then the stream
mangled('goLive', '.getDesktopSource(', { start: 'getDesktopSource(' })
// a server's initials where it has no icon ("Mini Time" MT, "The Cat's Den" TCD)
mangled('names', '.replace(/\'s /g," ")', { acronym: ".replace(/'s /g" })
// stock's streams: ending your own, and watching and stopping others' (stop: STREAM_CLOSE, then STREAM_STOP, which
// keeps Discord's core from watching it again in a call)
mangled('streams', 'type:"STREAM_START"', {
  stopOwn: 'getCurrentUserActiveStream();null!=',
  watch: 'forceMultiple',
  stop: 'type:"STREAM_STOP"',
})
mangled('nav', 'transitionTo - Transitioning to', {
  transitionTo: 'transitionTo -',
  transitionToGuild: 'transitionToGuild -',
  replaceWith: 'Replacing route with',
})
mangled('replies', 'type:"CREATE_PENDING_REPLY"', {
  create: 'type:"CREATE_PENDING_REPLY"',
  remove: 'type:"DELETE_PENDING_REPLY"',
  mention: 'type:"SET_PENDING_REPLY_SHOULD_MENTION"',
})
mangled('reactions', 'REMOVE_EMOJI_REACTIONS(', {
  add: 'userHasReactedWithEmoji(',
  remove: '??"@me"',
})
mangled('pages', 'windowSize().height-145', { size: '.getSetting(),' })
byProps('markdown', 'parseToAST')
byProps('icons', 'getChannelIconURL', 'getGuildIconURL')
byProps('emojis', 'getURL', 'sanitizeEmojiName')
// stock's text (api/strings.ts): its messages by key, and the hash that makes a key from a message's name
byProps('intl', 'intl', 't', 'international')
byProps('messageKey', 'runtimeHashMessageKey')
// stock's date formats (api/strings.ts), its exports all minified
mangled('dates', '"DateUtils"', { calendar: '"L LT"', format: 'longFormatters' })
// the frecency user settings (proto type 2), which FrecencyStore ranks from: stock loads them when a picker opens
moduleNeed(
  'frecencySettings',
  'the settings proto manager of type 2 { loadIfNecessary }',
  () => find((candidate) => candidate?.type === 2 && typeof candidate.loadIfNecessary === 'function')?.[0],
)

dispatched('TYPING_START_LOCAL', 'typing: TypingStore throttles and POSTs /typing')
dispatched('TYPING_STOP_LOCAL', 'typing stops when the composer empties')
dispatched('CHANNEL_LOCAL_ACK', "Escape's read: ReadStateStore acks locally and clears the NEW line")
dispatched('ENABLE_AUTOMATIC_ACK', "acks: ReadStateStore acks the shown channel while it's at the bottom")
dispatched('DISABLE_AUTOMATIC_ACK', 'acks stop when the list leaves a channel')
dispatched(
  'CATEGORY_COLLAPSE',
  "a category's channels hide: CategoryCollapseStore, and a user guild setting (it syncs)",
)
dispatched('CATEGORY_EXPAND', "a category's channels show again")
needs.push({
  name: 'window id',
  what: 'window.__DISCORD_WINDOW_ID, the window acks are enabled for',
  resolve: () => (typeof (window as any).__DISCORD_WINDOW_ID === 'string' ? null : 'not set'),
})

// stock's messages that api/strings.ts names: an unknown name gives empty text instead of failing, so check them all
export function textNeed(names: readonly string[]) {
  needs.push({
    name: 'text',
    what: `${names.length} stock messages by name`,
    resolve() {
      const messages = A.intl.t.$$loader.messages[A.intl.intl.currentLocale]
      const gone = names.filter((name) => !(A.messageKey.runtimeHashMessageKey(name) in messages))
      return gone.length ? `gone: ${gone.join(', ')}` : null
    },
  })
}

let report: {
  ok: boolean
  took: number
  needs: number
  missing: { name: string; what: string; why: string }[]
} | null = null

// once: the result sticks
export function check() {
  if (report) return report
  const start = performance.now()
  const missing = needs.flatMap((need) => {
    let why: string | null
    try {
      why = need.resolve()
    } catch (err) {
      why = `threw: ${err}`
    }
    return why ? [{ name: need.name, what: need.what, why }] : []
  })
  report = { ok: !missing.length, took: Math.round(performance.now() - start), needs: needs.length, missing }
  return report
}
