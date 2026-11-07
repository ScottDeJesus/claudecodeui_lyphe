import {
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  MessageSquareQuoteIcon,
  RepeatIcon,
  ScrollTextIcon,
  StickyNoteIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { HealRule, HealRuleRow } from '@/modules/heal/healRuleTypes';
import { projectNamer } from '@/modules/heal/healState';
import { useRuleReview, type RuleReview } from '@/modules/heal/hooks/useRuleReview';
import type { ProjectChoice, Tone } from '@/shared/types';
import { Badge, Button, Card, EmptyState } from '@/shared/ui';
import { cn, formatShortDate } from '@/shared/utils';

type TFn = ReturnType<typeof useTranslation>['t'];

/** The project as CloudCLI names it, from a transcript folder's slug. */
type ProjectName = (slug: string) => string;

/** The Memory door's own glyphs for the same destinations (MemoryCandidateRow): a project's rule lands as a topic note. */
const SHELF_ICONS: Record<HealRule['shelf'], LucideIcon> = { rules: ScrollTextIcon, requirements: ClipboardListIcon, memory: StickyNoteIcon };

/**
 * The Rules section's list — mounted by HealPanel's Rules section, between Friction by kind and the heals. It wires the
 * two things the drawing cannot know: the Memory door's presses (`useRuleReview`) and CloudCLI's project names, drawn
 * from the projects the workspace holds, which HealPanel is handed and passes down.
 */
export function HealRuleList({ rules, more, projectChoices }: { rules: HealRule[]; more: number; projectChoices: readonly ProjectChoice[] }) {
  const review = useRuleReview();
  const projectName = useMemo(() => projectNamer(projectChoices), [projectChoices]);
  return <HealRuleListView rules={rules} more={more} review={review} projectName={projectName} />;
}

/**
 * Every rule the heal lifted from a correction he made again, one card each, drawn on what it is handed.
 * Used by HealRuleList, which wires it; exported so a fixture can draw every state on fake props.
 *
 * HIS WORDS ARE THE CARD. The title is his sentence in quotation marks; under it where the rule would land and,
 * in one toned sentence, where it stands — blue while it waits for his press, green once it is on a shelf, amber when
 * the door refused it, lost it or could not be read, grey on its way to Memory or once discarded. A rule found on a
 * shelf is titled with his newest row's words, and the shelf's own line stands under its state: unquoted, its markdown
 * dropped, two lines until pressed open. Then every row it came from, each in the words that row said it in: nothing
 * is folded away, because the rows are the evidence he decides on.
 *
 * THE DOOR'S TWO PRESSES AND NO THIRD VERB. A rule waiting with a candidate carries the Memory door's own file it and
 * discard beside the state they act on, above the rows, so the rule said most often keeps them in view: discarding is
 * how a wrongly grouped rule goes. Nothing here detaches a row.
 */
export function HealRuleListView({ rules, more, review, projectName }: { rules: HealRule[]; more: number; review: RuleReview; projectName: ProjectName }) {
  const { t } = useTranslation();
  // `more` without rules cannot be drawn as "none": the empty words are for a summary that holds no rule at all.
  // The kit's quiet frame (`sm`, "a place that keeps its room while it holds nothing yet"): on the desktop grid this
  // section shares a column with the kinds, and the full frame overflowed its half and squeezed them to four rows.
  if (rules.length === 0 && more === 0) {
    return (
      <div className="flex items-center justify-center px-4 py-8" data-heal-rules-empty>
        <EmptyState
          size="sm"
          icon={MessageSquareQuoteIcon}
          title={t('heal.rules.empty.title', { defaultValue: 'No correction has come back' })}
          message={t('heal.rules.empty.message', { defaultValue: 'Correct the same thing again in another chat and it lands here as one rule, in your own words, waiting in Memory for your press.' })}
        />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3" data-heal-rules>
      <ul className="flex min-w-0 flex-col gap-3">
        {rules.map((rule) => (
          <li key={rule.id} className="min-w-0">
            <RuleCard rule={rule} review={review} projectName={projectName} />
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="px-1 text-xs text-muted-foreground" data-heal-rules-more>
          {t('heal.rules.more', { count: more, defaultValue_one: '{{count}} older rule is not shown', defaultValue_other: '{{count}} older rules are not shown' })}
        </p>
      )}
    </div>
  );
}

/** The day a row was said, in the reader's own short date. */
const dayOf = (ts: number): string => formatShortDate(new Date(ts * 1000).toISOString()) ?? '—';

/** His newest words among a rule's rows, or null when no row kept any. */
const newestWords = (rows: HealRuleRow[]): string | null =>
  rows.reduce<HealRuleRow | null>((newest, row) => (row.quote && (newest === null || row.ts > newest.ts) ? row : newest), null)?.quote ?? null;

/**
 * A shelf's line read as prose: its bold and code ticks dropped, a bullet or heading mark gone — at a line's start, and
 * after the " — " a lane joins a chat candidate's name to its body with — one run of words.
 */
const plainShelf = (text: string): string => text.replace(/\*\*|`/g, '').replace(/(^|\s—\s)\s*(?:[-*]|#{1,6})\s+/gm, '$1').replace(/\s+/g, ' ').trim();

/**
 * Where a rule stands, in his words, and the tone it reads in. The decision is the queue's; a rule with none is
 * a shelf entry found before the heal — or, for a queued rule, a decision nobody could read, said as such.
 */
function stateOf(rule: HealRule, t: TFn): { key: string; tone: Tone; words: string } {
  const decision = rule.decision;
  const unreadable = { key: 'unreadable', tone: 'warn' as const, words: t('heal.rules.state.unreadable', { defaultValue: 'Memory could not be read just now' }) };
  if (decision === null) {
    return rule.state === 'shelf'
      ? { key: 'onShelf', tone: 'positive', words: t('heal.rules.state.onShelf', { defaultValue: 'already on your shelf before the heal' }) }
      : unreadable;
  }
  const date = formatShortDate(decision.decided_at);
  switch (decision.status) {
    case 'pending':
      return rule.state === 'shelf'
        ? { key: 'queuedByChat', tone: 'info', words: t('heal.rules.state.queuedByChat', { defaultValue: 'already waiting in Memory, queued by a chat' }) }
        : { key: 'waiting', tone: 'info', words: t('heal.rules.state.waiting', { defaultValue: 'waiting for you in Memory' }) };
    case 'approved':
      return { key: 'filed', tone: 'positive', words: date
        ? t('heal.rules.state.filed', { date, defaultValue: 'on your shelf since {{date}}' })
        : t('heal.rules.state.filedUndated', { defaultValue: 'on your shelf' }) };
    case 'rejected':
      return { key: 'discarded', tone: 'neutral', words: date
        ? t('heal.rules.state.discarded', { date, defaultValue: 'discarded {{date}}, its rows stay in the record' })
        : t('heal.rules.state.discardedUndated', { defaultValue: 'discarded, its rows stay in the record' }) };
    case 'unstaged':
      return { key: 'unstaged', tone: 'neutral', words: t('heal.rules.state.unstaged', { defaultValue: 'on its way to Memory' }) };
    case 'refused':
      return { key: 'refused', tone: 'warn', words: decision.refusal
        ? t('heal.rules.state.refused', { reason: decision.refusal, defaultValue: 'the Memory door refused it: {{reason}}' })
        : t('heal.rules.state.refusedBare', { defaultValue: 'the Memory door refused it' }) };
    case 'missing':
      return { key: 'missing', tone: 'warn', words: t('heal.rules.state.missing', { defaultValue: 'no longer found in Memory' }) };
    default:
      return unreadable;
  }
}

/** The rows read open while the rule waits for his press, closed once it is on a shelf, and carry neither word otherwise. */
function rowsWord(rule: HealRule): 'open' | 'closed' | null {
  const status = rule.decision?.status;
  if (status === 'pending' || status === 'unstaged') return 'open';
  if (status === 'approved' || (rule.state === 'shelf' && rule.decision === null)) return 'closed';
  return null;
}

function RuleCard({ rule, review, projectName }: { rule: HealRule; review: RuleReview; projectName: ProjectName }) {
  const { t } = useTranslation();
  const state = stateOf(rule, t);
  const word = rowsWord(rule);
  const ShelfIcon = SHELF_ICONS[rule.shelf] ?? StickyNoteIcon;
  const where = rule.shelf === 'memory'
    ? rule.project
      ? t('heal.rules.shelf.memory', { project: projectName(rule.project), defaultValue: '{{project}} memory' })
      : t('heal.rules.shelf.memoryUnnamed', { defaultValue: 'a project’s memory' })
    : rule.shelf === 'rules'
      ? t('heal.rules.shelf.rules', { defaultValue: 'your rules' })
      : t('heal.rules.shelf.requirements', { defaultValue: 'your requirements' });
  // A queued rule's quote is his sentence, checked verbatim when it was lifted. A shelf rule's is the shelf's own text
  // (an entry's markdown, or a chat's candidate), never his: its title is his newest row's words and the shelf's line
  // stands under the state in the shelf's voice. Only a shelf rule whose rows kept no words leads with that line.
  const heading = rule.state === 'shelf' ? newestWords(rule.rows) : rule.quote;
  const shelfLine = rule.state !== 'shelf' ? null : rule.decision === null
    ? t('heal.rules.shelf.matches', { text: plainShelf(rule.quote), defaultValue: 'matches your shelf: {{text}}' })
    : t('heal.rules.shelf.matchesQueued', { text: plainShelf(rule.quote), defaultValue: 'matches what a chat queued: {{text}}' });
  // The presses exist only where the door has something to act on: a rule waiting under a candidate's id.
  const candidate = rule.decision?.status === 'pending' ? rule.decision.candidate : null;
  // This tab's freshest refusal, else the copy the door recorded on the candidate — the Memory door's own fallback.
  const refusal = candidate === null ? null : review.refusals[candidate] || rule.decision?.refusal || null;
  // What each press is described by for a screen reader ("file it" alone, said eleven times, names nothing): the title,
  // which is what a queued rule files — but on a card matching a chat's candidate the press files the shelf's text.
  const quoteId = useId();
  const shelfId = useId();
  const describedBy = heading !== null && shelfLine !== null ? shelfId : quoteId;

  return (
    <Card className="flex min-w-0 flex-col gap-2.5 px-4 py-3" data-heal-rule={rule.id} data-heal-rule-state={state.key}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h4 id={quoteId} className={cn('break-words text-sm font-medium leading-snug', heading === null && 'line-clamp-2')} title={heading === null ? shelfLine ?? undefined : undefined}>
          {heading === null ? shelfLine : t('heal.rules.quoted', { quote: heading, defaultValue: '“{{quote}}”' })}
        </h4>
        <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={t('heal.rules.shelf.title', { defaultValue: 'Where it lands' })}>
            <ShelfIcon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            {where}
          </span>
          {/* A sentence, not a pill: the door's refusal can run long. The dot is the tone; the words say the state. */}
          <span className="inline-flex min-w-0 items-start gap-1.5" data-tone={state.tone} data-heal-rule-status>
            <span className="mt-1 h-2 w-2 flex-none rounded-full bg-tone-dot" aria-hidden="true" />
            <span className="min-w-0 break-words text-tone-ink">{state.words}</span>
          </span>
        </div>
        {heading !== null && shelfLine !== null && (
          // Two lines until pressed open: a shelf's paragraph runs to a thousand characters, the whole of it one press away.
          // The Memory door's chevron says it opens and turns once it has (`.details-chevron`, index.css), beside the text
          // and never inside it, where the clamp would clip it.
          <details className="group min-w-0 text-xs text-muted-foreground" data-heal-rule-shelf>
            <summary className="flex cursor-pointer list-none items-start gap-1.5 [&::-webkit-details-marker]:hidden">
              <span id={shelfId} className="line-clamp-2 min-w-0 flex-1 break-words group-open:line-clamp-none">{shelfLine}</span>
              <ChevronDownIcon className="details-chevron mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
            </summary>
          </details>
        )}
        {rule.returned_after_filing > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-tone-ink" data-tone="warn" data-heal-rule-returned>
            <RepeatIcon className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            {t('heal.rules.returned', { count: rule.returned_after_filing, defaultValue_one: 'you said it again after filing it', defaultValue_other: 'you said it again after filing it — {{count}} times' })}
          </p>
        )}
      </div>

      {candidate !== null && (
        <div className="flex min-w-0 flex-col gap-1.5" data-heal-rule-presses={candidate}>
          {/* The Memory door's own two presses (MemoryCandidateRow), beside the state they act on and above the rows, so a
              rule said seven times keeps them in view; at the touch floor under a finger. */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" className="finger:h-11" disabled={review.busyId === candidate} aria-describedby={describedBy}
              title={t('memory.actions.fileTitle', { defaultValue: 'file it — write this memory to disk' })} onClick={() => review.onReview(candidate, true)} data-heal-rule-file>
              <CheckIcon aria-hidden="true" />
              {t('memory.actions.file', { defaultValue: 'file it' })}
            </Button>
            <Button size="sm" variant="ghost" className="finger:h-11" disabled={review.busyId === candidate} aria-describedby={describedBy}
              title={t('memory.actions.discardTitle', { defaultValue: 'discard — nothing is written' })} onClick={() => review.onReview(candidate, false)} data-heal-rule-discard>
              <XIcon aria-hidden="true" />
              {t('memory.actions.discard', { defaultValue: 'discard' })}
            </Button>
          </div>
          {refusal !== null && <p className="break-words text-xs text-tone-ink" data-tone="warn" data-heal-rule-refusal>{refusal}</p>}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        {/* Open or closed is a word about the rows, not a call to act: plain text on their label, never a pill. */}
        <p className="text-xs text-muted-foreground" data-heal-rule-said>
          {t('heal.rules.said', { count: rule.rows.length, defaultValue_one: 'Said once', defaultValue_other: 'Said {{count}} times' })}
          {word === 'open' && <span title={t('heal.rules.openTitle', { defaultValue: 'These rows stay open until the rule is filed' })}> · {t('heal.rules.open', { defaultValue: 'open' })}</span>}
          {word === 'closed' && <span title={t('heal.rules.closedTitle', { defaultValue: 'The rule is on your shelf, so these rows are closed' })}> · {t('heal.rules.closed', { defaultValue: 'closed' })}</span>}
        </p>
        <ul className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border">
          {rule.rows.map((row) => <RuleRowLine key={row.id} row={row} projectName={projectName} />)}
        </ul>
      </div>
    </Card>
  );
}

/**
 * One row the rule came from: the day, the project, and the sentence THAT row said it in — on one line where the width
 * allows, the words dropping beneath the day once less than 16rem is left, as on a phone. Day and project stay muted.
 */
function RuleRowLine({ row, projectName }: { row: HealRuleRow; projectName: ProjectName }) {
  const { t } = useTranslation();
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-1.5 text-xs" data-heal-rule-row={row.id} data-heal-rule-row-how={row.how}>
      {/* Shrinks and breaks anywhere: a long project name, or the slug the namer falls back to, never runs off a phone. */}
      <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{row.project ? `${dayOf(row.ts)} · ${projectName(row.project)}` : dayOf(row.ts)}</span>
      {row.how === 'repeat' && (
        <Badge as="span" tone="neutral" title={t('heal.rules.repeatTitle', { defaultValue: 'Said again in the same chat within the hour: the session not acting on the first, so it lifts nothing' })}>
          {t('heal.rules.repeat', { defaultValue: 'same chat' })}
        </Badge>
      )}
      {row.gone && (
        <Badge as="span" tone="neutral" title={t('heal.rules.goneTitle', { defaultValue: 'This row is no longer in the friction ledger; its words are kept here' })}>
          {t('heal.rules.gone', { defaultValue: 'left the ledger' })}
        </Badge>
      )}
      {/* His words reach the DOM as a text node, whatever they quote. */}
      {row.quote
        ? <span className="min-w-0 flex-1 basis-64 break-words leading-snug">{t('heal.rules.quoted', { quote: row.quote, defaultValue: '“{{quote}}”' })}</span>
        : <span className="min-w-0 flex-1 basis-64 text-muted-foreground">{t('heal.rules.noWords', { defaultValue: 'no words kept' })}</span>}
    </li>
  );
}
