import type { TFunction } from 'i18next';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useRunLastLine } from '@/modules/cerberus/hooks/useRunLastLine';
import { RUN_LOOK } from '@/modules/cerberus/utils/cerberusStatus';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCatalogEntryView, CerberusNeed, CerberusRunView } from '@/shared/cerberus-types';
import type { CerberusSheetTarget, Tone } from '@/shared/types';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The strip's tone, glyph and first line. A going run is info and wears no glyph: its words say it. An
 * ended one takes `RUN_LOOK`'s glyph, and its tone too but for a run that succeeded, which is neutral —
 * the fix did its part, and the check is still failing until its next result says otherwise.
 */
function stripLook(t: TFunction, run: CerberusRunView): { tone: Tone; glyph: string | null; title: string } {
  const { name } = run;
  if (run.result === null) {
    return { tone: 'info', glyph: null, title: t(run.by === 'auto' ? 'cerberus.fix.strip.runningAuto' : 'cerberus.fix.strip.running', { name }) };
  }
  const look = RUN_LOOK[run.result];
  // An ended run is stamped when it ended, by its warden's clock: the moment it printed its last word.
  const time = hms(run.endedAt ?? run.requestedAt);
  switch (run.result) {
    case 'ok':
      return { tone: 'neutral', glyph: look.glyph, title: t('cerberus.fix.strip.finished', { name, time }) };
    case 'refused':
      return { ...look, title: t('cerberus.fix.strip.refused', { name }) };
    case 'timed_out':
      return { ...look, title: t('cerberus.fix.strip.timedOut', { name, time }) };
    case 'failed':
      return {
        ...look,
        title: run.exit === null
          ? t('cerberus.fix.strip.failed', { name, time })
          : t('cerberus.fix.strip.failedExit', { name, time, exit: run.exit }),
      };
  }
}

type NeedFixProps = {
  /** The need the card draws: its check, the fix offered for it (or null) and its recent run (or null). */
  need: CerberusNeed;
  /** The card has stopped needing you and is leaving: drawn as it was, taking no press. */
  leaving: boolean;
  /** Opens the check sheet: the card's own `onOpen`, which the root hands down. */
  onOpen: (target: CerberusSheetTarget) => void;
};

/**
 * A NEEDS-YOU CARD'S FIX (`design/cerberus/Cerberus Tab.dc.html` :77-84): the run strip, then the fix the
 * card offers. Mounted in the card's row of actions, before Mute; the strip takes a line of its own at
 * the row's indent (`basis-full`), and the button joins the row.
 *
 * THE STRIP, while the check has a recent run (going, or ended under 90 s ago; the read model decides):
 * - going — "Running on its own · <name>" or "Running · <name>", info;
 * - ended ok — "✓ <name> finished 17:50:14 · waiting for the next check", neutral: the fix did its part,
 *   and the check passes when its next result says so;
 * - failed or timed out — "▲ <name> finished 17:49:21 · Failed · exit 1" or "· Timed out", warn;
 * - refused — "✕ The warden refused “<name>”", danger: the only red, a command no acked catalog holds.
 * Under the words, the run's last line in mono, cut at one line (the whole of it on hover); the warden's
 * or center's own sentence when the run ended on one (a refusal's reason) in the body face, since it is
 * not output, kept to two lines rather than one: it is what the person acts on, and a phone shows no
 * hover; "$ <cmd>" before any line. The strip opens the sheet on this run's output.
 *
 * THE BUTTON, "Run “<name>”" (tonal), while the card offers a fix and no run is going — so again after
 * one ended. A long name wraps rather than running out of the card on a phone. While its press is out it
 * reads "Running…", as the Catalog and the sheet read for the same moment, stays in the tab order and
 * takes no second press (`aria-disabled`, never `disabled`, which would blur it under the person who
 * pressed it). When the press lands and the strip takes the button's place, the strip takes its focus too,
 * if the button had it: a keyboard user does not find themselves back at the top of the page.
 *
 * Draws nothing for a need with neither.
 *
 * For Fleet's `NeedsYouCard`, once per card.
 */
export function NeedFix({ need, leaving, onOpen }: NeedFixProps) {
  const { t } = useTranslation();
  const { check, fix, run } = need;
  const { starting: pressing, runEntry } = useCerberus();
  // The run's newest line: the overview's, and each frame's as it lands while the run goes.
  const lastLine = useRunLastLine(run);
  // True while this card's Run press is out (`runEntry` waits up to 10 s for the warden's ack).
  const starting = fix !== null && pressing.includes(fix.id);

  const going = run !== null && run.result === null;
  // The strip, and whether the press that starts a run should hand it the button's focus. A ref, not state:
  // it steers one focus call and changes nothing drawn.
  const stripRef = useRef<HTMLButtonElement>(null);
  const focusStripRef = useRef(false);
  const onRun = (entry: CerberusCatalogEntryView, pressed: HTMLElement) => {
    focusStripRef.current = pressed.ownerDocument.activeElement === pressed;
    // A press that did not land leaves the button where it was, so the focus is not owed.
    void runEntry(entry.id).then((landed) => {
      if (!landed) focusStripRef.current = false;
    });
  };
  // Once the overview holds the run, the strip has taken the button's place: a press that had focus hands it on.
  useEffect(() => {
    if (going && focusStripRef.current) {
      focusStripRef.current = false;
      stripRef.current?.focus();
    }
  }, [going]);

  if (run === null && fix === null) return null;
  const look = run === null ? null : stripLook(t, run);
  // What the strip's second line says: the sentence the run ended on, else its newest line, else its command.
  const said = run?.note ?? null;
  const detail = said ?? lastLine ?? (run === null ? '' : t('cerberus.fix.command', { cmd: run.cmd }));

  return (
    <>
      {run !== null && look !== null && (
        <button
          ref={stripRef}
          type="button"
          data-tone={look.tone}
          disabled={leaving}
          // The sheet on this check, showing this run's output.
          onClick={() => onOpen({ node: check.node, service: check.service, check: check.id, run: run.id })}
          className="flex min-w-0 basis-full flex-col gap-[3px] rounded-[10px] bg-tone-soft px-3 py-[9px] text-left motion-safe:transition-transform motion-safe:hover:-translate-y-px"
        >
          <span className={cn('text-[12.5px] font-medium', run.result === 'ok' ? 'text-secondary-foreground' : 'text-tone-ink')}>
            {/* An ended run's glyph; a run that succeeded keeps its ✓ in the positive ink on the neutral strip. */}
            {look.glyph !== null && <span aria-hidden data-tone={run.result === 'ok' ? 'positive' : undefined} className={cn(run.result === 'ok' && 'text-tone-ink')}>{look.glyph} </span>}
            {look.title}
          </span>
          <span
            title={detail}
            // `line-clamp-2` brings its own display (`-webkit-box`), so `block` goes only with the one-line cut.
            className={cn('w-full text-secondary-foreground', said === null ? 'block truncate font-mono text-[11.5px]' : 'line-clamp-2 text-[12.5px]')}
          >
            {detail}
          </span>
        </button>
      )}
      {fix !== null && !going && (
        <Button
          variant="tonal"
          size="sm"
          disabled={leaving}
          busy={starting}
          onClick={(event) => onRun(fix, event.currentTarget)}
          className="h-auto min-h-9 max-w-full whitespace-normal py-1.5 text-left"
        >
          {starting ? t('cerberus.catalog.running') : t('cerberus.fix.run', { name: fix.name })}
        </Button>
      )}
    </>
  );
}
