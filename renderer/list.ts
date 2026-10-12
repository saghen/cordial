/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The message list's variants (ROADMAP 0.6), picked by window.name "mincord:list=NAME" so the lab can A/B them in one
// build. Each renders model.ts's view of a channel into `host`, and calls onShown(channelId) in the task that puts
// that channel's messages in the DOM (the renderer sets #mincord-root[data-view] from it).

import type { Id } from "../adapter/discord";
import { createDomList } from "./list-dom";

export interface MessageList {
    show(channelId: Id | null): void;
    // lab: forget everything built so far, so the next show() builds every row (lab/budgets.py --cold)
    reset(): void;
    dispose(): void;
}

export type ListFactory = (host: HTMLElement, onShown: (channelId: Id) => void) => MessageList;

const LISTS: Record<string, ListFactory> = {
    dom: createDomList
};

export function listVariant() {
    const want = /mincord:list=(\w+)/.exec(window.name)?.[1];
    return want && want in LISTS ? want : "dom";
}

export function createList(host: HTMLElement, onShown: (channelId: Id) => void) {
    return LISTS[listVariant()](host, onShown);
}

export const CSS = `
#mincord-root { --bg: #313338; --bg2: #2b2d31; --bg3: #1e1f22; --text: #dbdee1; --muted: #949ba4; --link: #00a8fc; }
.mc-scroller { height: 100%; overflow-y: auto; display: flex; flex-direction: column-reverse; overflow-anchor: none; }
.mc-messages { padding: 16px 0 8px; }
.mc-msg { padding: 2px 16px 2px 72px; position: relative; overflow-wrap: anywhere; }
.mc-msg.mc-head { margin-top: 16px; min-height: 44px; }
.mc-msg:hover { background: #2e3035; }
.mc-avatar { position: absolute; left: 16px; top: 4px; width: 40px; height: 40px; border-radius: 50%; }
.mc-meta { display: flex; gap: 8px; align-items: baseline; }
.mc-name { font-weight: 500; color: #f2f3f5; cursor: pointer; }
.mc-ts, .mc-edited { font-size: 12px; color: var(--muted); }
.mc-content { white-space: pre-wrap; line-height: 1.375; }
.mc-system { color: var(--muted); font-style: italic; }
.mc-h { margin: 8px 0 0; line-height: 1.25; } h1.mc-h { font-size: 24px; } h2.mc-h { font-size: 20px; } h3.mc-h { font-size: 16px; }
.mc-subtext { display: block; font-size: 12px; color: var(--muted); }
.mc-code { font: 85% ui-monospace, monospace; background: var(--bg2); border-radius: 4px; padding: 0 3px; }
.mc-pre { font: 14px/1.3 ui-monospace, monospace; background: var(--bg2); border: 1px solid var(--bg3); border-radius: 4px; padding: 8px; margin: 4px 0; white-space: pre-wrap; }
.mc-quote { margin: 0; padding-left: 12px; border-left: 4px solid #4e5058; }
.mc-list { margin: 4px 0; padding-left: 24px; white-space: normal; list-style: disc; } ol.mc-list { list-style: decimal; }
.mc-content em { font-style: italic; } .mc-content strong { font-weight: 700; }
.mc-spoiler { background: #1e1f22; color: transparent; border-radius: 4px; cursor: pointer; }
.mc-spoiler.mc-shown { background: #404249; color: inherit; }
.mc-link { color: var(--link); text-decoration: none; } .mc-link:hover { text-decoration: underline; }
.mc-emoji { width: 22px; height: 22px; vertical-align: bottom; object-fit: contain; }
.mc-mention { background: rgba(88, 101, 242, .3); color: #c9cdfb; border-radius: 3px; padding: 0 2px; }
.mc-time { background: rgba(255, 255, 255, .06); border-radius: 3px; padding: 0 2px; }
`;
