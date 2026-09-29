import { BotIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentLaunchDefaults } from '@/modules/agent-launch/AgentLaunchDefaults';
import { AgentLaunchNotices } from '@/modules/agent-launch/AgentLaunchNotices';
import { AgentLaunchRowItem } from '@/modules/agent-launch/AgentLaunchRowItem';
import { useAgentLaunch } from '@/modules/agent-launch/hooks/useAgentLaunch';
import type { AgentLaunchDefaultsChange, AgentLaunchRowChange } from '@/shared/agent-launch-types';
import { Badge, Banner, Button, Card, ScrollArea, Spinner } from '@/shared/ui';

/** What `saving` holds while the Defaults block, and not a row, is being written. */
const DEFAULTS_SAVING = '@defaults';

/** What `last` holds after the reader pressed reload: an error that follows it is a read that failed, not a save that was refused. */
const RELOADED = '@reload';

type AgentLaunchPanelProps = {
  /** Given by the window the panel sits in: the header then draws a close button that calls it. */
  onClose?: () => void;
  /** The id the title carries, so the window around the panel can be named by it. */
  titleId?: string;
};

/**
 * Agent Chains — Settings → Agents → Edit Agent Chains: the model and effort every soul, and Metis, launches
 * at — one table, edited where it is read.
 *
 * Rendered by the settings module's AgentChainsContent, as the whole body of the window its "Edit Agent
 * Chains" button opens. It takes no size of its own: the window gives it a definite height and it fills it.
 *
 * ORDERED THE WAY A READER ACTS. The header is the house panel header: the mark, the title, where the
 * table lives, one button to read it again and — when the window hands `onClose` — the button that
 * closes the window, the only way out on a full-screen phone. Under it, only when a call failed, the server's own
 * sentence under a line that says the change was not saved and, when the panel knows, whose it was —
 * outside the scroll, so it is still in view when the reader pressed the fifteenth row, and the row
 * itself wears the same mark.
 * Then the body: what is wrong with the table (if anything), the one notice that qualifies every
 * change, the DEFAULTS (the spine every unpinned soul falls back to), and the rows — the souls, then
 * Metis. A pinned row is the exception, so a pin is what stands out down the list.
 *
 * A WIDE PANEL IS A TABLE AND A NARROW ONE IS A STACK. The query is the panel's own width
 * (`container-type` on the root), as the Heal tab's is: a row is three columns — who, what it
 * launches at, where that lands — once the panel is 64rem wide, two columns from 48rem and one
 * below that.
 *
 * FOUR NON-READY STATES, EACH ITS OWN FACT. Not asked yet is a spinner; a table that could not be read is
 * a warning carrying the reason and the way back; a save in flight HOLDS the row it writes (or the
 * Defaults block) and leaves every other control live; a save the table refused shows the sentence
 * the table gave, and the census the panel already held, unchanged.
 *
 * THE PANEL REMEMBERS WHAT THE READER LAST PRESSED, because the hook's `error` is a bare sentence that
 * names no row. That is UI state and no data: it only decides whose row wears the "not saved" mark.
 */
export function AgentLaunchPanel({ onClose, titleId }: AgentLaunchPanelProps) {
  const { t } = useTranslation();
  // The hook owns the read and every write; this panel draws what it last held and calls what it hands back.
  const { census, error, saving, refresh, saveRow, saveDefaults } = useAgentLaunch();
  // What the reader last handed to the hook — a row's name, DEFAULTS_SAVING or RELOADED — so an error that
  // arrives can say whose change it refused. Null until something is pressed, and then the banner's lead
  // line stands alone.
  const [last, setLast] = useState<string | null>(null);
  const onSaveRow = (name: string, change: AgentLaunchRowChange) => {
    setLast(name);
    return saveRow(name, change);
  };
  const onSaveDefaults = (change: AgentLaunchDefaultsChange) => {
    setLast(DEFAULTS_SAVING);
    return saveDefaults(change);
  };
  const onReload = () => {
    setLast(RELOADED);
    refresh();
  };
  const errorLead =
    last === RELOADED
      ? t('agentLaunch.refused.notRead')
      : last === DEFAULTS_SAVING
        ? t('agentLaunch.refused.notSavedDefaults')
        : last
          ? t('agentLaunch.refused.notSavedRow', { name: last })
          : t('agentLaunch.refused.notSaved');
  const reloadLabel = t('agentLaunch.reload');
  const souls = census?.rows.filter((row) => row.kind === 'soul') ?? [];
  const metis = census?.rows.filter((row) => row.kind === 'metis') ?? [];
  const pinnedSouls = souls.filter((row) => row.model_pinned || row.effort_pinned).length;

  return (
    <div className="flex h-full flex-col [container-type:inline-size]" data-agent-launch-panel data-agent-state={census ? 'ready' : error ? 'unreadable' : 'loading'}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <BotIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 id={titleId} className="text-sm font-medium">{t('agentLaunch.title')}</h2>
        {census && (
          <span className="ml-1 hidden min-w-0 truncate font-mono text-xs text-muted-foreground [@container(min-width:48rem)]:block">{census.file}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* The browser's own `title`, not the kit's Tooltip: that one portals at z 9999, and the window this
              panel lives in sits at 10000 to clear Settings, so its bubble was drawn behind the window. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label={reloadLabel}
            title={reloadLabel}
            disabled={!census}
            onClick={onReload}
            data-agent-reload
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
          {onClose && (
            // `autoFocus` because the window's own first-focus pass runs when it opens — before this
            // lazy panel has loaded on the first open, when there is nothing in the window to take
            // focus and it would stay on the button behind. This is the one control that is always live.
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('buttons.close')}
              onClick={onClose}
              autoFocus
              data-agent-close
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      {census === null && error === null && (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <Spinner label={t('agentLaunch.reading')} />
        </div>
      )}

      {census === null && error !== null && (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div role="alert" className="w-full max-w-lg" data-agent-unreadable>
            <Banner
              tone="warn"
              action={
                <Button variant="outline" size="sm" className="flex-none" onClick={onReload}>
                  {t('agentLaunch.unreadable.retry')}
                </Button>
              }
            >
              <p className="font-medium">{t('agentLaunch.unreadable.title')}</p>
              <p className="break-words">{error}</p>
            </Banner>
          </div>
        </div>
      )}

      {census !== null && (
        <>
          {error !== null && (
            <div role="alert" className="shrink-0 border-b border-border px-4 py-2" data-agent-refused>
              <Banner tone="warn">
                <p className="font-medium">{errorLead}</p>
                <p className="break-words">{error}</p>
              </Banner>
            </div>
          )}
          <ScrollArea className="min-h-0 flex-1">
            {/* The runway under the last section is for the last row's open list: it drops six options below its trigger.
                Below 30rem a list is anchored to its trigger's RIGHT edge and the trigger's width: the kit floors a list
                at 14rem and grows it rightwards from the trigger's left, and a trigger that sits right of the caption
                on a phone has less than 14rem left of it, so the list ran out past the window (measured at 320 and at
                360 × 1.072). Grown leftwards it stays inside; wider windows keep the kit's own placement. The class
                name's underscores are escaped because Tailwind reads a bare `_` in an arbitrary variant as a space. */}
            <div className="flex w-full min-w-0 flex-col gap-6 px-4 pb-64 pt-5 [@container(max-width:30rem)]:[&_.vv-select\_\_panel]:left-auto [@container(max-width:30rem)]:[&_.vv-select\_\_panel]:w-full [@container(min-width:48rem)]:px-6">
              <AgentLaunchNotices census={census} />
              <AgentLaunchDefaults census={census} held={saving === DEFAULTS_SAVING} refused={error !== null && last === DEFAULTS_SAVING} onSave={onSaveDefaults} />

              <AgentLaunchSection id="agent-souls" title={t('agentLaunch.souls.title')} count={souls.length} hint={pinnedSouls > 0 ? t('agentLaunch.souls.pinned', { count: pinnedSouls }) : undefined}>
                {souls.map((row) => (
                  <AgentLaunchRowItem key={row.name} row={row} census={census} held={saving === row.name} refused={error !== null && last === row.name} onSave={onSaveRow} />
                ))}
              </AgentLaunchSection>

              {metis.length > 0 && (
                <AgentLaunchSection id="agent-metis" title={t('agentLaunch.metis.title')}>
                  {metis.map((row) => (
                    <AgentLaunchRowItem key={row.name} row={row} census={census} held={saving === row.name} refused={error !== null && last === row.name} onSave={onSaveRow} />
                  ))}
                </AgentLaunchSection>
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}

/** A titled block of rows, in one card and divided by hairlines, the count and any hint beside its title. */
function AgentLaunchSection({ id, title, count, hint, children }: { id: string; title: string; count?: number; hint?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3" data-agent-section={id}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 id={`${id}-title`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {count !== undefined && count > 0 && <Badge as="span" tone="neutral">{count}</Badge>}
        {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
      </div>
      <Card>
        <ul className="divide-y divide-border">{children}</ul>
      </Card>
    </section>
  );
}
