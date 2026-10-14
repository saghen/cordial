// A camera's or a watched stream's video by its stream id: the web engine's stream, viewed while shown (as stock's
// Video component)

import { createEffect } from 'solid-js'

import * as streams from '../api/streams'

export function Video(p: { id: string }) {
  const video = (<video autoplay muted playsinline />) as HTMLVideoElement
  createEffect(
    () => p.id,
    (id) => {
      const view = streams.view(id)
      video.srcObject = view.stream
      return () => {
        view.close()
        video.srcObject = null
      }
    },
  )
  return video
}
