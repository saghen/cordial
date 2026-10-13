// A message's time, as stock's: the timestamp, the full date on hover

import { full, when } from '../api/strings'

export const Time = (p: { at: Date }) => (
  <time class="ts" datetime={p.at.toISOString()} title={full(p.at)}>
    {when(p.at)}
  </time>
)
