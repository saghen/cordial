// Logged out: our form on stock's login actions (api/session.ts). Email and password, then a code when the account has
// two-factor (an authenticator's or a backup code). Stock's request layer shows its captcha when the server asks for
// one (a modal in Discord's layers, over ours) and retries. Everything else (passkeys, SMS codes, the QR code, a
// disabled account or a phone check, registering, a forgotten password) is Discord's own login screen, one click away.

import { createSignal, Show } from 'solid-js'

import * as session from '../api/session'
import { text } from '../api/strings'
import { TextField } from '../primitives/fields'
import { Button } from '../primitives/button'

export function Login() {
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [picked, setPicked] = createSignal<session.CodeKind>()
  const kind = () => picked() ?? session.codeKinds()[0]
  async function submit(e: SubmitEvent) {
    e.preventDefault()
    const form = new FormData(e.currentTarget as HTMLFormElement)
    setBusy(true)
    setError('')
    try {
      if (!session.mfa()) await session.login(String(form.get('email')), String(form.get('password')))
      else await session.loginCode(String(form.get('code')), kind()!)
    } catch (err) {
      setError(session.errorText(err))
    }
    setBusy(false)
  }
  return (
    <form class="login" onSubmit={submit}>
      <h2>{text(session.mfa() ? 'MFA_V2_HEADER' : 'LOGIN_TITLE')}</h2>
      <Show
        when={session.mfa()}
        fallback={
          <>
            <TextField
              label={text('FORM_LABEL_EMAIL_OR_PHONE_NUMBER')}
              class="login-email"
              name="email"
              type="text"
              autocomplete="username"
              required
              autofocus
            />
            <TextField
              label={text('FORM_LABEL_PASSWORD')}
              class="login-password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </>
        }
      >
        <Show when={kind()} fallback={<p>{text('LOGIN_DISCORDS_MFA')}</p>}>
          <TextField
            label={text(kind() === 'backup' ? 'MFA_V2_BACKUP' : 'MFA_V2_TOTP')}
            class="login-code"
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            required
            autofocus
          />
          <Show when={session.codeKinds().length > 1}>
            <Button
              type="button"
              variant="link"
              class="login-kind"
              onClick={() => setPicked(kind() === 'backup' ? 'totp' : 'backup')}
            >
              {text(kind() === 'backup' ? 'MFA_V2_TOTP_NAME' : 'MFA_V2_BACKUP_NAME')}
            </Button>
          </Show>
        </Show>
      </Show>
      <Show when={error() || session.discordsStep()}>
        <p role="alert">{error() || text('LOGIN_DISCORDS_STEP')}</p>
      </Show>
      <Button variant="primary" class="login-submit" disabled={busy() || (session.mfa() && !kind())}>
        {text(busy() ? 'LOGGING_IN' : '_LOGIN')}
      </Button>
      <Button type="button" variant="link" class="login-discord" onClick={session.discordLogin}>
        {text('LOGIN_DISCORDS')}
      </Button>
    </form>
  )
}
