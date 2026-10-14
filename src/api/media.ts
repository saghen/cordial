// An image's actions, as stock's image menu: copied as an image (as PNG: the media proxy converts it), saved, its link
// copied. The shell does the first two (adapter/native.ts)

import { image } from '../adapter/native'

const png = (src: string) =>
  src.startsWith('https://media.discordapp.net/') ? `${src}${src.includes('?') ? '&' : '?'}format=png` : src
export const copyImage = (src: string) => image?.copy(png(src))
export const saveImage = (url: string) => image?.save(url)
export const copyLink = (url: string) => navigator.clipboard.writeText(url)
