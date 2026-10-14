// The UI's text: stock's, from its intl by message name, so it's localized and worded as stock's. A name is stock's
// (MARK_AS_READ): English text repeats across names, so pick the one stock's own call site uses. The self-check
// verifies every name in STOCK exists. Text stock doesn't have is ours, in OURS, so all of it is here. Dates use
// stock's formats too.

import { A, textNeed } from '../adapter/needs'

const STOCK = [
  'MARK_AS_READ',
  // the connection notice
  'CONNECTING',
  'RECONNECTING',
  'CONNECTION_STATUS_DISCONNECTED',
  // login
  'LOGIN_TITLE',
  'FORM_LABEL_EMAIL_OR_PHONE_NUMBER',
  'FORM_LABEL_PASSWORD',
  '_LOGIN',
  'MFA_V2_HEADER',
  'MFA_V2_TOTP',
  'MFA_V2_BACKUP',
  'MFA_V2_TOTP_NAME',
  'MFA_V2_BACKUP_NAME',
  'ERROR_OCCURRED_TRY_AGAIN',
  // the server bar
  'DIRECT_MESSAGES',
  'ADD_A_SERVER',
  'FORM_LABEL_INVITE_LINK',
  'INSTANT_INVITE_EXPIRED',
  'INSTANT_INVITE_GUILD_MEMBERS_ONLINE',
  'INSTANT_INVITE_GUILD_MEMBERS_TOTAL',
  'JOIN_SERVER',
  'MUTE_SERVER',
  'UNMUTE_SERVER',
  'COPY_ID_GUILD',
  // channels and DMs
  'GROUP_DM_MEMBER_COUNT',
  'MUTE_CHANNEL_GENERIC',
  'UNMUTE_CHANNEL_GENERIC',
  'MUTE_CATEGORY',
  'UNMUTE_CATEGORY',
  'COPY_LINK',
  'COPY_ID_CHANNEL',
  // notification settings
  'NOTIFICATION_SETTINGS',
  'MUTE_DURATION_15_MINUTES',
  'MUTE_DURATION_1_HOUR',
  'MUTE_DURATION_3_HOURS',
  'MUTE_DURATION_8_HOURS',
  'MUTE_DURATION_24_HOURS',
  'MUTE_DURATION_ALWAYS',
  'MUTED_UNTIL_TIME',
  'FORM_LABEL_DEFAULT',
  'FORM_LABEL_DEFAULT_CATEGORY',
  'FORM_LABEL_ALL_MESSAGES',
  'NOTIFICATION_PRESET_HYBRID',
  'FORM_LABEL_ONLY_MENTIONS_PLAIN',
  'FORM_LABEL_NOTHING',
  // messages and the chat
  'NEW',
  'MESSAGE_EDITED',
  'MESSAGE_FORWARDED',
  'REPLY_QUOTE_MESSAGE_DELETED',
  'REPLY_QUOTE_MESSAGE_NOT_LOADED',
  'REPLY_QUOTE_NO_TEXT_CONTENT',
  'APPLICATION_COMMAND_USED_SHORT',
  'SYSTEM_MESSAGE_CALL_STARTED_HOOK',
  'SYSTEM_MESSAGE_CALL_MISSED_HOOK',
  'SYSTEM_MESSAGE_CALL_STARTED_WITH_DURATION_HOOK',
  'SYSTEM_MESSAGE_CALL_MISSED_WITH_DURATION_HOOK',
  'BLOCKED_MESSAGE_COUNT',
  'IGNORED_MESSAGE_COUNT',
  'BLOCKED_MESSAGES_SHOW',
  'BLOCKED_MESSAGES_HIDE',
  'NEW_MESSAGES',
  'NEW_MESSAGES_WITH_DATE',
  'NEW_MESSAGES_ESTIMATED',
  'NEW_MESSAGES_ESTIMATED_WITH_DATE',
  'JUMP_TO_PRESENT',
  'JUMP',
  'RETRY',
  'DELETE',
  'OPEN_IN_BROWSER',
  'PINNED_MESSAGES',
  'NO_PINS_IN_CHANNEL',
  'NO_PINS_IN_DM',
  // the message menu
  'ADD_REACTION',
  'SEARCH_FOR_EMOJI',
  'EDIT_MESSAGE',
  'MESSAGE_ACTION_REPLY',
  'COPY_TEXT',
  'PIN_MESSAGE',
  'UNPIN_MESSAGE',
  'MARK_UNREAD',
  'COPY_MESSAGE_LINK',
  'DELETE_MESSAGE',
  // the composer
  'TEXTAREA_PLACEHOLDER',
  'NO_SEND_MESSAGES_PERMISSION_PLACEHOLDER',
  'GUILD_COMMUNICATION_DISABLED_BOTTOM_SHEET_TITLE',
  'CHANNEL_SLOWMODE_COOLDOWN',
  'REPLYING_TO',
  'REPLY_MENTION_ON',
  'REPLY_MENTION_OFF',
  'CHAT_ATTACH_UPLOAD_A_FILE',
  'REMOVE',
  'ONE_USER_TYPING',
  'TWO_USERS_TYPING',
  'THREE_USERS_TYPING',
  'SEVERAL_USERS_TYPING',
  // autocomplete
  'MEMBERS',
  'MEMBERS_MATCHING',
  'TEXT_CHANNELS',
  'TEXT_CHANNELS_MATCHING',
  'EMOJI',
  'EMOJI_MATCHING',
  'MENTION_USERS_WITH_ROLE',
  // voice, calls and the user panel
  'CONNECTION_STATUS_VOICE_CONNECTED',
  'CONNECTION_STATUS_NO_ROUTE',
  'CONNECTION_STATUS_RTC_DISCONNECTED',
  'CONNECTION_STATUS_AUTHENTICATING',
  'CONNECTION_STATUS_RTC_CONNECTING',
  'CONNECTION_STATUS_ICE_CHECKING',
  'CONNECTION_STATUS_DTLS_CONNECTING',
  'CONNECTION_STATUS_CONNECTING',
  'CAMERA_ON',
  'CAMERA_OFF',
  'SHARE_YOUR_SCREEN',
  'STOP_STREAMING',
  'SOUNDBOARD_OPEN_SOUNDBOARD',
  'VOICE_SETTINGS',
  'DISCONNECT_SELF',
  'MUTE',
  'UNMUTE',
  'DEAFEN',
  'UNDEAFEN',
  'FORM_LABEL_INPUT_DEVICE',
  'FORM_LABEL_OUTPUT_DEVICE',
  'FORM_LABEL_INPUT_VOLUME',
  'FORM_LABEL_OUTPUT_VOLUME',
  'FORM_LABEL_INPUT_MODE',
  'FORM_LABEL_AUTOMATIC_VAD',
  'FORM_LABEL_INPUT_SENSITIVTY',
  'INPUT_MODE_VAD',
  'INPUT_MODE_PTT',
  'NOISE_SUPPRESSION',
  'ECHO_CANCELLATION',
  'AUTOMATIC_GAIN_CONTROL',
  'JOIN_VOICE',
  'JOIN_CALL',
  'JOIN_VIDEO_CALL',
  'WATCH_STREAM',
  'STOP_WATCHING',
  'START_VOICE_CALL',
  'START_VIDEO_CALL',
  'INCOMING_CALL_ELLIPSIS',
  'ACCEPT',
  'DECLINE',
  'STATUS_ONLINE',
  'STATUS_IDLE',
  'STATUS_DND',
  'STATUS_INVISIBLE',
  'PLAYING_GAME',
  'STREAMING',
  'LISTENING_TO',
  'WATCHING',
  'COMPETING',
  'DEFAULT',
] as const
textNeed(STOCK)

const OURS = {
  LOGGING_IN: 'Logging in…',
  LOGIN_DISCORDS: "Use Discord's login screen",
  LOGIN_DISCORDS_STEP: "Discord's login screen continues from here.",
  LOGIN_DISCORDS_MFA: "This account's two-factor needs Discord's login screen.",
  NOT_SENT: 'Not sent.',
  CONFIRM_DELETE: 'Click again to delete',
  EDITING: 'Editing: Enter saves, Escape cancels',
  // stock's text, under a name we haven't found
  ALL_LIVE_STAGES: 'All Live Stages',
  LOAD_MORE: 'Load More',
  BLOCKED_DM: 'You cannot send messages to a user you have blocked.',
  CANCEL_REPLY: 'Cancel reply',
  KRISP: 'Krisp',
}

const keys = new Map<string, string>()

// stock's message, or ours; one with parameters needs its values ('TEXTAREA_PLACEHOLDER', { channel: '#general' })
export function text(name: (typeof STOCK)[number] | keyof typeof OURS, values?: Record<string, unknown>) {
  if (name in OURS) return OURS[name as keyof typeof OURS]
  let key = keys.get(name)
  if (!key) keys.set(name, (key = A.messageKey.runtimeHashMessageKey(name)))
  const message = A.intl.t[key]
  return values ? A.intl.intl.formatToPlainString(message, values) : A.intl.intl.string(message)
}

// stock's message around elements: each value or hook named in `slots` comes back as its index, between the text
// ('APPLICATION_COMMAND_USED_SHORT', {}, ['userHook', 'commandHook'] gives [0, ' used ', 1]), for the caller to put
// its element there. A hook's own text (`$[{username}](usernameHook)`) gives way to the element
export function textAround(name: (typeof STOCK)[number], values: Record<string, unknown>, slots: string[]) {
  const all = { ...values }
  slots.forEach((slot, i) => (all[slot] = slot.endsWith('Hook') ? () => `\u0001${i}\u0001` : `\u0001${i}\u0001`))
  return text(name, all)
    .split(/\u0001(\d+)\u0001/)
    .map((part, i) => (i % 2 ? Number(part) : part))
    .filter((part) => part !== '')
}

// DateUtils, in the user's 12/24 h setting: a message's timestamp ("10:59 PM", "Yesterday at 10:59 PM",
// "5/31/24, 11:15 AM"), the clock ("10:59 PM"), the date divider ("May 31, 2024") and the timestamp's tooltip
// ("Friday, May 31, 2024 10:59 PM")
export const when = (d: Date) => A.dates.calendar(d, true)
export const clock = (d: Date) => A.dates.format(d, 'LT')
export const day = (d: Date) => A.dates.format(d, 'LL')
export const full = (d: Date) => A.dates.format(d, 'LLLL')
