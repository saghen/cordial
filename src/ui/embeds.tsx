// A message's link embeds, as Discord's record keeps what its servers scraped (OpenGraph, oEmbed): a card with the
// text, a small thumbnail beside it or a large image under it; an image or GIF link is just the media. No players: a
// video is its thumbnail, opening the page.

import { A } from "../adapter/core";
import { renderAST } from "./lib/content";

type Media = { url: string; proxyURL?: string; width: number; height: number; };
type Embed = Record<string, any> & { type: string; url?: string; thumbnail?: Media; image?: Media; video?: Media; };

const TYPES = new Set(["link", "article", "video", "rich", "image", "gifv"]);

// scaled to fit, from the media proxy at that size (Discord's transform drops media without a size)
const fit = (m: Media, w: number, h: number) => {
    const s = Math.min(1, w / m.width, h / m.height);
    return { width: Math.round(m.width * s), height: Math.round(m.height * s) };
};
const img = (m: Media, w: number, h: number, cls: string, open?: string) => {
    const { width, height } = fit(m, w, h);
    const src = m.proxyURL ? `${m.proxyURL}${m.proxyURL.includes("?") ? "&" : "?"}width=${width}&height=${height}` : m.url;
    return <img class={cls} alt="" width={width} height={height} loading="lazy" src={src} onClick={open ? () => window.open(open) : undefined} />;
};

const markdown = (text: string): any[] => A.markdown.parseToAST(text, true, { allowLinks: true, allowList: true });

export const embed = (e: Embed) => {
    if (!TYPES.has(e.type)) return null;
    // media only, as stock: a GIF, or an image or video with no title or author
    if ((e.image || e.video) && (e.type === "gifv" || e.type !== "rich" && !e.author && !e.rawTitle)) {
        if (e.video?.proxyURL) {
            const { width, height } = fit(e.video, 400, 300);
            return e.type === "gifv"
                ? <video class="media" autoplay muted loop playsinline width={width} height={height} poster={e.thumbnail?.proxyURL} src={e.video.proxyURL} />
                : <video class="media" controls preload="metadata" width={width} height={height} src={e.video.proxyURL} />;
        }
        const m = e.image ?? e.thumbnail;
        return m ? img(m, 400, 300, "media") : null;
    }
    const big = e.image ?? (e.video && e.thumbnail), small = !e.video && e.thumbnail;
    if (!e.rawTitle && !e.rawDescription && !e.author && !big && !small) return null;
    return <figure style={e.color ? { "border-left-color": e.color } : undefined}>
        {e.provider && <small>{e.provider.name}</small>}
        {e.author && <b>{e.author.name}</b>}
        {e.rawTitle && <a href={e.url} target="_blank" rel="noreferrer noopener">{e.rawTitle}</a>}
        {e.rawDescription && <p ref={p => renderAST(markdown(e.rawDescription), p)} />}
        {small && img(small, 80, 80, "media thumb")}
        {big && img(big, 400, 300, "media", e.url)}
    </figure>;
};
