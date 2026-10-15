// Discord's "is this a text field" check, which its keybinds and keyboard mode run on every key, counts only
// contenteditable="true" (its own editor's); the composer's box is plain-text editable (views/editable.ts). Patched to
// any editable, as a textarea was: arrow keys in the box don't turn its keyboard mode on (and track that).

import { G } from './anchor'
import { patch } from './webpack'

const fields = patch('getAttribute("contenteditable")||', [
  /"true"===([\w$]+)\.getAttribute\("contenteditable"\)/,
  '$1.isContentEditable',
])
G.fieldsApplied = () => fields.applied
