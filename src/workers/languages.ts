// The languages the highlighter knows (src/workers/highlight.ts loads their grammars) and what people write after ```
// for them: shared, so a block in any other language shows plain without starting the worker

export const LANGUAGES = [
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'dockerfile',
  'elixir',
  'glsl',
  'go',
  'graphql',
  'haskell',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'jsonc',
  'jsx',
  'kotlin',
  'lua',
  'make',
  'markdown',
  'nix',
  'ocaml',
  'php',
  'powershell',
  'python',
  'ruby',
  'rust',
  'scss',
  'shellscript',
  'sql',
  'svelte',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'vue',
  'xml',
  'yaml',
  'zig',
] as const
export type Language = (typeof LANGUAGES)[number]

const ALIASES: Record<string, Language> = {
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
const KNOWN = new Set<string>(LANGUAGES)

export function language(name: string): Language | undefined {
  const lower = name.toLowerCase()
  if (lower in ALIASES) return ALIASES[lower]
  return KNOWN.has(lower) ? (lower as Language) : undefined
}
