// A region that survives an error in it: the error logged, the region built again a moment later. Without one, an
// uncaught error in an effect halts every update (Solid 2), and the whole UI stops following the stores.

import { Errored } from 'solid-js'
import type { JSX } from '@solidjs/web'

// long enough that an error on every build doesn't spin, short enough to pass for a flicker
const RETRY_MS = 250

export function Guard(p: { children: JSX.Element }) {
  return (
    <Errored
      fallback={(error, reset) => {
        console.error(error())
        setTimeout(reset, RETRY_MS)
        return null
      }}
    >
      {p.children}
    </Errored>
  )
}
