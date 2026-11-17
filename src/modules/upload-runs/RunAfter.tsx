import { useTranslation } from 'react-i18next';

import { dayClockWord, whoWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadConfirmation, UploadWalk } from '@/shared/upload-runs-types';
import { Badge } from '@/shared/ui';

type RunAfterProps = {
  /** The run's walks: a confirmation names the armed walk it confirmed. */
  walks: UploadWalk[];
  /** The confirmations of the run's armed walks, as the read gives them. */
  after: UploadConfirmation[];
  /** The press walks those confirmations led to. */
  presses: UploadWalk[];
};

/**
 * AFTER THE RUN: what a person did with what the run prepared. An upload is pressed by its own act, after a person
 * confirms the armed walk, so the run ending is not the upload landing, and this section is where that is said.
 *
 * ONE LINE A CONFIRMATION, oldest first: who confirmed, when, through which surface and for which walk's flow; then what
 * became of it. Pressed: when the press fired and how the press walk ended, in the engine's word. Revoked: when and why,
 * in the words stored with it, amber when a person or a changed job withdrew it and grey when it was the system's own
 * bookkeeping (a newer confirmation replaced it). Neither: it still stands and waits for the press, until the time it
 * expires.
 *
 * WITH NONE, TWO DIFFERENT SENTENCES: a run that made a walk for real says "Not confirmed yet"; a run that made none says
 * there was nothing to confirm. A person's login, a surface, a flow, an outcome and a revoke reason are data.
 *
 * Used by this module's `RunSheet`, as its fourth section.
 */
export function RunAfter({ walks, after, presses }: RunAfterProps) {
  const { t } = useTranslation();
  const a = 'cerberus.uploads.sheet.after';

  if (after.length === 0) {
    const armed = walks.some((walk) => walk.armed);
    return <p className="m-0 rounded-lg border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground" data-uploads-after="0">{t(armed ? `${a}.notYet` : `${a}.nothing`)}</p>;
  }

  const ordered = [...after].sort((x, y) => (x.confirmed_at ?? '').localeCompare(y.confirmed_at ?? ''));
  return (
    <ul className="m-0 flex min-w-0 list-none flex-col divide-y divide-border rounded-lg border border-border p-0" data-uploads-after={after.length}>
      {ordered.map((entry) => {
        const walk = walks.find((candidate) => candidate.id === entry.walk_id);
        const press = entry.consumed_by_run_id === null ? undefined : presses.find((candidate) => candidate.id === entry.consumed_by_run_id);
        const state = entry.consumed_at !== null ? 'pressed' : entry.revoked_at !== null ? (entry.bookkeeping_revoke ? 'replaced' : 'revoked') : 'standing';
        return (
          <li key={entry.grant_id} className="flex min-w-0 flex-col gap-1.5 px-3.5 py-3 text-[13px] leading-snug" data-upload-confirmation={state}>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words font-medium text-foreground">{t(`${a}.confirmedBy`, { who: whoWord(t, entry.confirmed_by) })}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{entry.confirmed_at === null ? t(`${a}.noTime`) : dayClockWord(entry.confirmed_at)}</span>
              {state === 'pressed' && <Badge as="span" tone="positive">{t(`${a}.pressed`)}</Badge>}
              {state === 'revoked' && <Badge as="span" tone="warn">{t(`${a}.revoked`)}</Badge>}
              {state === 'replaced' && <Badge as="span" tone="neutral">{t(`${a}.replaced`)}</Badge>}
              {state === 'standing' && <Badge as="span" tone="info">{t(`${a}.standing`)}</Badge>}
            </span>
            <span className="min-w-0 break-words text-xs text-muted-foreground">
              {t(`${a}.through`, { via: entry.granted_via })}
              {walk !== undefined && <> · <span className="font-mono">{walk.archetype}</span></>}
            </span>
            {state === 'pressed' && entry.consumed_at !== null && (
              <span className="min-w-0 break-words text-foreground">
                {press === undefined
                  ? t(`${a}.pressedAt`, { when: dayClockWord(entry.consumed_at) })
                  : <>{t(`${a}.pressedAtEnded`, { when: dayClockWord(entry.consumed_at) })} <span className="font-mono text-xs">{press.outcome}</span></>}
              </span>
            )}
            {(state === 'revoked' || state === 'replaced') && entry.revoked_at !== null && (
              <span className="min-w-0 break-words text-foreground">
                {t(`${a}.revokedAt`, { when: dayClockWord(entry.revoked_at) })}{entry.revoke_reason === null ? '' : ` ${entry.revoke_reason}`}
              </span>
            )}
            {state === 'standing' && <span className="min-w-0 break-words text-muted-foreground">{t(`${a}.expires`, { when: dayClockWord(entry.expires_at) })}</span>}
          </li>
        );
      })}
    </ul>
  );
}
