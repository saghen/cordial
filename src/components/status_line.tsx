// The line under a name in a list (members, DMs): the custom status's emoji and text, or what they're doing

import type { StatusLine as Line } from '../api/profiles'
import { Emoji } from './emoji'

export function StatusLine(p: { line: Line }) {
  return (
    <>
      {p.line.emoji && <Emoji emoji={p.line.emoji} />}
      {p.line.text}
    </>
  )
}
