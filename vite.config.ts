import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'

export default defineConfig({
  plugins: [solid()],
  build: {
    lib: { entry: 'src/index.tsx', formats: ['iife'], name: 'cordialBundle', fileName: () => 'cordial.js' },
    target: 'esnext',
    minify: false,
  },
})
