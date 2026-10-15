// The code highlighter, a worker in its own bundle (dist/highlight.js, started by api/highlight.ts): Shiki with VS
// Code's grammars for the common languages (languages.ts names them), each loaded at its first block. A block comes
// back as its lines' tokens: each a length and the css-variables theme's colour it takes (`token-keyword` for
// `var(--code-token-keyword)`, app.css), '' for the text's own.

import { createCssVariablesTheme, createHighlighterCore, type LanguageInput } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import type { Language } from './languages'

const GRAMMARS: Record<Language, () => LanguageInput> = {
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  glsl: () => import('shiki/langs/glsl.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  haskell: () => import('shiki/langs/haskell.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  nix: () => import('shiki/langs/nix.mjs'),
  ocaml: () => import('shiki/langs/ocaml.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  zig: () => import('shiki/langs/zig.mjs'),
}

const THEME = createCssVariablesTheme({ name: 'cordial', variablePrefix: '--code-' })
const highlighter = createHighlighterCore({ themes: [THEME], langs: [], engine: createJavaScriptRegexEngine() })
const loading = new Map<string, Promise<void>>()

export type Token = [length: number, colour: string]
// the text's own colour, which the block already has
const FOREGROUND = 'var(--code-foreground)'
const PREFIX = 'var(--code-'

async function highlight(language: Language, code: string) {
  const shiki = await highlighter
  if (!loading.has(language)) loading.set(language, shiki.loadLanguage(GRAMMARS[language]()))
  await loading.get(language)
  const { tokens } = shiki.codeToTokens(code, { lang: language, theme: 'cordial' })
  // neighbours in one colour as one token
  return tokens.map((line) => {
    const merged: Token[] = []
    for (const token of line) {
      const colour = !token.color || token.color === FOREGROUND ? '' : token.color.slice(PREFIX.length, -1)
      const last = merged.at(-1)
      if (last?.[1] === colour) last[0] += token.content.length
      else merged.push([token.content.length, colour])
    }
    return merged
  })
}

// every request is answered: a block that fails shows plain, and its language is loaded again next time
addEventListener('message', async (e: MessageEvent<{ id: number; language: Language; code: string }>) => {
  const { id, language, code } = e.data
  try {
    postMessage({ id, lines: await highlight(language, code) })
  } catch (error) {
    console.error('cordial: highlighting failed', language, error)
    loading.delete(language)
    postMessage({ id, lines: null })
  }
})
