// The layer boundary (ai/RESTRUCTURE.md), run by `npm run check`: views/, components/ and primitives/ never import
// adapter/; primitives/ imports none of api/, components/, views/; components/ don't import views/. ALLOWED lists the
// imports that predate it, as 'file -> layer/module'; it only shrinks, and an entry that no longer matches fails too.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const FORBIDDEN = {
  views: ['adapter'],
  components: ['adapter', 'views'],
  primitives: ['adapter', 'api', 'components', 'views'],
}

const ALLOWED = new Set([
  'components/pickers.tsx -> adapter/discord',
  'components/pickers.tsx -> adapter/needs',
  'views/header.tsx -> adapter/discord',
  'views/header.tsx -> adapter/needs',
  'views/members.tsx -> adapter/discord',
  'views/members.tsx -> adapter/needs',
])

const src = join(import.meta.dirname, 'src')
const found = new Set()
const errors = []
for (const layer of Object.keys(FORBIDDEN)) {
  for (const file of readdirSync(join(src, layer), { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(file)) continue
    const path = join(src, layer, file)
    for (const [, spec] of readFileSync(path, 'utf8').matchAll(/(?:from|import)\s+'(\.[^']*)'/g)) {
      const target = relative(src, join(dirname(path), spec)).replace(/\.[jt]sx?$/, '')
      if (!FORBIDDEN[layer].includes(target.split('/')[0])) continue
      const edge = `${layer}/${file} -> ${target}`
      found.add(edge)
      if (!ALLOWED.has(edge)) errors.push(`${edge}: crosses the boundary`)
    }
  }
}
for (const edge of ALLOWED) if (!found.has(edge)) errors.push(`${edge}: gone, remove it from ALLOWED`)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
