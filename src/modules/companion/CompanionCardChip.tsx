import { Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { CompanionNote } from '@/shared/companion-types';
import { COMPANION_NOTE_KIND_GLYPHS } from '@/shared/constants';
import { Button } from '@/shared/ui';

type CompanionCardChipProps = {
  /** The card she put up, as her picture holds it. */
  note: CompanionNote;
  /** The chip, pressed: the caller puts the card on its stage. */
  onOpen: (note: CompanionNote) => void;
};

/**
 * A CARD SHE PUT UP, standing in her conversation where she put it. Drawn by this module's CompanionLog when it is handed
 * `cards`, which only the station module's conversation does: her panel passes none and keeps her cards in its dock.
 *
 * The kit's outline Button at the small size, its three marks in the order the stage's shelf draws them, so a card reads as
 * one card in both places: its kind's glyph AND word (`COMPANION_NOTE_KIND_GLYPHS`; never the glyph alone, MAN-578), its title
 * on one line, cut there and whole on the stage its press opens (never only in a tooltip), and a filled pin when he pinned it.
 * Its name is its own words and what the press does — "Open Diff claudecodeui_lyphe: uncommitted diff on the stage", then
 * ", pinned" when pinned, the shelf's own word for the pin — so a reader hears the kind and the pin the eye sees, and a voice
 * that says the words on it finds it. Its press is `onOpen(note)`. Its width is its words', up to the box the log stands it
 * in. Below 768 px it is a 44 px catch under a finger (the station's touch law).
 */
export function CompanionCardChip({ note, onOpen }: CompanionCardChipProps) {
  const { t } = useTranslation();
  const glyph = COMPANION_NOTE_KIND_GLYPHS[note.kind];
  const KindIcon = glyph.icon;
  const kind = t(glyph.wordKey);
  const name = t('station.conversation.openCard', { kind, title: note.title, defaultValue: 'Open {{kind}} {{title}} on the stage' })
    + (note.pinned ? t('station.cards.shelf.pinnedWord', { defaultValue: ', pinned' }) : '');

  return (
    <Button
      variant="outline"
      size="sm"
      data-companion-card={note.id}
      data-companion-card-kind={note.kind}
      data-companion-card-pinned={note.pinned ? '' : undefined}
      aria-label={name}
      onClick={() => onOpen(note)}
      className="max-w-full max-md:h-11"
    >
      <KindIcon aria-hidden="true" />
      <span className="shrink-0 text-xs font-medium uppercase tracking-[0.12em]">{kind}</span>
      {/* A space a flex row lays out as nothing, so the words copy as "List Runs: recent" and never "ListRuns". */}
      {' '}
      <span className="min-w-0 truncate font-normal">{note.title}</span>
      {note.pinned && <Pin aria-hidden="true" data-companion-card-pin="" className="fill-current" />}
    </Button>
  );
}
