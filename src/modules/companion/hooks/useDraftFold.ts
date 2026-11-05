import { useCallback, useState } from 'react';

import { usePanelFold } from '@/modules/companion/hooks/usePanelFold';
import type { CompanionDraft, CompanionDraftTarget } from '@/shared/companion-types';
import type { CompanionDraftFold } from '@/shared/types';

/** Where a draft goes, as one value: a chat by its session (a rename is not a new target), a new chat by its project. */
const targetKey = (target: CompanionDraftTarget): string => (
  target.kind === 'session' ? `session:${target.session.sessionId}` : `new:${target.projectPath}`);

/** Whether the draft now is the one he saw: the same target and the same words. */
const sameDraft = (seen: CompanionDraft, now: CompanionDraft): boolean => (
  targetKey(seen.target) === targetKey(now.target) && seen.text === now.text);

/**
 * Her draft's fold on the panel (`usePanelFold`, section `draft`): whether he keeps it folded to its head row, his press on
 * its chevron, and the mark its folded line wears for what changed while it was folded.
 *
 * THE MARK measures the draft against what he last saw (the draft of the first picture this page read, or the draft as it
 * stood while the section was last open, or no draft once it was cleared): `new` for a draft that arrived or now goes to
 * another chat, `edited` for one whose words alone changed. It stands until he opens the draft. HIS OWN SAVE IS NEVER NEWS:
 * every save of his passes through `onOwnSave` (the panel's edit verb calls it), and the draft that comes back holding those
 * words for the same chat is his save's echo, seen as it lands (`see`), so the save that lands after he folded — the
 * field's blur saves his edit as his press on the chevron lands — leaves the line unmarked. His words are then let go: the
 * same words coming from her later, after he saw hers, are a change like any other. They are kept as `PUT /draft` stores
 * them, trimmed, as the card's own `ownSave` is (MAN-9090).
 *
 * Used by this module's CompanionPanel, which hands the fold to the draft card, or to the folded line while there is no
 * draft, and keeps the dock up for that line.
 */
export function useDraftFold(draft: CompanionDraft | null | undefined): CompanionDraftFold & { onOwnSave: (words: string) => void } {
  const { folded, setFolded, seen, see } = usePanelFold('draft', draft, sameDraft);
  // The words of his latest save as the server keeps them, until their echo lands: the draft that brings them is his own.
  const [ownWords, setOwnWords] = useState<string | null>(null);
  const onOwnSave = useCallback((words: string) => setOwnWords(words.trim()), []);

  // His save's echo: seen, and his words let go. Set while rendering, which React re-runs at once.
  if (ownWords !== null && draft && draft.text === ownWords && seen !== null && targetKey(seen.target) === targetKey(draft.target)) {
    see(draft);
    setOwnWords(null);
  }

  let mark: CompanionDraftFold['mark'] = null;
  if (folded && draft) {
    if (seen === null || targetKey(seen.target) !== targetKey(draft.target)) mark = 'new';
    else if (draft.text !== seen.text) mark = 'edited';
  }
  return { folded, onFoldChange: setFolded, mark, onOwnSave };
}
