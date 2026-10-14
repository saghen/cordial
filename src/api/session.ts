// The session: the gateway connection, the app badge, and logging in on stock's actions (email and password, then a
// code when the account has two-factor). The steps stock's own screen takes over hand off to it.

import { createSignal } from 'solid-js'

import { G } from '../adapter/anchor'
import { A, S } from '../adapter/needs'
import { onAction } from './hooks'
import { $ } from './store'
import { text } from './strings'

// GatewayConnectionStore reads the socket and doesn't emit when it drops or comes back, so follow the actions (the
// socket's own state changes only after CONNECTION_INTERRUPTED). Undefined while connected
export function useConnection() {
  const [connected, setConnected] = createSignal(S.Gateway.isConnected())
  let once = connected()
  const on = (type: string, now: boolean) =>
    onAction(type, () => {
      once ||= now
      setConnected(now)
    })
  on('CONNECTION_OPEN', true)
  on('CONNECTION_RESUMED', true)
  on('CONNECTION_INTERRUPTED', false)
  on('CONNECTION_CLOSED', false)
  return () => {
    if (connected()) return undefined
    if (!S.Gateway.isTryingToConnect()) return text('CONNECTION_STATUS_DISCONNECTED')
    return text(once ? 'RECONNECTING' : 'CONNECTING')
  }
}

// stock's badge, in the window title as on the web: mentions and friend requests as "(N)", a dot for any other unread
export function badge() {
  const n = $.GuildReadState.getTotalMentionCount() + $.Relationship.getPendingCount()
  if (n) return `(${n}) `
  return $.GuildReadState.hasAnyUnread() && !$.NotificationSettings.getDisableUnreadBadge() ? '• ' : ''
}

export const loggedIn = () => $.Auth.isAuthenticated()

// AuthenticationStore's login status: the code step, or one of the steps stock's own screen takes over
const status = () => $.Auth.getLoginStatus()
export const mfa = () => status() === 'MFA_STEP' || status() === 'LOGGING_IN_MFA'
const DISCORDS = [
  'ACCOUNT_SCHEDULED_FOR_DELETION',
  'ACCOUNT_DISABLED',
  'PHONE_IP_AUTHORIZATION',
  'PASSWORD_RECOVERY_PHONE_VERIFICATION',
]
export const discordsStep = () => DISCORDS.includes(status())

// the code kinds we take: an authenticator's, then backup codes
export type CodeKind = 'totp' | 'backup'
export const codeKinds = (): CodeKind[] =>
  mfa()
    ? $.Auth.getMFAMethods()
        .map((m) => m.type)
        .filter((t): t is CodeKind => t === 'totp' || t === 'backup')
    : []

export const login = (email: string, password: string) => A.auth.login({ login: email, password, source: null })

export const loginCode = (code: string, kind: CodeKind) =>
  A.auth.loginMFAv2({
    code: code.replace(/\s/g, ''),
    ticket: S.Auth.getMFATicket(),
    mfaType: kind,
    loginInstanceId: S.Auth.getLoginInstanceId(),
    source: null,
  })

// a failed request's error: its fields' messages, and its own
interface RequestError {
  fields?: Record<string, string[]>
  message?: string
}

// a failed request's text: the fields' messages (a wrong password, a new login location), else the error's
export function errorText(e: unknown): string {
  const error = e as RequestError | null | undefined
  return (
    Object.values(error?.fields ?? {})
      .flat()
      .join(' ') ||
    error?.message ||
    text('ERROR_OCCURRED_TRY_AGAIN')
  )
}

// stock's own login screen, for everything ours leaves to it
export const discordLogin = () => G.discordLogin()
