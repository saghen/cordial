// Discord's records as the UI reads them: its record classes (ChannelRecord, MessageRecord, UserRecord...), typed
// only as far as we use them. A field or method added here must exist on Discord's record; the stores hand these out
// (adapter/discord.ts types the stores themselves).

import type { Id } from '../adapter/discord'

export type { Id }

// ChannelTypes
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
}

// MessageTypes (the ones the UI names; USER_MESSAGE in model.ts lists those shown as user messages)
export const enum MessageType {
  Default = 0,
  Call = 3,
  Reply = 19,
  ChatInputCommand = 20,
}

// permission bits, as BigInt flags
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

// DMs and group DMs (PrivateChannelRecord): guild channels have none of these
export interface PrivateChannel extends Channel {
  // the other users' ids
  recipients: Id[]
  icon: string | null
  // a DM's other user
  getRecipientId(): Id | undefined
}

export interface User {
  id: Id
  username: string
  globalName: string | null
  bot: boolean
  premiumType?: number | null
  getAvatarURL(guildId?: Id | null, size?: number): string
}

export interface Member {
  userId: Id
  nick: string | null
  colorString: string | null
  communicationDisabledUntil?: string | null
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
}

export interface Emoji {
  id: Id | null
  name: string
  animated?: boolean
  surrogates?: string
  guildId?: Id
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
  embeds: Record<string, any>[]
  reactions: Reaction[]
  stickerItems?: { id: Id; name: string; format_type: number }[]
  messageReference?: { channel_id: Id; message_id: Id; guild_id?: Id } | null
  messageSnapshots?: { message: Message }[]
  interaction?: Record<string, any> | null
  interactionMetadata?: Record<string, any> | null
  isCommandType(): boolean
}
