// Logged out: our form on stock's login actions. Email and password, then a code when the account has two-factor
// (an authenticator's or a backup code). Stock's request layer shows its captcha when the server asks for one (a modal
// in Discord's layers, over ours) and retries. Everything else (passkeys, SMS codes, the QR code, a disabled account or
// a phone check, registering, a forgotten password) is Discord's own login screen, one click away.

import { createSignal, Show } from 'solid-js'

import { G } from '../adapter/anchor'
import { A, S } from '../adapter/needs'
import { $ } from '../api/store'
import { CSS } from '../style'

// the steps stock's own screen takes over (AuthenticationStore's login status)
const DISCORDS = [
  'ACCOUNT_SCHEDULED_FOR_DELETION',
  'ACCOUNT_DISABLED',
  'PHONE_IP_AUTHORIZATION',
  'PASSWORD_RECOVERY_PHONE_VERIFICATION',
]

// a failed request's text: the fields' messages (a wrong password, a new login location), else the error's
const say = (e: any) =>
  [...Object.values(e?.fields ?? {})].flat().join(' ') || e?.message || 'Something went wrong. Try again.'

export function Login() {
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const status = () => $.Auth.getLoginStatus()
  const mfa = () => status() === 'MFA_STEP' || status() === 'LOGGING_IN_MFA'
  // the code kinds we take: an authenticator's, then backup codes
  const kinds = () =>
    (mfa() ? $.Auth.getMFAMethods().map((m: any) => m.type) : []).filter((t: string) => t === 'totp' || t === 'backup')
  const [kind, setKind] = createSignal<string>()
  const mfaType = () => kind() ?? kinds()[0]
  const submit = async (e: SubmitEvent) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget as HTMLFormElement)
    setBusy(true)
    setError('')
    try {
      if (!mfa()) await A.auth.login({ login: f.get('email'), password: f.get('password'), source: null })
      else
        await A.auth.loginMFAv2({
          code: String(f.get('code')).replace(/\s/g, ''),
          ticket: S.Auth.getMFATicket(),
          mfaType: mfaType(),
          loginInstanceId: S.Auth.getLoginInstanceId(),
          source: null,
        })
    } catch (err) {
      setError(say(err))
    }
    setBusy(false)
  }
  return (
    <>
      <style>{CSS}</style>
      <form class="login" onSubmit={submit}>
        <h2>{mfa() ? 'Multi-Factor Authentication' : 'Welcome back!'}</h2>
        <Show
          when={mfa()}
          fallback={
            <>
              <label>
                Email or Phone Number
                <input class="login-email" name="email" type="text" autocomplete="username" required autofocus />
              </label>
              <label>
                Password
                <input
                  class="login-password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  required
                />
              </label>
            </>
          }
        >
          <Show when={mfaType()} fallback={<p>This account's two-factor needs Discord's login screen.</p>}>
            <label>
              {mfaType() === 'backup'
                ? 'Enter one of your 8-digit backup codes'
                : 'Enter the code from your authenticator app'}
              <input
                class="login-code"
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                required
                autofocus
              />
            </label>
            <Show when={kinds().length > 1}>
              <button
                type="button"
                class="login-kind"
                onClick={() => setKind(mfaType() === 'backup' ? 'totp' : 'backup')}
              >
                {mfaType() === 'backup' ? 'Use your authenticator app' : 'Use a backup code'}
              </button>
            </Show>
          </Show>
        </Show>
        <Show when={error() || DISCORDS.includes(status())}>
          <p role="alert">{error() || "Discord's login screen continues from here."}</p>
        </Show>
        <button class="login-submit" disabled={busy() || (mfa() && !mfaType())}>
          {busy() ? 'Logging in…' : 'Log In'}
        </button>
        <button type="button" class="login-discord" onClick={() => G.discordLogin()}>
          Use Discord's login screen
        </button>
      </form>
    </>
  )
}
