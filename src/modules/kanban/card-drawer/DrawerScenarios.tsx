import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanWalk } from '@/modules/kanban/utils/walkModel';
import type { Tone } from '@/shared/types';
import { Rule } from '@/shared/ui';

/**
 * THE SCENARIOS THE WALK LEFT: what now stands guard over this card's change, each with the word
 * its newest run reads.
 *
 * THE WORD IS THE WHOLE POINT, so its glyph leads the row and the word ends it: a reader scanning this list is
 * asking one thing, whether what was fixed is still fixed. Green is a scenario that holds. Red is
 * spent on the two words that mean the fix has come undone — broken and regressed — and on nothing
 * else in this section. A scenario the walk has only written is a draft and is drawn plain: it is
 * expected to fail before the fix, and shouting about that would make every bug card red mid-walk.
 *
 * THE NAME IS READ AS THE SENTENCE IT IS. A scenario is named for its promise, hyphenated; the
 * hyphens are the store's spelling, not the reader's.
 *
 * NO SCENARIOS, NO SECTION. A card the dispatcher never walked, or whose walk has not written one
 * yet, has no empty place for them.
 */

type DrawerScenariosProps = {
  /** The open card's walk, from the board's one reader. */
  walk: KanbanWalk;
};

/** Each word a scenario can read, with the voice it speaks in. A word not listed is drawn as
 *  written, plain. */
const WORDS: Record<string, { key: string; glyph: string; tone: Tone | null }> = {
  holding: { key: 'holding', glyph: '✓', tone: 'positive' },
  broken: { key: 'broken', glyph: '✕', tone: 'danger' },
  regressed: { key: 'regressed', glyph: '✕', tone: 'danger' },
  "can't run": { key: 'cantRun', glyph: '▲', tone: 'warn' },
  'not run': { key: 'notRun', glyph: '·', tone: null },
  draft: { key: 'draft', glyph: '·', tone: null },
  retired: { key: 'retired', glyph: '·', tone: null },
};

/** A scenario's name as the sentence it states. */
function sentenceOf(name: string): string {
  const words = name.replace(/-/g, ' ').trim();
  return words.length === 0 ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

/** Rendered by KanbanCardDrawer while autonomy is on and the card has a walk. */
export function DrawerScenarios({ walk }: DrawerScenariosProps) {
  const { t } = useTranslation();
  const headingId = useId();

  if (walk.cases.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId} data-drawer-scenarios>
      <Rule id={headingId}>{t('kanban.scenarios.title')}</Rule>
      <ul className="flex flex-col gap-2">
        {walk.cases.map((scenario) => {
          const word = WORDS[scenario.word];
          const label = word ? t(`kanban.scenarios.words.${word.key}`) : scenario.word;
          return (
            <li key={`${scenario.suite}:${scenario.name}`} className="flex items-start gap-2" data-scenario-word={scenario.word}>
              <span className="bug-glyph" data-tone={word?.tone ?? undefined} aria-hidden="true">
                {word?.glyph ?? '·'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="break-words text-[13px] leading-[18px] text-foreground">{sentenceOf(scenario.name)}</span>
                <span className="bug-figure">
                  {/* The word in the tone it speaks in, then the suite it runs in. */}
                  <span className={word?.tone === 'positive' ? 'text-[var(--pos-ink)]' : word?.tone === 'danger' ? 'text-[var(--danger-ink)]' : word?.tone === 'warn' ? 'text-[var(--warn-ink)]' : undefined}>{label}</span>
                  {' · '}
                  {scenario.suite}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
