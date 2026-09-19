import type { Extension } from '@codemirror/state';

/**
 * Syntax highlighting for the file an editor was opened on, loaded on demand.
 *
 * Every language package is reached through a dynamic `import()` and nothing else, so each one
 * becomes its own chunk: a person editing a `.py` file never downloads the HTML or the YAML
 * grammar, and the editor's own chunk stays small. An extension with no language here resolves
 * `null`, which the caller reads as plain text — the safe answer for a file type nobody
 * anticipated.
 */

const loadMarkdown = async () => (await import('@codemirror/lang-markdown')).markdown();
const loadJavaScript = async () => (await import('@codemirror/lang-javascript')).javascript();
const loadJsx = async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
const loadTypeScript = async () =>
  (await import('@codemirror/lang-javascript')).javascript({ typescript: true });
const loadTsx = async () =>
  (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true });
const loadJson = async () => (await import('@codemirror/lang-json')).json();
const loadPython = async () => (await import('@codemirror/lang-python')).python();
const loadCss = async () => (await import('@codemirror/lang-css')).css();
const loadHtml = async () => (await import('@codemirror/lang-html')).html();
const loadYaml = async () => (await import('@codemirror/lang-yaml')).yaml();

/** Lowercased extension (with its dot) to the loader for that grammar. */
const EXTENSION_LOADERS: Record<string, () => Promise<Extension>> = {
  '.md': loadMarkdown,
  '.markdown': loadMarkdown,
  '.mdx': loadMarkdown,
  '.js': loadJavaScript,
  '.mjs': loadJavaScript,
  '.cjs': loadJavaScript,
  '.jsx': loadJsx,
  '.ts': loadTypeScript,
  '.mts': loadTypeScript,
  '.cts': loadTypeScript,
  '.tsx': loadTsx,
  '.json': loadJson,
  '.jsonc': loadJson,
  '.json5': loadJson,
  '.py': loadPython,
  '.pyi': loadPython,
  '.css': loadCss,
  '.scss': loadCss,
  '.less': loadCss,
  '.html': loadHtml,
  '.htm': loadHtml,
  '.xhtml': loadHtml,
  '.yml': loadYaml,
  '.yaml': loadYaml,
};

/** The language support for `path` by its extension, or null for a file whose type has none. */
export async function loadLanguageFor(path: string): Promise<Extension | null> {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return null;
  }
  const loader = EXTENSION_LOADERS[name.slice(dot).toLowerCase()];
  return loader ? loader() : null;
}
