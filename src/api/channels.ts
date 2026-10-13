// Channels and DMs: which to open, and opening them.

import { A, S } from '../adapter/needs'
import type { Id } from '../adapter/discord'

// the DM last open, as stock's DMs button
export const lastDm = () => S.SelectedChannel.getChannelId('@me')
// the DMs, at a DM or the friends page
export const openDms = (id?: Id | null) => A.nav.transitionTo(`/channels/@me${id ? `/${id}` : ''}`)
