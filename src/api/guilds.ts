// Servers: their names and icons, the server bar's folders and order, read states, the server menu's actions, and
// invites (a link's code, stock's resolve and accept).

import { A, S } from '../adapter/needs'
import type { Id } from '../adapter/discord'
import * as cdn from './cdn'
import type { Guild, Invite } from './types'
import { $ } from './store'

export const get = (id: Id) => $.Guild.getGuild(id) as Guild | undefined

// a server's icon at a size (none when it has none; an invite's server counts), playing when it's animated and asked
// to, else stock's initials
export const icon = (guild: Pick<Guild, 'id' | 'icon'>, px: number, animate = false) =>
  A.icons.getGuildIconURL({ id: guild.id, icon: guild.icon, size: cdn.size(px), canAnimate: animate })
export const acronym = (guild: Pick<Guild, 'name'>) => A.names.acronym(guild.name)

// the server bar: servers and folders in the user's order (a folder of one server is just the server)
export const folders = () => $.SortedGuild.getGuildFolders()
export type Folder = ReturnType<typeof folders>[number]
// expanding is ExpandedGuildFolderStore's (local)
export const folderOpen = (id: number) => $.ExpandedGuildFolder.isFolderExpanded(id)
export const toggleFolder = (id: number) => A.guilds.toggleGuildFolderExpand(id)

export const unread = (id: Id) => $.GuildReadState.hasUnread(id)
export const mentions = (id: Id) => $.GuildReadState.getMentionCount(id)
export const muted = (id: Id) => $.UserGuildSettings.isMuted(id)

// as stock's click: the channel Discord remembers for the server (persisted across restarts), else its default
export const lastChannel = (id: Id) => S.SelectedChannel.getChannelId(id) ?? undefined
export const open = (id: Id) => A.nav.transitionToGuild(id, lastChannel(id))

// the server menu
export const canMarkRead = (id: Id) => $.GuildReadState.getGuildHasUnreadIgnoreMuted(id)
export const markRead = (id: Id) => A.markGuildsRead([id], 'Guild List')
export const setMuted = (id: Id, on: boolean) =>
  A.notifications.updateGuildNotificationSettings(id, { muted: on }, on ? 'muted' : 'unmuted')

// an invite link's code (discord.gg/x, discord.com/invite/x) or a bare code
export const inviteCode = (text: string) =>
  text.trim().match(/(?:discord(?:app)?\.com\/invite|discord\.gg)\/([\w-]+)/)?.[1] ?? text.trim().match(/^[\w-]+$/)?.[0]
// the invite, or null when it's invalid or expired
export const resolveInvite = (code: string): Promise<Invite | null> =>
  A.invites.resolveInvite(code, 'Join Guild').then((result) => (result.invite as Invite | undefined) ?? null)
// joins and opens the invite's channel, as stock's Join a Server
export const acceptInvite = (invite: Invite) =>
  A.invites.acceptInviteAndTransitionToInviteChannel({
    inviteKey: invite.code,
    context: { location: 'Create or Join Guild Modal' },
  })
