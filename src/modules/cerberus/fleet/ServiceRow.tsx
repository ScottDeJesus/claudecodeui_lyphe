import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { runOnService } from '@/modules/cerberus/fleet/fleetModel';
import { StatusCell, StatusPill } from '@/modules/cerberus/StatusMarks';
import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { hm } from '@/modules/cerberus/utils/cerberusTime';
import { serviceSentence } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusCell, CerberusCheckView, CerberusServiceView } from '@/shared/cerberus-types';
import type { CerberusSheetTarget } from '@/shared/types';
import { cn } from '@/shared/utils';

type ServiceRowProps = {
  /** The node the service runs on: half of every sheet target the row hands up. */
  node: string;
  service: CerberusServiceView;
  /**
   * `grid` is a row of an open node card, on the card's surface. `list` is a row of a list's open band,
   * on the canvas and indented under its node, a little tighter.
   */
  face: 'grid' | 'list';
  /** Opens the check sheet: a minute at the check that set it, or the row as a whole at now. */
  onOpenCell: (target: CerberusSheetTarget) => void;
};

/**
 * The id of the check a press opens the sheet on: the check that set the minute, when one did (the read
 * model names one for any minute worse than passing); else the service's check at its own word now,
 * its worst; else its first. A passing minute, and a healthy service's row, still open on a check.
 * `undefined` only for a service with no check, whose press opens nothing.
 */
function checkIdFor(service: CerberusServiceView, worst: string | null): string | undefined {
  const pick: CerberusCheckView | undefined = service.checks.find((entry) => entry.key === worst)
    ?? service.checks.find((entry) => entry.status === service.status)
    ?? service.checks[0];
  return pick?.id;
}

/**
 * ONE SERVICE OF AN OPEN NODE: its plain name over its raw id, a pill saying how it stands, and its
 * last 30 minutes. With no label yet, the raw id stands in as the name, in mono, and is not written a
 * second time under itself.
 *
 * The pill is the service's folded status, so its glyph and its sentence (`serviceSentence`) always
 * agree: "Session is valid — failing", "2 checks need you", "2 of 3 passing · 1 muted", "All 3 checks
 * passing", "Its check is passing". While a fix runs on one of its checks (`overview.running`) the pill is
 * the info ● and says "Fix running on its own" / "Fix running" by who started it.
 *
 * The minutes are the read model's strip, oldest on the left, each a `StatusCell` named on hover by
 * its time, its word and, when it folds several checks, the check that set it. The newest minute is
 * now: it breathes, or rings while it is failing. A click on a minute opens the sheet on the check that
 * set it, looked up at the moment the minute's word was reached (`cell.at`, which the sheet's own strip
 * looks a minute up at too), and at now for the minute still running. A fixed second would not always
 * be the cell's word, which is the worst over the whole minute: the last second reads the word that
 * came after a run's last minute, the first second misses a run's first. The cells are a pointer's
 * shortcut and take no tab stop: thirty stops per service would bury the keyboard. The name and pill
 * are one button, which opens the sheet at now, and the sheet's own strip steps through every minute
 * from the keyboard.
 *
 * Used by Fleet's `NodeCard`, for each service of an open node in Grid and in List.
 */
export function ServiceRow({ node, service, face, onOpenCell }: ServiceRowProps) {
  const { t } = useTranslation();
  const grid = face === 'grid';
  const newest: CerberusCell | undefined = service.cells[service.cells.length - 1];
  // The run going on one of this service's checks, which the pill speaks of in place of the service's word.
  const { overview } = useCerberus();
  const run = runOnService(overview?.running ?? [], node, service);

  /** Opens the sheet on the check a press resolves to, looked up at `lookupAt`; left out, at now. */
  const openAt = (worst: string | null, lookupAt?: number) => {
    const check = checkIdFor(service, worst);
    if (check !== undefined) onOpenCell({ node, service: service.service, check, lookupAt });
  };

  /** "17:52 · Failing", and "· <check>" when the minute folds several checks: a minute's tooltip and name. */
  const nameOf = (cell: CerberusCell): string => {
    const word = t(STATUS_TABLE[cell.status].wordKey);
    return cell.worst === null
      ? t('cerberus.service.cellTip', { time: hm(cell.from), word })
      : t('cerberus.sheet.cellTipWorst', { time: hm(cell.from), word, check: cell.worst });
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pr-4',
        'transition-[background-color,transform] duration-move ease-enter hover:translate-x-[3px] motion-reduce:hover:translate-x-0',
        grid ? 'py-2.5 pl-4 hover:bg-background' : 'py-[9px] pl-[clamp(16px,10cqi,60px)] hover:bg-card',
      )}
    >
      <button
        type="button"
        // The row as a whole, at now: `openAt` resolves the check that set its newest minute, else the
        // service's worst, and hands the root's onOpenCell its node, service and that check's id.
        onClick={() => openAt(newest?.worst ?? null)}
        className="flex min-w-0 flex-[2_1_360px] flex-wrap items-center gap-x-4 gap-y-2 text-left"
      >
        <span className="min-w-0 flex-[1_1_150px]">
          {service.label !== null ? (
            <>
              <span className={cn('block truncate font-medium', grid ? 'text-sm' : 'text-[13.5px]')}>{service.label}</span>
              <span className="block truncate font-mono text-[11px] text-ink-faint">{service.service}</span>
            </>
          ) : (
            <span className="block truncate font-mono text-[13px] font-medium">{service.service}</span>
          )}
        </span>
        <span className="flex min-w-0 flex-[1_1_200px]">
          <StatusPill status={run === null ? service.status : 'fixing'} text={serviceSentence(t, service, run)} />
        </span>
      </button>
      <span role="group" aria-label={t('cerberus.sheet.cells')} className="flex flex-none gap-0.5">
        {service.cells.map((cell) => {
          const name = nameOf(cell);
          const isNewest = cell === newest;
          return (
            <StatusCell
              key={cell.from}
              status={cell.status}
              label={name}
              title={name}
              // A minute: `openAt` hands onOpenCell the check that set it, looked up at the moment its
              // word was reached (`cell.at`), as the sheet's strip does, and at now for the minute still running.
              onClick={() => openAt(cell.worst, isNewest ? undefined : cell.at)}
              className={cn(
                'w-[7px] cursor-pointer transition-transform duration-move ease-spring hover:scale-y-[1.3] motion-reduce:transition-none',
                grid ? 'h-[22px]' : 'h-5',
                isNewest && (cell.status === 'failing' ? 'motion-safe:animate-cerberus-ring-warn' : 'motion-safe:animate-cerberus-breathe'),
              )}
            />
          );
        })}
      </span>
    </div>
  );
}
