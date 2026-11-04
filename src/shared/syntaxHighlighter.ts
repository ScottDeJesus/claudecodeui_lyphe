// Type-only, and erased from the build: it loads the package's ambient declarations for the deep
// `dist/esm/...` paths below, without pulling in the package entry and its ~290 grammars.
import type {} from 'react-syntax-highlighter';
import PrismLight from 'react-syntax-highlighter/dist/esm/prism-light';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import batch from 'react-syntax-highlighter/dist/esm/languages/prism/batch';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import clike from 'react-syntax-highlighter/dist/esm/languages/prism/clike';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import cssExtras from 'react-syntax-highlighter/dist/esm/languages/prism/css-extras';
import dart from 'react-syntax-highlighter/dist/esm/languages/prism/dart';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import elixir from 'react-syntax-highlighter/dist/esm/languages/prism/elixir';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql';
import groovy from 'react-syntax-highlighter/dist/esm/languages/prism/groovy';
import haskell from 'react-syntax-highlighter/dist/esm/languages/prism/haskell';
import hcl from 'react-syntax-highlighter/dist/esm/languages/prism/hcl';
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javadoc from 'react-syntax-highlighter/dist/esm/languages/prism/javadoc';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsExtras from 'react-syntax-highlighter/dist/esm/languages/prism/js-extras';
import jsTemplates from 'react-syntax-highlighter/dist/esm/languages/prism/js-templates';
import jsdoc from 'react-syntax-highlighter/dist/esm/languages/prism/jsdoc';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import json5 from 'react-syntax-highlighter/dist/esm/languages/prism/json5';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import less from 'react-syntax-highlighter/dist/esm/languages/prism/less';
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua';
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import nginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx';
import objectivec from 'react-syntax-highlighter/dist/esm/languages/prism/objectivec';
import perl from 'react-syntax-highlighter/dist/esm/languages/prism/perl';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import phpExtras from 'react-syntax-highlighter/dist/esm/languages/prism/php-extras';
import phpdoc from 'react-syntax-highlighter/dist/esm/languages/prism/phpdoc';
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell';
import properties from 'react-syntax-highlighter/dist/esm/languages/prism/properties';
import protobuf from 'react-syntax-highlighter/dist/esm/languages/prism/protobuf';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import r from 'react-syntax-highlighter/dist/esm/languages/prism/r';
import regex from 'react-syntax-highlighter/dist/esm/languages/prism/regex';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import scala from 'react-syntax-highlighter/dist/esm/languages/prism/scala';
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import solidity from 'react-syntax-highlighter/dist/esm/languages/prism/solidity';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import vim from 'react-syntax-highlighter/dist/esm/languages/prism/vim';
import xmlDoc from 'react-syntax-highlighter/dist/esm/languages/prism/xml-doc';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import zig from 'react-syntax-highlighter/dist/esm/languages/prism/zig';

/**
 * The syntax highlighter chat code blocks render through.
 *
 * `react-syntax-highlighter`'s default Prism export bundles every language
 * Prism ships — around 290 of them. That is roughly a quarter of the app's
 * JavaScript, and registering them costs a depth-first walk of the whole
 * grammar table on startup, which profiles as the single most expensive thing
 * the client does before it can paint.
 *
 * These are the languages a coding agent actually emits fences for. Anything
 * outside the list still renders — refractor throws on an unknown grammar and
 * the highlighter falls back to plain text — it simply is not coloured. Each
 * grammar registers its own aliases, so `sh`, `yml`, `py` and friends resolve
 * without being listed separately.
 *
 * THE EXTENSION GRAMMARS ARE PART OF THE LIST. `css-extras`, `js-extras`,
 * `js-templates`, `jsdoc`, `javadoc`, `php-extras`, `phpdoc` and `xml-doc` are
 * not languages: each one rewrites the grammar of a language already listed, in
 * place, and without them that language is drawn with a thinner grammar than
 * Prism's own — `console`, `Math` and `window` lose their colour, `=>` and `...`
 * lose their `arrow` and `spread` aliases (they stay operators), `a.b` stops
 * being a property access, `@param` tags and `{@link}` stop being doc-comment
 * tokens, `$this` stops being a keyword, a C# `/// <summary>` line stops
 * carrying tag tokens. They were once registered by accident: this module used
 * to import from the package entry, which also loads the full Prism build and
 * registers every grammar on the one shared `refractor/core`. Importing deep,
 * which is what keeps the full table out of the bundle, made them vanish;
 * .verify/probe-shapes-baseline.mjs caught it as `token control-flow` missing
 * from a `return`.
 *
 * ORDER IS THE CONTRACT, because registering is what builds a grammar, not
 * looking one up. An extension goes right after its base, before any grammar
 * that copies the base when it registers: `typescript` (pulled in by `jsdoc`),
 * `jsx` and `tsx` copy `javascript`, `less` and `scss` copy `css`. `xml-doc`
 * reads `markup`'s tag grammar the moment it registers, so it follows `markup`;
 * the `csharp` it patches is listed first of all. And
 * `js-templates` only builds an embed for a grammar that is ALREADY registered,
 * skipping the rest without a word: css, markup (`html`, `svg`), graphql and sql
 * are listed above it for that reason, and `markdown` is not — an embedded
 * markdown template is not what this highlighter has ever drawn. Move one and
 * the output moves with it. Insertion order is registration order.
 *
 * `opencl` is deliberately absent. It is a language, not an extension of one,
 * and its side effect on `c` and `cpp` is to colour a user's own `Event`,
 * `Context` or `Buffer` as keywords.
 */
const LANGUAGES = {
  bash, batch, c, clike, cpp, csharp, css, 'css-extras': cssExtras, dart, diff,
  docker, elixir, go, graphql, groovy, haskell, hcl, ini, java, javadoc,
  markup, 'xml-doc': xmlDoc, sql,
  javascript, 'js-extras': jsExtras, 'js-templates': jsTemplates, jsdoc,
  json, json5, jsx, kotlin, less, lua, makefile, markdown, nginx, objectivec,
  perl, php, 'php-extras': phpExtras, phpdoc, powershell, properties, protobuf,
  python, r, regex, ruby, rust, scala, scss, solidity, swift, toml, tsx,
  typescript, vim, yaml, zig,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  PrismLight.registerLanguage(name, language);
}

export const SyntaxHighlighter = PrismLight;
