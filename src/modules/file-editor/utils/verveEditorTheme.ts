import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

/**
 * The editor's Verve skin.
 *
 * Every colour and the typeface come from the design tokens, never from a literal: the app has a
 * light and a dark palette and a theme that named its own colours would be wrong in one of them.
 * `dark` is handed to `EditorView.theme` so CodeMirror's own defaults (the caret, the native
 * selection, form controls) follow the palette instead of fighting it.
 */
export function verveEditorTheme(isDarkMode: boolean): Extension {
  return [
    EditorView.theme(
      {
        '&': {
          backgroundColor: 'var(--surface)',
          color: 'var(--ink)',
          fontFamily: 'var(--font-mono)',
          height: '100%',
        },
        '.cm-content': { caretColor: 'var(--accent)' },
        '.cm-gutters': {
          backgroundColor: 'var(--surface)',
          color: 'var(--ink-muted)',
          border: 'none',
          borderRight: '1px solid var(--border)',
        },
        '.cm-activeLine': { backgroundColor: 'var(--accent-soft)' },
        '.cm-activeLineGutter': {
          backgroundColor: 'var(--accent-soft)',
          color: 'var(--ink)',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'var(--accent-soft)',
        },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
      },
      { dark: isDarkMode },
    ),
    syntaxHighlighting(isDarkMode ? oneDarkHighlightStyle : defaultHighlightStyle),
  ];
}
