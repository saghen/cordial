import { defineConfig } from 'vite'

// the code highlighter's worker (src/workers/highlight.ts) as its own file beside the bundle: the shell reads it when
// the first code block shows; its grammars stay unparsed until a block in their language
export default defineConfig({
  build: {
    lib: {
      entry: 'src/workers/highlight.ts',
      formats: ['iife'],
      name: 'cordialHighlight',
      fileName: () => 'highlight.js',
    },
    target: 'esnext',
    emptyOutDir: false,
  },
})
