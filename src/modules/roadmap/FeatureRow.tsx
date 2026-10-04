import { Check } from 'lucide-react';
import { useContext, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { FAKE_CELEBRATION_CONTEXT } from '@/modules/roadmap/fake'; // FILL: fake — import { CelebrationContext } from '@/modules/roadmap/celebrationContext';
import { useStepPhrase } from '@/modules/roadmap/hooks/useStepPhrase';
import { StateLine } from '@/modules/roadmap/StateLine';
import type { RoadmapFeature } from '@/shared/roadmap-types';
import { Badge, Button, Chip, Meter, Shimmer } from '@/shared/ui';
import { cn, folderName } from '@/shared/utils';

/**
 * The shipped row's one sweep: a soft band crossing it once (`roadmap-sweep`'s own comment in
 * `tailwind.config.js` names this className). Every piece is behind `motion-safe:` — the band too, or
 * a reader who asked for less motion would keep a still band parked on the row's left half.
 */
const SWEEP = 'motion-safe:bg-gradient-to-r motion-safe:from-transparent motion-safe:via-primary/15 motion-safe:to-transparent motion-safe:bg-[length:50%_100%] motion-safe:bg-no-repeat motion-safe:animate-roadmap-sweep';

/**
 * A task moment's figure pop, on the meter's own figure. `.vv-meter__value` is the library's marker
 * class for that figure (a marker is surface, MAN-740 rule 3), and this adds motion to it, never paint;
 * the pop is the config's `roadmap-pop`, shortened to the task's 240ms.
 *
 * `String.raw` and `\_` because Tailwind reads an underscore in an arbitrary variant as a SPACE: spelled
 * plainly, `[&_.vv-meter__value]` compiled to `.vv-meter value` — a `<value>` element, which matches
 * nothing — and the figure never moved. `\_` keeps the underscore, and `String.raw` keeps the backslash
 * in the class the browser sees, so the class and the rule Tailwind wrote for it are the same string.
 */
const FIGURE_POP = String.raw`motion-safe:[&_.vv-meter\_\_value]:animate-roadmap-pop motion-safe:[&_.vv-meter\_\_value]:[animation-duration:240ms]`;

type FeatureRowProps = {
  feature: RoadmapFeature;
  /** A press on the row: its title, or anywhere on it that is not its Answer. */
  onOpen: (feature: RoadmapFeature) => void;
  /** `full` in an epic's card; `compact` in the rail and the chat gutter's widget, which drop the project. */
  density: 'full' | 'compact';
};

/**
 * One feature as one line of state: its step line, its title, its step in words with its project
 * beside them; a meter of its tasks while it is in flight; and, in warn, what it waits on the operator
 * for (in place of the step and the project) and why it is blocked. Used by `EpicCard` for its
 * features, by `RoadmapRail` at `compact` for its four sections, and by the chat gutter's roadmap
 * widget, which imports it through the module's barrel.
 *
 * A ROW, NOT A BUTTON, SO IT CAN BE CARRIED. An epic's rows are a sortable list, and `useSortable` lifts
 * an item only from a free press — never from a control (`freePress.ts`). So the row is a free surface
 * that opens on a click anywhere (the KanbanCard's own shape), and its title is the real button: the
 * keyboard's and the screen reader's way in, whose click bubbles to the row's one handler. The Answer
 * press stops its own click there, so answering never opens the row too.
 *
 * MOTION ONLY WHERE WORK MOVES. A building feature's step word carries Verve's shimmer (the library's
 * `Shimmer`, the composer's live-activity text); everything else is still until a moment names this
 * row: a task moment regrows the meter (`data-vv-enter`) and pops its figure; a feature moment pops the
 * shipped station, rings it, sweeps the row and stamps "Shipped". Under reduced motion both are still:
 * the row holds a wash, with its words, for as long as the moment is named.
 */
export function FeatureRow({ feature, onOpen, density }: FeatureRowProps) {
  const { t } = useTranslation();
  const active = useContext(FAKE_CELEBRATION_CONTEXT); // FILL: active — useContext(CelebrationContext)
  const reveal = (_plan: string) => {}; // FILL: reveal — the opener of a plan's live card, a hook read here: on the Roadmap tab, RoadmapTab's onOpenCard, read from the face context RoadmapPath provides (RoadmapTab hands it down: its face set to In flight, the plan's name handed down to RunnerPanel); in the chat gutter's widget, which has no RoadmapTab above it, the workspace's `?runner=<plan>` landing (design B)
  const phrase = useStepPhrase(feature);
  const titleId = useId();

  const compact = density === 'compact';
  const owed = feature.waiting_on_you;
  const done = feature.tasks.filter((task) => task.status === 'done').length;
  const total = feature.tasks.length;
  const metered = feature.word === 'in flight' && total > 0;
  const taskMoment = active.tasks.has(feature.name);
  const shipMoment = active.features.has(feature.name);

  // The one Answer press: at the end of the title's line in a compact row, whose width cannot hold it
  // beside its badge; beside the badge in a full row, wrapping under a long one.
  const answer = owed !== null && (
    <Button
      variant="tonal"
      size="sm"
      className="h-7 shrink-0 px-2.5 text-xs"
      aria-describedby={titleId}
      onClick={(event) => {
        event.stopPropagation();
        reveal(feature.name);
      }}
    >
      {t('roadmap.feature.answer')}
    </Button>
  );

  // The project, at the end of the step phrase's line — never on the title's line, where it took a third
  // of the width and wrapped most titles, and never on the amber line of a row that waits on the operator,
  // which holds what he owes and the one press that answers it (the dialog names the project). Full rows only.
  const project = !compact && (
    <span className="-my-0.5 ml-auto shrink-0">
      <Chip size="sm">{feature.project ?? folderName(feature.repo)}</Chip>
    </span>
  );

  return (
    <div
      data-roadmap-feature={feature.name}
      data-celebrating={shipMoment ? 'feature' : taskMoment ? 'task' : undefined}
      onClick={() => onOpen(feature)}
      className={cn(
        'relative flex min-w-0 cursor-pointer items-start rounded-lg hover:bg-muted/60',
        compact ? 'gap-2.5 px-2 py-1.5' : 'gap-3 px-2.5 py-2',
        (taskMoment || shipMoment) && 'motion-reduce:bg-primary/10',
        shipMoment && SWEEP,
      )}
    >
      {/* The step line sits on the title's first line: h-5 is the title's own line height. */}
      <span className="flex h-5 shrink-0 items-center">
        <StateLine word={feature.word} step={feature.step} phrase={phrase} size="row" celebrating={shipMoment} />
      </span>

      <div className="min-w-0 flex-1">
        {/* The title is the row's first fact: it has its line to itself, and wraps to a second rather than lose its end. */}
        <div className="flex min-w-0 items-start gap-2">
          <button type="button" id={titleId} className="min-w-0 text-left text-sm font-medium leading-5 text-foreground">
            <span className="line-clamp-2 break-words">{feature.title}</span>
          </button>
          {shipMoment && (
            <Badge tone="positive" className="shrink-0 motion-safe:animate-roadmap-pop">
              <Check aria-hidden="true" className="mr-1 size-3" strokeWidth={3} />
              {t('roadmap.celebrate.shipped')}
            </Badge>
          )}
          {compact && answer && <span className="-my-1 ml-auto">{answer}</span>}
        </div>

        {/* What it waits on the operator for IS its step, spelled in warn on this same line — so the muted phrase steps aside rather than say it twice. */}
        {owed === null ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 break-words text-xs text-muted-foreground">
              {feature.step === 'building' ? <Shimmer>{phrase}</Shimmer> : phrase}
            </p>
            {project}
          </div>
        ) : (
          // A warn SENTENCE is a soft block (`rounded-lg`), not a pill: where a card is too narrow to hold it
          // on one line it wraps into a block that still reads, instead of a pill swollen to two lines. It keeps
          // the badge's own size in a compact row too — what the operator owes is never the row's smallest type.
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge tone="warn" className="rounded-lg text-left leading-snug">
              {owed === 'accept' ? t('roadmap.feature.waitingAccept') : t('roadmap.feature.waitingQuestions')}
            </Badge>
            {!compact && answer}
          </div>
        )}

        {metered && (
          <div className={cn('mt-1.5', taskMoment && FIGURE_POP)} data-vv-enter={taskMoment ? '' : undefined}>
            <Meter
              variant="inline"
              percent={Math.round((done / total) * 100)}
              label={t('roadmap.feature.done')}
              value={t('roadmap.feature.tasks', { done, count: total })}
            />
          </div>
        )}

        {/* A row's reason stays one line, cut: the row is the summary, and pressing it opens the dialog that holds the whole reason. */}
        {feature.blocked !== null && (
          <div className="mt-1.5 flex min-w-0">
            <Badge tone="warn" title={feature.blocked} className="min-w-0 max-w-full rounded-lg">
              <span className="truncate">{t('roadmap.blocked', { why: feature.blocked })}</span>
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
