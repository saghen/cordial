// One of Discord's icons (icons.ts) as an element.

import type { IconName } from './icons'

export const Icon = (p: { name: IconName }) => <i class="icon" style={{ '--i': `var(--i-${p.name})` }} />
