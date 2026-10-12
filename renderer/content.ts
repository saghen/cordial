/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's markdown AST (model.ts contentAST) to DOM, imperatively: a message's content never changes (an edit
// replaces the record), so it needs no reactivity. Node types as its parser emits them for message content; anything
// unknown renders its text, so a new node type degrades to plain text instead of disappearing. Plain tags, styled
// by tag in style.ts.

type Node = Record<string, any> & { type: string; };

const TAGS: Record<string, string> = {
    strong: "strong", em: "em", u: "u", s: "s", subtext: "small", inlineCode: "code", blockQuote: "blockquote",
    spoiler: "del", link: "a", url: "a", autolink: "a", mention: "mark", channelMention: "mark", roleMention: "mark",
    timestamp: "time"
};

const text = (n: Node): string =>
    typeof n.content === "string" ? n.content : Array.isArray(n.content) ? n.content.map(text).join("") : "";

function el(tag: string, content: unknown) {
    const e = document.createElement(tag) as HTMLElement & Record<string, any>;
    if (typeof content === "string") e.append(content);
    else if (Array.isArray(content)) renderAST(content, e);
    return e;
}

function node(n: Node): globalThis.Node | string {
    switch (n.type) {
        case "text": return n.content;
        case "br": case "newline": return "\n";
        case "heading": return el(`h${Math.min(3, n.level)}`, n.content);
        case "codeBlock": return el("pre", n.content);
        case "list": {
            const l = el(n.ordered ? "ol" : "ul", null);
            if (n.ordered && n.start != null) l.start = n.start;
            for (const item of n.items) l.append(el("li", item));
            return l;
        }
        case "emoji": case "customEmoji": {
            const img = el("img", null);
            img.alt = n.name ?? n.surrogate ?? "";
            img.src = n.src ?? `https://cdn.discordapp.com/emojis/${n.emojiId}.${n.animated ? "gif" : "webp"}?size=48`;
            return img;
        }
        case "mention": case "channelMention": case "roleMention": {
            const m = el("mark", (n.type === "channelMention" ? "#" : "") + text(n));
            if (n.roleColor) m.style.color = `#${n.roleColor.toString(16).padStart(6, "0")}`;
            return m;
        }
        case "timestamp": return el("time", n.formatted ?? text(n));
    }
    const tag = TAGS[n.type];
    if (!tag) return text(n);
    const e = el(tag, n.content);
    if (tag === "a") Object.assign(e, { href: n.target, target: "_blank", rel: "noreferrer noopener" });
    // a spoiler shows on click
    if (tag === "del") e.onclick = () => e.toggleAttribute("open", true);
    return e;
}

export function renderAST(nodes: Node[], parent: HTMLElement | DocumentFragment) {
    for (const n of nodes) parent.append(node(n));
    return parent;
}
