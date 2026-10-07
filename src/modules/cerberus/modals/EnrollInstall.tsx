import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { hm } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusEnrollment, CerberusEnrollmentStatus } from '@/shared/cerberus-types';
import type { CerberusEnrollRefusal } from '@/shared/types';
import { Banner, Button, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * Why the last ask for an install command came back without one, as a warn banner where the person is
 * looking: the gateway not listening, Cerberus out of reach, or any other refusal with the server's own
 * sentence under it. Warn and not danger: nothing was denied, and the next ask may well get a command.
 * An alert, so a second refusal is announced and not only repainted.
 *
 * Used by the cerberus module's `EnrollDialog` (asking for the first command, and the gateway down
 * before anyone asks) and by `EnrollInstall` below (asking for a new one).
 */
export function EnrollRefusal({ refusal }: { refusal: CerberusEnrollRefusal }) {
  const { t } = useTranslation();
  const sentence = refusal.kind === 'notListening' ? t('cerberus.enroll.notListening')
    : refusal.kind === 'unreachable' ? t('cerberus.errors.unreachable')
      : t('cerberus.errors.writeFailed');
  return (
    <div role="alert">
      <Banner tone="warn">
        <p className="text-sm font-medium">{sentence}</p>
        {refusal.kind === 'refused' && refusal.sentence !== null && <p className="mt-0.5 text-xs">{refusal.sentence}</p>}
      </Banner>
    </div>
  );
}

/** The three things the dialog waits for, in the order they happen. */
const WAITS = ['token', 'install', 'hello'] as const;

type EnrollInstallProps = {
  /** The command as center issued it, with when its token expires. */
  issued: CerberusEnrollment;
  /** The newest answer to "how far has it got?" for the name; null until the first one lands. */
  status: CerberusEnrollmentStatus | null;
  /** A Copy just landed: the button says "✓ Copied" for a moment. */
  copied: boolean;
  /** A new command is being asked for. */
  issuing: boolean;
  /** Why the last ask for a new command came back without one. */
  refusal: CerberusEnrollRefusal | null;
  onCopy: () => void;
  onReissue: () => void;
};

/**
 * THE INSTALL STEP: the command to run on the new machine, how long its token lasts, and three lines that
 * tick as the machine gets there — ✓ Token issued at once, ✓ Install ran on the machine when the install's
 * enroll step spends the token, ✓ Warden said hello at the warden's first heartbeat. A tick is its ✓ in
 * the positive ink, and to a screen reader the word Completed; a line still waited for is a — and Pending.
 *
 * The command is mono on the raised ground, whole and wrapped anywhere, and one click selects all of it for
 * a hand that copies it itself; Copy says "✓ Copied" once it has. A token that expired says so in a warn
 * banner, with "Get a new install command" in it, which takes focus; the command it can no longer enroll
 * anything with is struck through, Copy goes quiet, and nothing is listened for until a new one is out.
 *
 * Mounted afresh for each command (`EnrollDialog` keys it by the token), so a new one is Copy's again,
 * with focus on it and its ✓ arriving again.
 *
 * Used by the cerberus module's `EnrollDialog`, as its second step.
 */
export function EnrollInstall({ issued, status, copied, issuing, refusal, onCopy, onReissue }: EnrollInstallProps) {
  const { t } = useTranslation();
  const listeningId = useId();
  const expired = status?.token === 'expired';
  const done = {
    token: true,
    install: (status?.installRanAt ?? null) !== null,
    hello: (status?.node?.firstHeartbeatAt ?? null) !== null,
  };

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-sm leading-[1.6] text-secondary-foreground">{t('cerberus.enroll.run')}</p>

      <div className="flex items-start gap-2.5 rounded-[10px] bg-muted px-3.5 py-3">
        {/* A dead command keeps its ink: muted ink on this raised ground reads 4.45:1 in light, under AA. */}
        <code className={cn('min-w-0 flex-1 select-all font-mono text-xs leading-[1.6] text-secondary-foreground [overflow-wrap:anywhere]', expired && 'line-through')}>
          {issued.command}
        </code>
        <Button type="button" variant="outline" size="sm" autoFocus className="h-8 flex-none px-3 max-md:h-11" disabled={expired} onClick={onCopy}>
          {/* Both words in one cell, the one not said held invisible, so the button is always as wide as the
              wider of them and the command beside it never re-wraps when Copy turns into "✓ Copied". */}
          <span className="grid justify-items-center">
            <span className="col-start-1 row-start-1">{copied ? t('cerberus.enroll.copied') : t('cerberus.enroll.copy')}</span>
            <span aria-hidden className="invisible col-start-1 row-start-1">{copied ? t('cerberus.enroll.copy') : t('cerberus.enroll.copied')}</span>
          </span>
        </Button>
      </div>

      {expired ? (
        <div role="alert">
          <Banner tone="warn">
            <p className="text-sm font-medium">{t('cerberus.enroll.expired', { time: hm(issued.expiresAt) })}</p>
            {/* Focus comes here as the banner appears: it sat on Copy, which goes quiet with the token, and a
                disabled control drops focus to the page, outside the dialog. */}
            <Button
              type="button"
              variant="tonal"
              size="sm"
              autoFocus
              className="mt-2.5 h-8 px-3 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 max-md:h-11"
              aria-disabled={issuing || undefined}
              aria-busy={issuing || undefined}
              onClick={() => {
                // aria-disabled keeps the focus the button holds while the ask is out; the press is ignored here.
                if (!issuing) onReissue();
              }}
            >
              {t('cerberus.enroll.getNewCommand')}
            </Button>
          </Banner>
        </div>
      ) : (
        <>
          <p className="text-[12.5px] text-muted-foreground">{t('cerberus.enroll.expires', { time: hm(issued.expiresAt) })}</p>
          <section aria-labelledby={listeningId} className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3.5">
            <div className="flex items-center gap-3">
              <Spinner size={20} />
              <h3 id={listeningId} className="m-0 text-sm font-medium [overflow-wrap:anywhere]">
                {t('cerberus.enroll.listening', { name: issued.name })}
              </h3>
            </div>
            <ul aria-live="polite" className="m-0 flex list-none flex-col gap-2 p-0">
              {WAITS.map((wait) => (
                <li key={wait} data-done={done[wait] || undefined} className="flex gap-2.5 text-[13px] text-secondary-foreground">
                  {/* Keyed by its state, so a ✓ that lands is a new mark: it arrives on `cerberus-check`, and a
                      live region announces an addition where it may miss a changed name. */}
                  <span
                    key={done[wait] ? 'done' : 'waiting'}
                    role="img"
                    aria-label={t(done[wait] ? 'status.completed' : 'status.pending')}
                    data-tone={done[wait] ? 'positive' : undefined}
                    className={cn('w-3 flex-none text-center', done[wait] ? 'text-tone-ink motion-safe:animate-cerberus-check' : 'text-muted-foreground')}
                  >
                    {done[wait] ? '✓' : '—'}
                  </span>
                  {t(`cerberus.enroll.wait.${wait}`)}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {refusal !== null && <EnrollRefusal refusal={refusal} />}
    </div>
  );
}
