// One of Discord's icons (icons.ts) as an element, with a tooltip when it stands alone.

import type { IconName } from './icons'

export function Icon(p: { name: IconName; title?: string }) {
  return <i class="icon" style={{ '--icon': `var(--icon-${p.name})` }} title={p.title} />
}
