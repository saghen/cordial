// A message's link embeds, as Discord's record keeps what its servers scraped (OpenGraph, oEmbed): a card with the
// text, a small thumbnail beside it or a large image under it; an image or GIF link is just the media. No players: a
// video is its thumbnail, opening the page.

import { A } from "../adapter/core";
import { renderAST } from "./lib/content";

type Media = { url: string; proxyURL?: string; width: number; height: number; };
type Embed = Record<string, any> & { type: string; url?: string; thumbnail?: Media; image?: Media; video?: Media; };

const TYPES = new Set(["link", "article", "video", "rich", "image", "gifv"]);

// scaled to fit, from the media proxy at that size (Discord's transform drops media without a size)
export const fit = (m: Media, w: number, h: number) => {
    const s = Math.min(1, w / m.width, h / m.height);
    return { width: Math.round(m.width * s), height: Math.round(m.height * s) };
};
// the box an image fits: embeds' media, a thumbnail, a sent image (larger, but GIFs stay at embeds' size)
const BOX = { media: [400, 300], thumb: [80, 80], sent: [550, 350] } as const;
export const img = (m: Media, box: keyof typeof BOX, open?: string) => {
    const isGif = !!m.proxyURL && /\.gif(\?|$)/i.test(m.url), thumb = box === "thumb";
    const [w, h] = BOX[isGif && box === "sent" ? "media" : box], { width, height } = fit(m, w, h);
    const src = m.proxyURL ? `${m.proxyURL}${m.proxyURL.includes("?") ? "&" : "?"}width=${width}&height=${height}` : m.url;
    return <img class={{ media: true, thumb }} alt="" width={width} height={height} loading="lazy" {...(isGif ? gif(src) : { src })}
        onClick={open ? () => window.open(open) : undefined} />;
};

// as stock's default: GIFs play only while the window is focused. GIF videos pause; GIF images swap to a still from
// the media proxy (format=webp is its first frame)
const gifs = (play: boolean) => {
    document.querySelectorAll<HTMLVideoElement>("video[loop]").forEach(v => play ? v.play() : v.pause());
    document.querySelectorAll<HTMLImageElement>("img[data-anim]").forEach(i => i.src = play ? i.dataset.anim! : i.dataset.still!);
};
addEventListener("focus", () => gifs(true));
addEventListener("blur", () => gifs(false));
export const gif = (src: string) => {
    const still = `${src}&format=webp`;
    return { src: document.hasFocus() ? src : still, "data-anim": src, "data-still": still };
};

const markdown = (text: string): any[] => A.markdown.parseToAST(text, true, { allowLinks: true, allowList: true });

export const embed = (e: Embed) => {
    if (!TYPES.has(e.type)) return null;
    // media only, as stock: a GIF, or an image or video with no title or author
    if ((e.image || e.video) && (e.type === "gifv" || e.type !== "rich" && !e.author && !e.rawTitle)) {
        if (e.video?.proxyURL) {
            const { width, height } = fit(e.video, 400, 300);
            return e.type === "gifv"
                ? <video class="media" autoplay={document.hasFocus()} muted loop playsinline width={width} height={height} poster={e.thumbnail?.proxyURL} src={e.video.proxyURL} />
                : <video class="media" controls preload="metadata" width={width} height={height} src={e.video.proxyURL} />;
        }
        const m = e.image ?? e.thumbnail;
        return m ? img(m, "media") : null;
    }
    const big = e.image ?? (e.video && e.thumbnail), small = !e.video && e.thumbnail;
    // as stock: no description for YouTube (youtu.be, shorts, music. and m. included)
    const text = e.provider?.name !== "YouTube" && !/\b(youtube(-nocookie)?\.com|youtu\.be)\//.test(e.url ?? "") && e.rawDescription;
    if (!e.rawTitle && !text && !e.author && !big && !small) return null;
    return <figure style={e.color ? { "border-left-color": e.color } : undefined}>
        {e.provider && <small>{e.provider.name}</small>}
        {e.author && <b>{e.author.name}</b>}
        {e.rawTitle && <a href={e.url} target="_blank" rel="noreferrer noopener">{e.rawTitle}</a>}
        {text && <p ref={p => renderAST(markdown(text), p)} />}
        {small && img(small, "thumb")}
        {big && img(big, "media", e.url)}
    </figure>;
};
