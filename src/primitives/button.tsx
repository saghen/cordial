// Buttons: an icon with its title (IconButton), and one that switches something on and off (Toggle), its icon and
// title following the state as stock's do (Mute and Unmute).

import { omit } from 'solid-js'
import type { JSX } from '@solidjs/web'

import { Icon } from './icon'
import type { IconName } from './icons'

type Attrs = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'children'>

export function IconButton(p: Attrs & { icon: IconName; title: string }) {
  const rest = omit(p, 'icon', 'class')
  return (
    <button {...rest} class={['icon-button', p.class]}>
      <Icon name={p.icon} />
    </button>
  )
}

export function Toggle(p: Attrs & { on: boolean; icon: IconName; onIcon?: IconName; title: string; onTitle?: string }) {
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
