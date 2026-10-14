// Go Live through screen-capture (screen-capture/README.md): its renderer hooks are installed when this module is
// evaluated, before Discord's scripts; here they get Discord's pieces (host.discord, from the adapter's needs), the
// shell's cast IPC (host.native, src/shell/preload.js) and the codec order patch. capture is offered only when the
// adapter's check passed and the patch applied; otherwise getDisplayMedia is Chromium's own capture, as in stock. The
// picker (host.pick) is the voice panel's (views/user_panel.tsx).

import * as screen from '../../screen-capture/src/renderer'
import { G } from './anchor'
import { A, check, S } from './needs'
import { patch } from './webpack'

// an activity's type
const PLAYING = 0

const codecs = patch(screen.CODEC_PATCH.find, ...screen.CODEC_PATCH.replace)

screen.host.discord = {
  currentUser: () => S.User.getCurrentUser() as { id: string } | undefined,
  voiceGuildPremiumTier() {
    const channelId = S.SelectedChannel.getVoiceChannelId()
    const guildId = channelId ? S.Channel.getChannel(channelId)?.guild_id : undefined
    return guildId ? S.Guild.getGuild(guildId)?.premiumTier : undefined
  },
  connections: () => S.MediaEngine.getMediaEngine().connections,
  canStreamWithSettings: (...args) => A.canStreamWithSettings(...args),
  viewers() {
    const stream = S.ApplicationStreaming.getCurrentUserActiveStream()
    if (!stream) return 0
    const key = stream.guildId
      ? `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`
      : `call:${stream.channelId}:${stream.ownerId}`
    return S.ApplicationStreaming.getViewerIds(key).length
  },
  game() {
    const activity = S.LocalActivity.getPrimaryActivity()
    return activity?.type === PLAYING ? activity.name : null
  },
}

const native: typeof screen.host.native | undefined = (window as any).cordialNative?.cast
if (native)
  screen.host.native = {
    ...native,
    // (asked at Go Live, after the App's first render resolved the needs)
    available: () => (check().ok && codecs.applied ? native.available() : Promise.resolve(false)),
  }
screen.probeCaptureCodecs()

G.screen = screen
G.screenApplied = () => ({ codecs: codecs.applied })
