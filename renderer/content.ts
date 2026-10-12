/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's markdown AST (model.ts contentAST) to DOM. Node types as its parser emits them for message content;
// anything unknown renders its text, so a new node type degrades to plain text instead of disappearing.

type Node = Record<string, any> & { type: string; };

const TAGS: Record<string, string> = { strong: "strong", em: "em", u: "u", s: "s", subtext: "small" };

function children(parent: HTMLElement, content: unknown) {
    if (typeof content === "string") parent.append(content);
    else if (Array.isArray(content)) renderAST(content, parent);
    return parent;
}

function el(tag: string, cls?: string) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
}

function text(n: Node): string {
    if (typeof n.content === "string") return n.content;
    if (Array.isArray(n.content)) return n.content.map(text).join("");
    return "";
}

export function renderAST(nodes: Node[], parent: HTMLElement) {
    for (const n of nodes) {
        switch (n.type) {
            case "text":
                parent.append(n.content);
                break;
            case "strong": case "em": case "u": case "s": case "subtext":
                parent.append(children(el(TAGS[n.type], n.type === "subtext" ? "mc-subtext" : undefined), n.content));
                break;
            case "heading":
                parent.append(children(el(`h${Math.min(3, n.level)}`, "mc-h"), n.content));
                break;
            case "inlineCode":
                parent.append(children(el("code", "mc-code"), n.content));
                break;
            case "codeBlock": {
                const pre = el("pre", "mc-pre");
                pre.append(children(el("code"), n.content));
                parent.append(pre);
                break;
            }
            case "blockQuote":
                parent.append(children(el("blockquote", "mc-quote"), n.content));
                break;
            case "list": {
                const list = el(n.ordered ? "ol" : "ul", "mc-list");
                if (n.ordered && n.start != null) list.setAttribute("start", n.start);
                for (const item of n.items) list.append(children(el("li"), item));
                parent.append(list);
                break;
            }
            case "spoiler": {
                const s = children(el("span", "mc-spoiler"), n.content);
                s.onclick = () => s.classList.add("mc-shown");
                parent.append(s);
                break;
            }
            case "link": case "url": case "autolink": {
                const a = children(el("a", "mc-link"), n.content) as HTMLAnchorElement;
                a.href = n.target;
                a.target = "_blank";
                a.rel = "noreferrer noopener";
                parent.append(a);
                break;
            }
            case "emoji": case "customEmoji": {
                const img = el("img", "mc-emoji") as HTMLImageElement;
                img.alt = n.name ?? n.surrogate ?? "";
                img.draggable = false;
                img.src = n.src ?? `https://cdn.discordapp.com/emojis/${n.emojiId}.${n.animated ? "gif" : "webp"}?size=48`;
                parent.append(img);
                break;
            }
            case "mention": case "channelMention": case "roleMention": {
                const m = el("span", "mc-mention");
                m.textContent = n.type === "channelMention" ? `#${text(n)}` : text(n);
                if (n.roleColor) m.style.color = `#${n.roleColor.toString(16).padStart(6, "0")}`;
                parent.append(m);
                break;
            }
            case "timestamp": {
                const t = el("time", "mc-time");
                t.textContent = n.formatted ?? text(n);
                parent.append(t);
                break;
            }
            case "br": case "newline":
                parent.append("\n");
                break;
            default:
                parent.append(text(n));
        }
    }
    return parent;
}
