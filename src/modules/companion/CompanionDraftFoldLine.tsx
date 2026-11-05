import { MessageSquarePlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionFoldMark } from '@/modules/companion/CompanionFoldMark';
import type { CompanionDraft } from '@/shared/companion-types';
import { COMPANION_DRAFT_EYEBROW } from '@/shared/constants';
import type { CompanionDraftFold } from '@/shared/types';
import { Card, CardFoldToggle, Collapsible } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The draft's head row in her panel, open and folded alike: the words it is handed, then, given a fold, the kit's
 * `CardFoldToggle` at its end, named "Collapse draft" / "Expand draft" so a reader tells it from the notes' chevron above it.
 * ONE ROW AND ONE CHEVRON ACROSS THE FOLD: the words change with it and the chevron is the same element, so a press from
 * the keyboard keeps its focus and is told "Expand draft" and "Collapse draft" in turn, as the notes' is told theirs (two
 * rows, each with its own chevron, unmounted the focused one and dropped the focus to the page). The chevron stands in line
 * with the notes' above it (7px in from the dock's edge, as their `mr-[7px]` stands: 6px into the card's 12px padding, past
 * its 1px border), and hangs into the card's padding over and under the row (its 28px, or 44px under a finger, on a 20px
 * row), so the row keeps its text's height and the folded card stays one line. `relative`, so the part that hangs over the
 * row under it is still the chevron's to press. Inside the fold's `Collapsible`.
 *
 * Used by this module's CompanionDraftCard (its head row) and CompanionDraftNoneLine (below).
 */
export function CompanionDraftHead({ foldable, children }: { foldable: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2">
      {children}
      {foldable && (
        <CardFoldToggle
          className="relative -my-1 -mr-1.5 finger:-my-3"
          labels={{ collapse: t('companion.draft.collapse'), expand: t('companion.draft.expand') }}
        />
      )}
    </div>
  );
}

type CompanionDraftFoldLineProps = {
  /** The draft the line names; null while there is none, and the line says so. */
  draft: CompanionDraft | null;
  /** The words the draft's field holds (his unsaved edit, or the draft's own), whose opening the line shows. */
  words: string;
  mark: CompanionDraftFold['mark'];
};

/**
 * HER DRAFT, FOLDED: the draft card's head row, as one line. "DRAFT", the mark when something came while it was folded,
 * the target in the card's own words ("For Kanban lanes", "New chat in claudecodeui_lyphe"), then the brief's opening words,
 * muted, cut with an ellipsis where the line runs out, before the head row's chevron at its end. One line at every width: the
 * brief's words take only the room the target leaves (they grow from nothing), so where the line is short they give way
 * first, and the target, which says where a send would go, truncates last. With no draft, the line is "DRAFT" and
 * "No draft", and no mark.
 *
 * THE MARK is the notes' (`CompanionFoldMark`): "New" for a draft that arrived or changed its target while folded, "Edited"
 * for one whose words alone changed, keyed by when the draft last changed so each change pops it in again. The brief's
 * words are a glance for the eye, hidden from a reader of the accessibility tree, which hears the line as its label, its
 * mark and its target; the whole brief is one press away.
 *
 * The words of the head row (`CompanionDraftHead`) while folded. Used by this module's CompanionDraftCard (its head row's
 * words while folded) and CompanionDraftNoneLine (below).
 */
export function CompanionDraftFoldLine({ draft, words, mark }: CompanionDraftFoldLineProps) {
  const { t } = useTranslation();
  // The opening of the brief on one line: her line breaks and runs of blanks read as one space.
  const opening = words.replace(/\s+/g, ' ').trim();

  return (
    <p data-companion-draft-line="" className="flex min-w-0 flex-1 items-baseline gap-2 text-sm">
      <span className={cn(COMPANION_DRAFT_EYEBROW, 'shrink-0')}>{t('companion.draft.title')}</span>
      {draft !== null && mark !== null && (
        <CompanionFoldMark key={`${mark}:${draft.updatedAt}`} data-companion-draft-mark={mark}>
          {t(mark === 'new' ? 'companion.draft.markNew' : 'companion.draft.markEdited')}
        </CompanionFoldMark>
      )}
      {draft === null ? (
        <span data-companion-draft-none="" className="min-w-0 truncate text-muted-foreground">{t('companion.draft.none')}</span>
      ) : (
        <>
          {draft.target.kind === 'new' && <MessageSquarePlus aria-hidden="true" className="size-3.5 shrink-0 self-center text-muted-foreground" />}
          <span data-companion-draft-target="" className="min-w-0 truncate font-medium text-foreground">
            {draft.target.kind === 'session'
              ? t('companion.draft.forChat', { chat: draft.target.session.name })
              : t('companion.draft.newChat', { project: draft.target.projectName })}
          </span>
          {opening.length > 0 && (
            <span data-companion-draft-brief="" aria-hidden="true" className="min-w-0 flex-[1_1_0%] truncate text-muted-foreground">
              · {opening}
            </span>
          )}
        </>
      )}
    </p>
  );
}

/**
 * The draft's folded line while there is no draft: the fold is his, so it stands folded with a draft or without one, and
 * after a reload too, in the card's own frame so a draft cleared under it changes words, never shape. His press on its
 * chevron opens the fold; with nothing to show, the line goes and the next draft arrives open.
 *
 * Used by this module's CompanionPanel, in the draft's place at the foot of her dock, while the fold is folded and her
 * picture holds no draft.
 */
export function CompanionDraftNoneLine({ fold }: { fold: CompanionDraftFold }) {
  return (
    <Collapsible open={!fold.folded} onOpenChange={(open) => fold.onFoldChange(!open)}>
      <Card data-companion-draft="none" data-companion-draft-fold="folded" className="border-input p-3">
        <CompanionDraftHead foldable>
          <CompanionDraftFoldLine draft={null} words="" mark={null} />
        </CompanionDraftHead>
      </Card>
    </Collapsible>
  );
}
