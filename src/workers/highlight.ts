// The code highlighter, a worker in its own bundle (dist/highlight.js, started by api/highlight.ts): Shiki with VS
// Code's grammars for the common languages, each loaded at its first block. A block comes back as its lines' HTML in
// the css-variables theme's colours (`var(--code-token-*)`, app.css); a language it doesn't know, as null.

import { createCssVariablesTheme, createHighlighterCore, type LanguageInput } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const LANGUAGES: Record<string, () => LanguageInput> = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  elixir: () => import('@shikijs/langs/elixir'),
  glsl: () => import('@shikijs/langs/glsl'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  haskell: () => import('@shikijs/langs/haskell'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  lua: () => import('@shikijs/langs/lua'),
  make: () => import('@shikijs/langs/make'),
  markdown: () => import('@shikijs/langs/markdown'),
  nix: () => import('@shikijs/langs/nix'),
  ocaml: () => import('@shikijs/langs/ocaml'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  svelte: () => import('@shikijs/langs/svelte'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
  zig: () => import('@shikijs/langs/zig'),
}
// what people write after ``` for them
const ALIASES: Record<string, string> = {
  'c++': 'cpp',
  bash: 'shellscript',
  cs: 'csharp',
  docker: 'dockerfile',
  ex: 'elixir',
  golang: 'go',
  h: 'c',
  hpp: 'cpp',
  hs: 'haskell',
  js: 'javascript',
  kt: 'kotlin',
  makefile: 'make',
  md: 'markdown',
  ml: 'ocaml',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'shellscript',
}

const THEME = createCssVariablesTheme({ name: 'cordial', variablePrefix: '--code-' })
const highlighter = createHighlighterCore({ themes: [THEME], langs: [], engine: createJavaScriptRegexEngine() })
const loading = new Map<string, Promise<void>>()
// the text's own colour, which the block already has: no span for it
const FOREGROUND = 'var(--code-foreground)'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escape = (text: string) => text.replace(/[&<>]/g, (character) => ESCAPES[character])

async function highlight(language: string, code: string) {
  const name = ALIASES[language.toLowerCase()] ?? language.toLowerCase()
  const load = LANGUAGES[name]
  if (!load) return null
  const shiki = await highlighter
  if (!loading.has(name)) loading.set(name, shiki.loadLanguage(load()))
  await loading.get(name)
  const { tokens } = shiki.codeToTokens(code, { lang: name, theme: 'cordial' })
  return tokens.map((line) =>
    line
      .map((token) =>
        token.color === FOREGROUND
          ? escape(token.content)
          : `<span style="color:${token.color}">${escape(token.content)}</span>`,
      )
      .join(''),
  )
}

// every request is answered: a block that fails shows plain, and its language is loaded again next time
addEventListener('message', async (e: MessageEvent<{ id: number; language: string; code: string }>) => {
  const { id, language, code } = e.data
  try {
    postMessage({ id, lines: await highlight(language, code) })
  } catch (error) {
    console.error('cordial: highlighting failed', language, error)
    loading.delete(ALIASES[language.toLowerCase()] ?? language.toLowerCase())
    postMessage({ id, lines: null })
  }
})
