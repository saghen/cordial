// Go Live through screen-capture (screen-capture/README.md): its renderer hooks are installed when this module is
// evaluated, before Discord's scripts; here they get Discord's pieces (host.discord), the shell's cast IPC
// (host.native, shell/preload.js) and the codec order patch. The picker (host.pick) is mincord's UI, not built yet:
// until then only a pending pick (mincord.screen.setPendingCast, the lab) streams through capture.

import * as screen from '../../screen-capture/src/renderer'
import { G } from './anchor'
import { S } from './core'
import { byCode, find, patch } from './webpack'

patch(screen.codecPatch.find, screen.codecPatch.replace)

let canStream: ((...a: any[]) => boolean) | null = null
screen.host.discord = {
  currentUser: () => S.User.getCurrentUser() as { id: string } | undefined,
  voiceGuildPremiumTier() {
    const channelId = (S.SelectedChannel as any).getVoiceChannelId()
    const guildId = channelId ? S.Channel.getChannel(channelId)?.guild_id : undefined
    return guildId ? S.Guild.getGuild(guildId)?.premiumTier : undefined
  },
  connections: () => (S.MediaEngine as any).getMediaEngine().connections,
  canStreamWithSettings: (...a) => (canStream ??= find(byCode('location:"canStreamWithSettings"'))?.[0] ?? null)!(...a),
}
screen.host.native = (window as any).mincordNative?.cast ?? null
G.screen = screen
