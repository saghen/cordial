// The line under a name in a list (members, DMs): the custom status's emoji and text, or what they're doing. Built
// again only when that line changes, not on every presence update (the PresenceStore changes for anyone's)

import { createMemo } from 'solid-js'

import * as profiles from '../api/profiles'
import type { Id } from '../api/types'
import { Emoji } from './emoji'

type Line = profiles.StatusLine

const same = (prev: Line | undefined, next: Line | undefined) =>
  prev?.text === next?.text && prev?.emoji?.id === next?.emoji?.id && prev?.emoji?.name === next?.emoji?.name

// a row's subtitle for a user, or nothing for none
export function useStatusLine(userId: () => Id | undefined) {
  const line = createMemo(
    () => {
      const id = userId()
      return id ? profiles.statusLine(id) : undefined
    },
    { equals: same },
  )
  return createMemo(() => {
    const current = line()
    return current && <StatusLine line={current} />
  })
}

function StatusLine(p: { line: Line }) {
  return (
    <>
      {p.line.emoji && <Emoji emoji={p.line.emoji} />}
      {p.line.text}
    </>
  )
}
