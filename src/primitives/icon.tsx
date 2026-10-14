// One of Discord's icons (icons.ts) as an element.

import type { IconName } from './icons'

export const Icon = (p: { name: IconName }) => <i class="icon" style={{ '--icon': `var(--icon-${p.name})` }} />
