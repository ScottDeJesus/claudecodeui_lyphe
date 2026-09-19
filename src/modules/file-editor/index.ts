import { lazy } from 'react';

// Lazy: the editor carries CodeMirror, which loads on the first press of Edit rather than with the
// Files tab — importing this barrel for the session store below never pulls it into a page load.
export const FileEditor = lazy(() => import('@/modules/file-editor/FileEditor').then((m) => ({ default: m.FileEditor })));

// The one edit session, as the file manager reads and steers it: whether a file is open and dirty,
// and the save/discard/end acts its guards offer before another file takes that file's place.
export {
  startEditSession,
  useEditSessionStatus,
  getEditSessionStatus,
  saveOpenEditSession,
  canSaveOpenEditSession,
  discardEditSession,
  endEditSession,
} from '@/modules/file-editor/utils/editSessionStore';
