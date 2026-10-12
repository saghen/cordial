/*
 * mincord: Discord's core with our own renderer
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's markdown AST to React elements: content.ts for the React list variant, node for node.

import { useState } from "@equicord/types/webpack/common";
import type { ReactNode } from "react";

type Node = Record<string, any> & { type: string; };

function text(n: Node): string {
    if (typeof n.content === "string") return n.content;
    if (Array.isArray(n.content)) return n.content.map(text).join("");
    return "";
}

function children(content: unknown): ReactNode {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return renderAST(content);
    return null;
}

function Spoiler({ content }: { content: unknown; }) {
    const [shown, setShown] = useState(false);
    return <span className={shown ? "mc-spoiler mc-shown" : "mc-spoiler"} onClick={() => setShown(true)}>
        {children(content)}
    </span>;
}

function node(n: Node, key: number): ReactNode {
    switch (n.type) {
        case "text": return n.content;
        case "strong": return <strong key={key}>{children(n.content)}</strong>;
        case "em": return <em key={key}>{children(n.content)}</em>;
        case "u": return <u key={key}>{children(n.content)}</u>;
        case "s": return <s key={key}>{children(n.content)}</s>;
        case "subtext": return <small key={key} className="mc-subtext">{children(n.content)}</small>;
        case "heading": {
            const H = `h${Math.min(3, n.level)}` as "h1";
            return <H key={key} className="mc-h">{children(n.content)}</H>;
        }
        case "inlineCode": return <code key={key} className="mc-code">{children(n.content)}</code>;
        case "codeBlock": return <pre key={key} className="mc-pre"><code>{children(n.content)}</code></pre>;
        case "blockQuote": return <blockquote key={key} className="mc-quote">{children(n.content)}</blockquote>;
        case "list": {
            const items = n.items.map((item: unknown, i: number) => <li key={i}>{children(item)}</li>);
            return n.ordered
                ? <ol key={key} className="mc-list" start={n.start ?? undefined}>{items}</ol>
                : <ul key={key} className="mc-list">{items}</ul>;
        }
        case "spoiler": return <Spoiler key={key} content={n.content} />;
        case "link": case "url": case "autolink":
            return <a key={key} className="mc-link" href={n.target} target="_blank" rel="noreferrer noopener">
                {children(n.content)}
            </a>;
        case "emoji": case "customEmoji":
            return <img key={key} className="mc-emoji" alt={n.name ?? n.surrogate ?? ""} draggable={false}
                src={n.src ?? `https://cdn.discordapp.com/emojis/${n.emojiId}.${n.animated ? "gif" : "webp"}?size=48`} />;
        case "mention": case "channelMention": case "roleMention":
            return <span key={key} className="mc-mention"
                style={n.roleColor ? { color: `#${n.roleColor.toString(16).padStart(6, "0")}` } : undefined}>
                {n.type === "channelMention" ? `#${text(n)}` : text(n)}
            </span>;
        case "timestamp": return <time key={key} className="mc-time">{n.formatted ?? text(n)}</time>;
        case "br": case "newline": return "\n";
        default: return text(n);
    }
}

export function renderAST(nodes: Node[]): ReactNode[] {
    return nodes.map(node);
}
