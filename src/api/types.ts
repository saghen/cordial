import type { Id } from '../adapter/discord'

export type { Id }

export const enum ChannelType {
  Text = 0,
  DM = 1,
  Voice = 2,
  GroupDM = 3,
  Category = 4,
  Announcement = 5,
  AnnouncementThread = 10,
  PublicThread = 11,
  PrivateThread = 12,
  Stage = 13,
  Directory = 14,
  Forum = 15,
  Media = 16,
  ThreadsOnly = 21,
}

export const enum MessageType {
  Default = 0,
  Call = 3,
  Reply = 19,
  ChatInputCommand = 20,
  ContextMenuCommand = 23,
  InteractionPremiumUpsell = 26,
  CustomGift = 41,
  VoiceHangoutInvite = 45,
  Changelog = 47,
  MediaMentionMessage = 68,
}

export const enum ActivityType {
  Playing = 0,
  Streaming = 1,
  Listening = 2,
  Watching = 3,
  Custom = 4,
  Competing = 5,
}

// stock's ReferencedMessageState: whether a reply's message is loaded
export const enum ReferencedMessageState {
  Loaded = 0,
  NotLoaded = 1,
  Deleted = 2,
}

// what an emoji is picked for: stock's search ranks and filters by it
export const enum EmojiIntention {
  Reaction = 0,
  Chat = 3,
}

// BigInt permission bit flags
export const Permission = {
  VIEW_CHANNEL: 1n << 10n,
  MANAGE_CHANNELS: 1n << 4n,
  ADD_REACTIONS: 1n << 6n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  PIN_MESSAGES: 1n << 51n,
} as const

export interface Channel {
  id: Id
  type: ChannelType
  name: string
  guild_id: Id | null
  parent_id: Id | null
  topic?: string
  nsfw?: boolean
  // slowmode, in seconds
  rateLimitPerUser?: number
  permissionOverwrites?: Record<Id, { id: Id; allow: bigint | string; deny: bigint | string }>
  isPrivate(): boolean
  isGuildVocal(): boolean
  isForumPost(): boolean
  getApplicationId(): Id | undefined
}

// DMs and group DMs
export interface PrivateChannel extends Channel {
  // everyone but you
  recipients: Id[]
  icon: string | null
}

export interface User {
  id: Id
  username: string
  globalName: string | null
  bot: boolean
  premiumType?: number | null
  // Nitro's display name style: a font, an effect, its colours (as numbers)
  displayNameStyles?: { fontId: number; effectId: number; colors: number[] } | null
  getAvatarURL(guildId?: Id | null, size?: number): string
}

export interface Member {
  userId: Id
  nick: string | null
  colorString: string | null
  communicationDisabledUntil?: string | null
  roles?: Id[]
}

export interface Guild {
  id: Id
  name: string
  icon: string | null
  premiumTier?: number
  afkChannelId: Id | null
}

export interface VoiceState {
  userId: Id
  channelId: Id
  mute: boolean
  deaf: boolean
  selfMute: boolean
  selfDeaf: boolean
  selfStream: boolean
  selfVideo: boolean
}

export interface Emoji {
  id: Id | null
  name: string
  animated?: boolean
  surrogates?: string
  guildId?: Id
}

export const enum StickerFormat {
  PNG = 1,
  APNG = 2,
  Lottie = 3,
  GIF = 4,
}

// a sticker: a server's (guild_id) or one of Discord's packs (pack_id)
export interface Sticker {
  id: Id
  name: string
  format_type: number
  tags?: string
  guild_id?: Id
  pack_id?: Id
}

// a GIF: a search result (id) or a favorite (none); src is an image or a video
export interface Gif {
  id?: string
  url: string
  src: string
  width: number
  height: number
}

export interface Attachment {
  url: string
  proxy_url: string
  filename: string
  size: number
  content_type?: string
  width?: number
  height?: number
}

export interface Reaction {
  emoji: { id: Id | null; name: string; animated?: boolean }
  count: number
  me: boolean
}

export interface Message {
  id: Id
  type: MessageType
  channel_id: Id
  content: string
  timestamp: Date
  editedTimestamp: Date | null
  author: User
  state: 'SENT' | 'SENDING' | 'SEND_FAILED'
  flags: number
  nonce?: string
  tts: boolean
  pinned: boolean
  mentioned: boolean
  mentions: Id[]
  mentionRoles: Id[]
  mentionEveryone: boolean
  blocked?: boolean
  ignored?: boolean
  webhookId?: Id | null
  applicationId?: Id | null
  additionalName?: string | null
  attachments: Attachment[]
  embeds: Embed[]
  reactions: Reaction[]
  stickerItems?: { id: Id; name: string; format_type: number }[]
  messageReference?: { channel_id: Id; message_id: Id; guild_id?: Id } | null
  messageSnapshots?: { message: Message }[]
  interaction?: Interaction | null
  interactionMetadata?: Interaction | null
  // a DM call's: who was in it, and its length as a moment duration
  call?: { participants: Id[]; duration?: { humanize(): string } | null }
  isCommandType(): boolean
}

// the command an app's message answers: its name and who used it
export interface Interaction {
  name?: string
  displayName?: string
  user: User
}

// a node of Discord's markdown AST: the fields the renderer reads, each set on the node types that carry it
export type MarkdownNode = {
  type: string
  content?: string | MarkdownNode[]
  level?: number
  ordered?: boolean
  start?: number
  items?: MarkdownNode[][]
  name?: string
  surrogate?: string
  src?: string
  emojiId?: Id
  animated?: boolean
  inContent?: MarkdownNode[]
  guildId?: Id
  channelId?: Id
  messageId?: Id
  roleColor?: number
  formatted?: string
  target?: string
  icon?: string
  iconType?: string
}

// an embed's media as the record keeps it
export interface EmbedMedia {
  url: string
  proxyURL?: string
  width: number
  height: number
}

// a link embed, as Discord's servers scraped it (OpenGraph, oEmbed)
export interface Embed {
  type: string
  url?: string
  rawTitle?: string
  rawDescription?: string
  color?: string
  provider?: { name: string }
  author?: { name: string }
  thumbnail?: EmbedMedia
  image?: EmbedMedia
  video?: EmbedMedia
}

// a resolved invite (the API's shape: snake case)
export interface Invite {
  code: string
  guild?: Pick<Guild, 'id' | 'name' | 'icon'>
  channel?: { id: Id; name?: string }
  approximate_presence_count?: number
  approximate_member_count?: number
}
