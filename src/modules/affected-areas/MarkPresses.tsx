import { Check, ChevronDown, Loader2, PenLine, Undo2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { JudgmentPress, KeyCap, MarkRefusal } from '@/modules/affected-areas/MarkPress';
import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import { kindName } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, MarkRequest, Region } from '@/shared/affected-areas-types';
import { Badge, Button, buttonVariants, Menu } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * Rename to…'s face: the confirmed look as an outline (its ring and ink, no fill), because a renamed area is drawn
 * confirmed — a change, of another kind. Beside Confirm's fill and Not a change's grey, the three read as one set.
 */
const RENAME_FACE = 'bg-transparent text-tone-ink ring-1 ring-inset ring-tone-dot/60 hover:bg-tone-soft max-md:h-11';

type MarkPressesProps = {
  region: Region;
  /** The kinds Rename to… offers, in the codebook's own order; null until the codebook answers (Rename waits for it). */
  codebook: Codebook | null;
  /** Browsing a pano (the operator walked there), not working a queue: the bar names the area it marks, because a
   *  queue's screen already asks about it in its own words ("Is this water stain?"). */
  browsing: boolean;
  /** The press whose mark is out, or null: a verdict, or `keep` (a renamed area's rename to the kind it already counts
   *  as). While one is out every press refuses a second: one mark at a time. */
  out: MarkRequest['verdict'] | 'keep' | null;
  /** Why the last press was refused — the engine's reason or the lane's fault — or null. The next press clears it. */
  refusal: string | null;
  /** The note that goes with the next press, kept from the note dialog; '' when there is none. */
  note: string;
  onMark: (verdict: 'confirm' | 'not_a_change') => void;
  onRename: (newClass: string) => void;
  /** A renamed area's Keep: the rename to the kind it already counts as, which keeps the judgment and carries a note. */
  onKeep: () => void;
  /** Add a note (Edit the note once one is kept): opens the note dialog. */
  onNote: () => void;
};

/**
 * THE THREE PRESSES, drawn: Confirm (✓, in the confirmed area's green), Rename to… (a `Menu` of the codebook's kinds,
 * the area's own left out), Not a change (✕, in the set-aside grey), then Add a note. Each press is one mark and
 * nothing is marked for the operator: there is no "confirm all", and a confidence never turns an area green by itself.
 *
 * A press's tone is the look the area takes when it is pressed (the region-look table, through `JudgmentPress`), so
 * the redraw that answers it is the same colour. Rename to… lands the area confirmed too, so it wears that tone as an
 * outline (`RENAME_FACE`). Its kinds stand in the codebook's order, which is its groups' order — Damage, Work already
 * done, The source, Older damage; `Menu` draws no group headings, so each row carries its group's word as its description
 * (`affectedAreas.groups.<group>`, from the `group` its codebook class carries).
 *
 * States: at rest; one press out (its glyph a turning ring, every press refusing a second; a polite "Sending your
 * mark…"); refused (the reason in one sentence under the presses, until the next press); a note kept (said under the
 * presses, and Add a note reads Edit the note); the codebook not answered yet (Rename to… waits, dimmed). Browsing, the
 * bar opens on the area it marks: its number in its look, its kind (the renamed kind once renamed, and the kind it was
 * renamed from) and where it stands.
 *
 * EACH PRESS SAYS WHAT IT DOES TO THIS AREA, judged or not, because a note only goes out with a press:
 * - a renamed area leads with Keep {its kind} (a rename to the kind it counts as, which the engine takes: it refuses
 *   only the reader's own kind) and its Confirm reads Put back {the reader's kind}, which is what a later confirm does
 *   (shadow-connector's `effective_class`). Without Keep, a note could only ride a press that undoes the rename;
 * - an area drawn by hand can only be taken back, so it offers Not a change alone, says so, and offers no note: its
 *   one press removes it. Once taken back it is drawn set aside and its bar says so with no press at all: the engine
 *   takes no other mark on a drawn area, and another Not a change would only write a second row.
 *
 * On the Mark screen (not browsing) each press carries its key inside it (`KeyCap`: Y, R, N), and `aria-keyshortcuts`.
 * Browsing, the bar is brought into view with the photo above it by the face block it stands in (`FacePhoto`).
 *
 * Handles for a script and for the Mark screen's keys: `data-mark-bar` on the group, and `data-mark-press` on each
 * press (`keep`, `confirm`, `rename`, `not_a_change`, `note`), so Y, R and N are the very presses a pointer makes.
 *
 * Used by the affected-areas module's `MarkBar`, which holds the presses' state and sends them.
 */
export function MarkPresses({ region, codebook, browsing, out, refusal, note, onMark, onRename, onKeep, onNote }: MarkPressesProps) {
  const { t } = useTranslation();

  const busy = out !== null;
  const look = REGION_LOOK[regionState(region)];
  // The kind the area counts as (the engine's `effectiveClass`; the reader's own for a region it left unjudged), and the one
  // the operator renamed it to (null when it was not renamed).
  const counted = region.effectiveClass ?? region.class;
  const renamedTo = counted === region.class ? null : counted;
  const shownKind = kindName(counted, codebook);
  const drawnByHand = region.source === 'human';
  // A drawn area its operator took back: set aside, and nothing more to press on it.
  const takenBack = drawnByHand && region.mark?.verdict === 'not_a_change';
  // The kinds it can be renamed to: every kind but its own, which the engine refuses as `same_class`. A kind it was
  // already renamed to is ticked (`selected`), so the menu says where the area stands.
  const kinds = (codebook?.classes ?? [])
    .filter((kind) => kind.key !== region.class)
    .map((kind) => ({ id: kind.key, label: kind.label, description: t(`affectedAreas.groups.${kind.group}`), selected: kind.key === renamedTo }));
  const where = [t(look.wordKey), renamedTo === null ? null : t('affectedAreas.mark.renamedFrom', { kind: kindName(region.class, codebook) })]
    .filter((part) => part !== null)
    .join(' · ');
  const ring = <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />;
  const renameGlyph = out === 'rename' ? ring : <ChevronDown aria-hidden="true" />;

  return (
    <section
      role="group"
      aria-label={t('affectedAreas.mark.barLabel', { area: `${region.ordinal}. ${shownKind}` })}
      data-mark-bar=""
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-3"
    >
      {browsing && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge as="span" tone={look.tone} className="min-w-[26px] flex-none justify-center border-tone-dot px-1.5 font-bold tabular-nums">
            {region.ordinal}
          </Badge>
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">{shownKind}</span>
          <span className="text-xs text-muted-foreground">{where}</span>
        </div>
      )}
      {drawnByHand && <p className="text-[13px] text-muted-foreground">{t(takenBack ? 'affectedAreas.mark.takenBack' : 'affectedAreas.mark.drawnByHand')}</p>}

      {!takenBack && <div className="flex flex-wrap items-center gap-2">
        {renamedTo !== null && (
          <JudgmentPress
            tone={REGION_LOOK.confirmed.tone}
            glyph={<Check aria-hidden="true" />}
            out={out === 'keep'}
            busy={busy}
            data-mark-press="keep"
            onClick={onKeep}
          >
            {t('affectedAreas.mark.keep', { kind: shownKind })}
          </JudgmentPress>
        )}
        {!drawnByHand && renamedTo === null && (
          <JudgmentPress
            tone={REGION_LOOK.confirmed.tone}
            glyph={<Check aria-hidden="true" />}
            out={out === 'confirm'}
            busy={busy}
            aria-keyshortcuts={browsing ? undefined : 'Y'}
            data-mark-press="confirm"
            onClick={() => onMark('confirm')}
          >
            {t('affectedAreas.mark.confirm')}
            {!browsing && <KeyCap letter="Y" />}
          </JudgmentPress>
        )}
        {renamedTo !== null && (
          // Confirm on a renamed area puts the reader's kind back: the press says so, in the confirmed look's outline.
          <Button
            variant={null}
            size="sm"
            data-tone={REGION_LOOK.confirmed.tone}
            className={RENAME_FACE}
            busy={busy}
            aria-keyshortcuts={browsing ? undefined : 'Y'}
            data-mark-press="confirm"
            onClick={() => onMark('confirm')}
          >
            {out === 'confirm' ? ring : <Undo2 aria-hidden="true" />}
            {t('affectedAreas.mark.putBack', { kind: kindName(region.class, codebook) })}
            {!browsing && <KeyCap letter="Y" />}
          </Button>
        )}
        {!drawnByHand && (codebook === null ? (
          <Button variant={null} size="sm" data-tone={REGION_LOOK.confirmed.tone} className={RENAME_FACE} disabled data-mark-press="rename">
            {t('affectedAreas.mark.rename')}
            <ChevronDown aria-hidden="true" />
          </Button>
        ) : (
          // The Menu's own button carries the press (and the focus); this face only looks like the outline press
          // beside it. It stays mounted while a mark is out, so focus never falls off a press the operator just used:
          // dimmed then, as the refusing presses beside it are, and a kind chosen while a mark is out is not sent.
          <Menu
            trigger={(
              <span
                data-mark-press="rename"
                data-tone={REGION_LOOK.confirmed.tone}
                className={cn(buttonVariants({ variant: null, size: 'sm' }), RENAME_FACE, busy && 'cursor-not-allowed opacity-70')}
              >
                {t('affectedAreas.mark.rename')}
                {renameGlyph}
                {!browsing && <KeyCap letter="R" />}
              </span>
            )}
            items={kinds}
            onSelect={onRename}
            width={248}
          />
        ))}
        <JudgmentPress
          tone={REGION_LOOK.not_a_change.tone}
          glyph={<X aria-hidden="true" />}
          out={out === 'not_a_change'}
          busy={busy}
          aria-keyshortcuts={browsing ? undefined : 'N'}
          data-mark-press="not_a_change"
          onClick={() => onMark('not_a_change')}
        >
          {t('affectedAreas.mark.notAChange')}
          {!browsing && <KeyCap letter="N" />}
        </JudgmentPress>
        {!drawnByHand && (
          <Button variant="ghost" size="sm" className="max-md:h-11" busy={busy} data-mark-press="note" onClick={onNote}>
            <PenLine aria-hidden="true" />
            {note === '' ? t('affectedAreas.mark.addNote') : t('affectedAreas.mark.editNote')}
          </Button>
        )}
      </div>}

      {note !== '' && (
        <p className="line-clamp-2 text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{t('affectedAreas.mark.noteHeld', { note })}</p>
      )}
      {busy && <p role="status" className="sr-only">{t('affectedAreas.mark.sending')}</p>}
      {refusal !== null && <MarkRefusal reason={refusal} />}
    </section>
  );
}
