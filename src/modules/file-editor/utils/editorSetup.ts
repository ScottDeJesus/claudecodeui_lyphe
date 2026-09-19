import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
} from '@codemirror/view';

import { verveEditorTheme } from '@/modules/file-editor/utils/verveEditorTheme';
import { windowedDocumentExtensions } from '@/modules/file-editor/utils/windowedDocument';

/**
 * The two compartments, shared by every state this module builds.
 *
 * They are singletons rather than per-call values because a session can outlive the component
 * that showed it: a restored state was built by a setup of a previous mount, and a
 * `reconfigure` effect naming a compartment that state does not contain is silently dropped.
 * One pair of compartments means the language load and a theme flip reach the restored state too.
 */
const language = new Compartment();
const theme = new Compartment();

/**
 * The editor's extension list, composed by hand rather than taken from `basicSetup`.
 *
 * `basicSetup` would install its own line-number gutter, which would number the document from 1
 * and undo the file-line numbering the window's field exists to provide. So the pieces are
 * named here, in the order they must run, and the two settings that change after setup — the
 * language and the theme — sit in the compartments above.
 *
 * Consumed by useWindowedDocument, which is the only thing that builds an editor.
 */
export function createEditorSetup(input: {
  isDarkMode: boolean;
  onSave: () => void;
}): { extensions: Extension[]; language: Compartment; theme: Compartment } {
  const { onSave } = input;

  return {
    language,
    theme,
    extensions: [
      windowedDocumentExtensions(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      // Highest precedence, so nothing inside the editor's own DOM — CodeMirror's default map,
      // above all — takes Mod-s before the file does. It only reaches presses that land in the
      // editor: the toolbar and the banners are covered by the editor section's own key handler,
      // which the browser's Save Page command would otherwise win.
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              onSave();
              return true;
            },
          },
        ]),
      ),
      language.of([]),
      theme.of(verveEditorTheme(input.isDarkMode)),
    ],
  };
}
