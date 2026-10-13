// A label in a pill: a count, LIVE, APP

import type { JSX } from '@solidjs/web'

export const Badge = (p: { kind: 'count' | 'live' | 'app'; children: JSX.Element }) => (
  <i class={['badge', p.kind]}>{p.children}</i>
)
