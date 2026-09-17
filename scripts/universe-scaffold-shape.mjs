#!/usr/bin/env node
// Records the shape of a screen's composition — one line per JSX element, in source order —
// so a phase that fills in behaviour can prove it changed none of the markup.
//
//   node scripts/universe-scaffold-shape.mjs <file.tsx> [more.tsx ...]
//
// It prints `<file>:<tagName>:<className or ->` for every element in the file's text, and nothing
// else, so a caller can diff two runs instead of reading a render. A filled handler, a new ref or a
// wired prop never shows up; a restyle or a re-layout always does. The attributes are read with a
// brace- and quote-aware walk rather than a flat regex, because `{() => setOpen(!open)}` and a `>`
// inside a string are both attributes no single regular expression can end correctly.

import { readFileSync } from 'node:fs';

/** Every element opening tag: `<Name`, `<Name.Sub`, or the `<>` fragment. A close tag, a `<=` and a
 *  bare `<` before a space all fail to match, which is what keeps comparisons out of the record. */
const TAG = /<([A-Za-z][\w.:-]*|>)/g;

/** What a `<` cannot follow and still open an element: a name it is glued to, or a type argument's
 *  own punctuation. This is what keeps `useRef<UniverseDigest | null>(null)` out of the record, and
 *  it is why the tag is matched with its neighbour rather than on its own. */
const GLUED = /[\w$)\]]$/;
/** What a tag's own text cannot begin with: the punctuation of a type argument list. `useRef<T,>(x)`
 *  and `<T,>` an arrow's generic are both caught here when a space saved them from `GLUED`. */
const TYPELIKE = /^[\s]*[|&,<[(]/;

/** The class attribute's own value: a quoted string, or a `{…}` expression read to its own brace. */
const CLASS = /\bclassName\s*=\s*/;

/** The attribute text of the tag that starts at `from`, ending at the `>` outside every brace and
 *  quote. Returns what lies between, and never the `>` itself. */
function attributes(text, from) {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return text.slice(from, i);
  }
  return '';
}

/** The class value from an attribute string: `toast__row` for a string, `{cn('a')}` for an
 *  expression. Whitespace inside it collapses, because a class list wrapped over three lines is
 *  still one line of this record and still the same class list after a reformat. */
function classNameOf(body) {
  const found = CLASS.exec(body);
  if (found === null) return '-';
  const at = found.index + found[0].length;
  const first = body[at];
  if (first === '"' || first === "'") {
    const end = body.indexOf(first, at + 1);
    return end === -1 ? '-' : body.slice(at + 1, end);
  }
  if (first !== '{') return '-';
  let depth = 0;
  for (let i = at; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') {
      depth--;
      if (depth === 0) return body.slice(at, i + 1);
    }
  }
  return '-';
}

const lines = [];
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  TAG.lastIndex = 0;
  let tag;
  while ((tag = TAG.exec(text)) !== null) {
    // A fragment opens with `<>` and never closes with a `>` of its own, so it carries no
    // attributes — reading any would take the next element's and attribute them to the fragment.
    if (tag[1] === '>') {
      lines.push(`${file}:<>:-`);
      continue;
    }
    // A type argument, not an element: skip it and keep scanning from its own end.
    if (GLUED.test(text.slice(0, tag.index)) || TYPELIKE.test(text.slice(TAG.lastIndex, TAG.lastIndex + 4))) {
      continue;
    }
    const classes = classNameOf(attributes(text, TAG.lastIndex)).replace(/\s+/g, ' ').trim();
    lines.push(`${file}:${tag[1]}:${classes || '-'}`);
  }
}
process.stdout.write(lines.length === 0 ? '' : `${lines.join('\n')}\n`);
