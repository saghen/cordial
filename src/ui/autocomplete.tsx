// Autocomplete for the composer: `@` users and roles, `#` channels, `:` emoji (two letters at least, as stock), from
// stock's own queries. One list above the box; Up and Down move, Tab or Enter put the pick in the box as text the
// parser turns back into a mention, Escape closes.

import { createEffect, createMemo, createSignal, For } from "solid-js";

import { A, S } from "../adapter/core";
import type { Rec } from "../adapter/discord";

interface Item { text: string; label: string; icon?: string; }

const MENTION_EVERYONE = 131072n;
const TOKEN = /(?:^|\s)([@#:])([^\s@#:]*)$/;

export function createAutocomplete(box: () => HTMLTextAreaElement, channel: () => Rec | undefined) {
    const [token, setToken] = createSignal<{ kind: string; query: string; at: number; } | null>(null);
    const [sel, setSel] = createSignal(0);
    let menu!: HTMLMenuElement;

    const items = createMemo((): Item[] => {
        const t = token(), c = channel();
        if (!t || !c) return [];
        if (t.kind === "@") {
            // as stock's box: @everyone, @here and every role with the permission to mention everyone
            const everyone = !c.isPrivate() && S.Permission.can(MENTION_EVERYONE, c);
            const r = A.autocomplete.queryMentionResults({ query: t.query, channel: c, canMentionEveryone: everyone, request: true });
            return [
                ...r.users.map((u: Rec) => ({ text: `@${u.user.username}`, label: u.nick ?? u.user.globalName ?? u.user.username, icon: u.user.getAvatarURL(c.guild_id, 32) })),
                ...r.roles.map((role: Rec) => ({ text: `@${role.name}`, label: `@${role.name}` })),
                ...r.globals.filter((g: Rec) => g.text === "@everyone" || g.text === "@here").map((g: Rec) => ({ text: g.text, label: g.text }))
            ].slice(0, 10);
        }
        if (t.kind === "#") return A.autocomplete.queryChannelResults({ query: t.query, channel: c }).channels
            .slice(0, 10).map((ch: Rec) => ({ text: `#${ch.name}`, label: `#${ch.name}` }));
        if (t.query.length < 2) return [];
        return A.autocomplete.queryEmojiResults({ query: t.query, channel: c, intention: 3, maxCount: 10 }).emojis.unlocked
            .map((e: Rec) => ({ text: `:${e.name}:`, label: `:${e.name}:`, icon: e.url ?? undefined }));
    });

    // after each input: the token the caret ends
    const update = () => {
        const b = box(), m = TOKEN.exec(b.value.slice(0, b.selectionStart));
        setToken(m ? { kind: m[1], query: m[2], at: b.selectionStart - m[2].length - 1 } : null);
        setSel(0);
    };
    // open while there's something to pick (writes apply in a microtask: read them in an effect)
    createEffect(() => items().length > 0, open => {
        if (open) menu.showPopover();
        else if (menu.matches(":popover-open")) menu.hidePopover();
    });

    const pick = (item: Item) => {
        const b = box(), t = token()!;
        b.setRangeText(`${item.text} `, t.at, b.selectionStart, "end");
        b.dispatchEvent(new Event("input", { bubbles: true }));
        b.focus();
    };

    // true when the key was the list's
    const key = (e: KeyboardEvent) => {
        const n = items().length;
        if (!n || !menu.matches(":popover-open")) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") setSel((sel() + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        else if (e.key === "Tab" || e.key === "Enter") pick(items()[sel()]);
        else if (e.key === "Escape") menu.hidePopover();
        else return false;
        e.preventDefault();
        return true;
    };

    const view = <menu ref={menu} data-mc="autocomplete" popover="manual">
        <For each={items()}>{(item, i) =>
            <button data-mc={`complete:${item.text}`} class={{ sel: i() === sel() }}
                onPointerDown={e => e.preventDefault()} onClick={() => pick(item)}>
                {item.icon ? <img alt="" src={item.icon} /> : null}{item.label}
            </button>
        }</For>
    </menu>;

    return { view, update, key };
}
