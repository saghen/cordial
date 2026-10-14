// Image sizes on Discord's CDN: the smallest of stock's at twice the shown size, for sharp images on a 2x screen
const SIZES = [16, 20, 22, 24, 28, 32, 40, 44, 48, 56, 60, 64, 80, 96, 100, 128, 160, 240, 256, 300, 320, 480, 512]
export const size = (px: number) => SIZES.find((candidate) => candidate >= px * 2) ?? 512
