// A label in a pill: a count, LIVE, APP, NEW

import type { JSX } from '@solidjs/web'

export function Badge(p: { kind: 'count' | 'live' | 'app' | 'new'; children: JSX.Element }) {
  return <i class={['badge', p.kind]}>{p.children}</i>
}
