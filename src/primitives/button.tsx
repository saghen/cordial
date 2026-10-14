// Buttons: text in one of stock's variants (Button; secondary unless given), an icon with its title (IconButton), and
// one that switches something on and off (Toggle), its icon and title following the state as stock's do (Mute and
// Unmute).

import { omit } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { Icon } from './icon'
import type { IconName } from './icons'

type ButtonAttributes = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'children'>

export function Button(
  p: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'positive' | 'danger' | 'secondary' | 'link'
  },
) {
  const rest = omit(p, 'variant', 'class')
  return <button {...rest} class={['button', p.variant ?? 'secondary', p.class]} />
}

export function IconButton(p: ButtonAttributes & { icon: IconName; title: string }) {
  const rest = omit(p, 'icon', 'class')
  return (
    <button {...rest} class={['icon-button', p.class]}>
      <Icon name={p.icon} />
    </button>
  )
}

export function Toggle(
  p: ButtonAttributes & { on: boolean; icon: IconName; onIcon?: IconName; title: string; onTitle?: string },
) {
  const rest = omit(p, 'on', 'icon', 'onIcon', 'title', 'onTitle', 'class')
  return (
    <IconButton
      {...rest}
      class={[p.class, { on: p.on }]}
      aria-pressed={p.on ? 'true' : 'false'}
      icon={p.on ? (p.onIcon ?? p.icon) : p.icon}
      title={p.on ? (p.onTitle ?? p.title) : p.title}
    />
  )
}
