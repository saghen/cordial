// One of Discord's icons (icons.ts) as an element.

import type { IconName } from './icons'

export function Icon(p: { name: IconName }) {
  return <i class="icon" style={{ '--icon': `var(--icon-${p.name})` }} />
}
