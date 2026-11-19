import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanWalk } from '@/modules/kanban/utils/walkModel';
import type { Tone } from '@/shared/types';
import { Badge } from '@/shared/ui';

/**
 * THE SCENARIOS THE WALK LEFT: what now stands guard over this card's change, each with the word
 * its newest run reads.
 *
 * THE WORD IS THE WHOLE POINT, so it leads the row, with its glyph: a reader scanning this list is
 * asking one thing, whether what was fixed is still fixed. Green is a scenario that holds. Red is
 * spent on the two words that mean the fix has come undone — broken and regressed — and on nothing
 * else in this section. A scenario the walk has only written is a draft and is drawn plain: it is
 * expected to fail before the fix, and shouting about that would make every bug card red mid-walk.
 *
 * THE NAME IS READ AS THE SENTENCE IT IS. A scenario is named for its promise, hyphenated; the
 * hyphens are the store's spelling, not the reader's.
 *
 * NO WALK, NO SECTION. A card the dispatcher never walked has no scenarios to list and no empty
 * place for them. A walk that has not written one yet says so in one line.
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

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId} data-drawer-scenarios>
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {t('kanban.scenarios.title')}
      </h3>

      {walk.cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('kanban.scenarios.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {walk.cases.map((scenario) => {
            const word = WORDS[scenario.word];
            const label = word ? t(`kanban.scenarios.words.${word.key}`) : scenario.word;
            return (
              <li key={`${scenario.suite}:${scenario.name}`} className="flex items-start gap-2" data-scenario-word={scenario.word}>
                {word?.tone ? (
                  <Badge tone={word.tone} className="vv-badge--compact mt-0.5 shrink-0">
                    <span aria-hidden="true">{word.glyph}</span>
                    <span className="ml-1">{label}</span>
                  </Badge>
                ) : (
                  <Badge variant="outline" className="vv-badge--compact mt-0.5 shrink-0">{label}</Badge>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-words text-sm leading-snug text-foreground">{sentenceOf(scenario.name)}</span>
                  <span className="text-xs text-ink-faint">{scenario.suite}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
