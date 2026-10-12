/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Message list on Discord's own React (ROADMAP 0.6 variant "react"): our components, Discord's React, so the variant
// costs no bundle. Rows are memoized on their (immutable) message record, the equivalent of list-dom.ts's row cache.
// Each store change renders synchronously (flushSync), so onShown fires in the same task as the DOM variant's.

import { createRoot, React, ReactDOM } from "@equicord/types/webpack/common";
import type { Root } from "react-dom/client";

import { S } from "../adapter/core";
import type { Id, Rec } from "../adapter/discord";
import { renderAST } from "./content-react";
import type { ListFactory } from "./list";
import { authorOf, contentAST, Message, messagesOf, startsGroup, when } from "./model";
import { createScroller } from "./scroller";

interface RowProps { m: Message; head: boolean; channelId: Id; guildId: Id | null; }

function Content({ m, channelId }: { m: Message; channelId: Id; }) {
    const system = m.type !== 0 && m.type !== 19;
    return <div className={system ? "mc-content mc-system" : "mc-content"}>
        {system ? m.content || `(message type ${m.type})` : renderAST(contentAST(m, channelId))}
        {m.editedTimestamp && <span className="mc-edited"> (edited)</span>}
    </div>;
}

function RowImpl({ m, head, channelId, guildId }: RowProps) {
    if (!head) return <div className="mc-msg" data-id={m.id}><Content m={m} channelId={channelId} /></div>;
    const a = authorOf(m, guildId);
    return <div className="mc-msg mc-head" data-id={m.id}>
        <img className="mc-avatar" src={a.avatar} alt="" loading="lazy" />
        <div className="mc-body">
            <div className="mc-meta">
                <span className="mc-name" data-mc={`author:${a.id}`} style={a.color ? { color: a.color } : undefined}>
                    {a.name}
                </span>
                <span className="mc-ts">{when(m.timestamp)}</span>
            </div>
            <Content m={m} channelId={channelId} />
        </div>
    </div>;
}

// React isn't resolved when this module loads (CLAUDE.md gotchas): memo on first use
let Row: React.ComponentType<RowProps> | null = null;

function List({ channelId, list, channel }: { channelId: Id; list: Message[]; channel: Rec | undefined; }) {
    const guildId = channel?.guild_id ?? null;
    const R = Row ??= React.memo(RowImpl);
    return <>{list.map((m, i) =>
        <R key={m.id} m={m} head={startsGroup(channel, list[i - 1], m)} channelId={channelId} guildId={guildId} />)}</>;
}

export const createReactList: ListFactory = (host, onShown) => {
    let channelId: Id | null = null;
    const { inner, rendered } = createScroller(host, () => channelId);
    let root: Root = createRoot(inner);
    let shown: unknown = null;

    function render() {
        const ms = channelId ? S.Message.getMessages(channelId) : null;
        if (ms === shown) return;
        const switched = (shown as any)?.channelId !== channelId;
        shown = ms;
        if (!channelId) {
            ReactDOM.flushSync(() => root.render(null));
            return;
        }
        const channel = S.Channel.getChannel(channelId);
        const id = channelId;
        ReactDOM.flushSync(() => root.render(<List channelId={id} list={messagesOf(id)} channel={channel} />));
        rendered(switched);
        if (ms!.ready) onShown(channelId);
    }

    S.Message.addChangeListener(render);

    return {
        show(id) {
            channelId = id;
            render();
        },
        reset() {
            root.unmount();
            root = createRoot(inner);
            shown = null;
        },
        dispose() {
            S.Message.removeChangeListener(render);
            root.unmount();
            host.replaceChildren();
        }
    };
};
