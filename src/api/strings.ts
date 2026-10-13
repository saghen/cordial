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
] as const
textNeed(STOCK)

const OURS = {
  LOGGING_IN: 'Logging in…',
  LOGIN_DISCORDS: "Use Discord's login screen",
  LOGIN_DISCORDS_STEP: "Discord's login screen continues from here.",
  LOGIN_DISCORDS_MFA: "This account's two-factor needs Discord's login screen.",
  // stock's text, under a name we haven't found
  ALL_LIVE_STAGES: 'All Live Stages',
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

// DateUtils, in the user's 12/24 h setting: a message's timestamp ("10:59 PM", "Yesterday at 10:59 PM",
// "5/31/24, 11:15 AM"), the clock ("10:59 PM"), the date divider ("May 31, 2024") and the timestamp's tooltip
// ("Friday, May 31, 2024 10:59 PM")
export const when = (d: Date) => A.dates.calendar(d, true)
export const clock = (d: Date) => A.dates.format(d, 'LT')
export const day = (d: Date) => A.dates.format(d, 'LL')
export const full = (d: Date) => A.dates.format(d, 'LLLL')
