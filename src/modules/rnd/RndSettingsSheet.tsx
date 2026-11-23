import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentLaunchChoice } from '@/modules/agent-launch';
import { hostOf } from '@/modules/rnd/rndWords';
import type { RndScoutsRun, RndSettings, RndSource } from '@/shared/rnd-types';
import { Banner, Button, EmptyState, Field, Input, Rule, SegmentedControl, Sheet, Spinner, Switch } from '@/shared/ui';

/** The two launches the place owns: the weekly scout, and the chat that spikes one candidate. */
export type RndLaunchKind = 'scout' | 'spike';

/** One slot of a launch row, as AgentLaunchChoice reads it: the table's words, the one in force, whether the row pins it, and what clearing the pin falls back to. */
export type RndLaunchSlot = { choices: string[]; current: string | null; pinned: boolean; defaultWord: string | null };

/** The launch table's rows rnd.scout and rnd.spike, each as its two slots. The table is their one home: the sheet shows them and holds no copy. */
export type RndLaunch = Record<RndLaunchKind, { model: RndLaunchSlot; effort: RndLaunchSlot }>;

type RndSettingsSheetProps = {
  open: boolean;
  onClose: () => void;
  settings: RndSettings;
  /** The two rows, or null until the launch table has been read. */
  launch: RndLaunch | null;
  /** The sentence a failed read of the launch table answered with, or null. */
  launchFailure: string | null;
  /** A change made here is out: the sheet's presses wait. */
  busy: boolean;
  /** The dispatcher's sentence for a change made here that it refused, or null. */
  refusal: string | null;
  onDismissRefusal: () => void;
  /** The label is given by Undo alone, which puts a removed source back as it was. */
  onAddSource: (url: string, label?: string | null) => void;
  onRemoveSource: (url: string) => void;
  onWebSearch: (next: boolean) => void;
  /** One at a time (the default) or all at once: how a run's source scouts go out. */
  onScoutsRun: (next: RndScoutsRun) => void;
  /** A word pins the slot; null clears the pin. */
  onLaunch: (kind: RndLaunchKind, slot: 'model' | 'effort', next: string | null) => void;
};

/** The field a source is added from. Keyed by how many sources there are, so it starts empty again once one lands. */
function AddSource({ busy, onAdd }: { busy: boolean; onAdd: (url: string) => void }) {
  const { t } = useTranslation();
  const urlId = useId();
  const [url, setUrl] = useState('');
  const trimmed = url.trim();
  return (
    <form
      data-rnd-add-source=""
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== '' && !busy) onAdd(trimmed);
      }}
    >
      <Field label={t('rnd.settings.addLabel')} htmlFor={urlId} helper={t('rnd.settings.addHelper')}>
        <div className="flex items-center gap-2">
          <Input
            id={urlId}
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            value={url}
            disabled={busy}
            placeholder={t('rnd.settings.addPlaceholder')}
            aria-describedby={urlId + '-helper'}
            className="finger:h-11"
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" className="flex-none finger:h-11" busy={busy} disabled={trimmed === ''} data-rnd-act="add-source">
            {t('rnd.settings.add')}
          </Button>
        </div>
      </Field>
    </form>
  );
}

/**
 * THE R&D SETTINGS, a sheet called up from the place's gear. Three things, in the order he changes them: what the scout reads,
 * what the scout and a spike launch at, and whether they may search the web. Every change is saved as it is made; nothing here
 * waits for a Save.
 *
 * SOURCES are the pages the scout reads: each its label over its address, with Remove beside it, then the one field that adds
 * another. Removing a source keeps the candidates it gave. Remove asks nothing: the line that follows it offers Undo, which puts
 * the source back with its label.
 *
 * SCOUT AND SPIKE each hold the two slots of their launch row, Model and Effort, drawn by the launch table's own control, so a
 * pin reads here as it does on Agent Chains. Until the table has been read they are one loop; a read that failed says so in its
 * sentence.
 *
 * WEB SEARCH says what its position means now, in words beside the switch, never as a bare on or off.
 *
 * A REFUSAL stays at the sheet's top while the body scrolls, and closes once read.
 *
 * FOCUS HAS A HOME AFTER REMOVE AND UNDO, because each press takes its own button off the page: Undo takes the focus when its
 * line appears, the restored row's Remove takes it after Undo, and the Add field when the line is closed instead. A keyboard is
 * never dropped on the page, and a reader lands on the line that says what happened.
 *
 * Rendered by RndPanel.
 */
export function RndSettingsSheet({ open, onClose, settings, launch, launchFailure, busy, refusal, onDismissRefusal, onAddSource, onRemoveSource, onWebSearch, onScoutsRun, onLaunch }: RndSettingsSheetProps) {
  const { t } = useTranslation();
  const sourcesId = useId();
  const launchId = useId();
  const webId = useId();
  const scoutsRunId = useId();
  const kinds: readonly RndLaunchKind[] = ['scout', 'spike'];
  // The source Remove was last pressed on, until it is put back or the line is closed: what Undo restores, label and all.
  const [removed, setRemoved] = useState<RndSource | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  // The source Undo is putting back: its row's Remove takes the focus once the picture holds it again.
  const restoring = useRef<string | null>(null);
  const undoShown = removed !== null && !settings.sources.some((source) => source.url === removed.url);
  useEffect(() => {
    if (undoShown) undoRef.current?.focus();
  }, [undoShown]);
  useEffect(() => {
    const url = restoring.current;
    if (url === null || !settings.sources.some((source) => source.url === url)) return;
    restoring.current = null;
    const rows = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-rnd-source]') ?? []);
    rows.find((node) => node.dataset.rndSource === url)?.querySelector('button')?.focus();
  }, [settings.sources]);

  return (
    <Sheet open={open} onClose={onClose} title={t('rnd.settings.title')} titleAccent={t('rnd.settings.accent')}>
      <div ref={rootRef} className="flex flex-col gap-8" data-rnd-settings-sheet="">
        {/* Held at the sheet's top while its body scrolls, so a press refused far down the sheet is answered where he is looking.
            It holds from the body's own top edge (the body's 18 px of padding, taken back and painted in the sheet's surface), so
            no row shows in a strip above it. */}
        {refusal !== null && (
          <div className="sticky -top-[18px] z-10 -mt-[18px] bg-[var(--surface)] pt-[18px]">
            <Banner tone="warn" onClose={onDismissRefusal}>{refusal}</Banner>
          </div>
        )}

        <section aria-labelledby={sourcesId} className="flex flex-col gap-3">
          <Rule id={sourcesId} end={settings.sources.length}>{t('rnd.settings.sources')}</Rule>
          {settings.sources.length === 0 ? (
            <EmptyState size="sm" title={t('rnd.settings.noSources')} />
          ) : (
            <ul className="flex flex-col">
              {settings.sources.map((source) => (
                <li key={source.url} className="flex items-center gap-3 border-b border-border py-2 last:border-b-0" data-rnd-source={source.url}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{source.label ?? hostOf(source.url)}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{source.url}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-none finger:h-11"
                    disabled={busy}
                    aria-label={t('rnd.settings.removeLabel', { source: source.label ?? hostOf(source.url) })}
                    onClick={() => {
                      setRemoved(source);
                      onRemoveSource(source.url);
                    }}
                  >
                    {t('rnd.settings.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {removed !== null && undoShown && (
            <Banner
              tone="info"
              action={(
                <Button
                  variant="outline"
                  size="sm"
                  className="finger:h-11"
                  ref={undoRef}
                  disabled={busy}
                  onClick={() => {
                    restoring.current = removed.url;
                    onAddSource(removed.url, removed.label);
                    setRemoved(null);
                  }}
                >
                  {t('rnd.settings.undo')}
                </Button>
              )}
              onClose={() => {
                setRemoved(null);
                rootRef.current?.querySelector<HTMLElement>('[data-rnd-add-source] input')?.focus();
              }}
            >
              {t('rnd.settings.removed', { source: removed.label ?? hostOf(removed.url) })}
            </Banner>
          )}
          <AddSource key={settings.sources.length} busy={busy} onAdd={onAddSource} />
        </section>

        {launch === null ? (
          <section aria-labelledby={launchId} className="flex flex-col gap-3">
            <Rule id={launchId}>{t('rnd.settings.launch')}</Rule>
            {launchFailure === null ? <Spinner size={20} label={t('rnd.settings.launchLoading')} /> : <Banner tone="warn">{launchFailure}</Banner>}
          </section>
        ) : kinds.map((kind) => (
          <section key={kind} aria-labelledby={launchId + kind} className="flex flex-col gap-3" data-rnd-launch={kind}>
            <Rule id={launchId + kind}>{t('rnd.settings.' + kind)}</Rule>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('rnd.settings.' + kind + 'About')}</p>
            <div className="grid grid-cols-1 gap-2">
              <AgentLaunchChoice
                label={t('agentLaunch.row.model')}
                ariaLabel={t('rnd.settings.modelLabel', { who: t('rnd.settings.' + kind) })}
                choices={launch[kind].model.choices}
                current={launch[kind].model.current}
                pinned={launch[kind].model.pinned}
                defaultWord={launch[kind].model.defaultWord}
                onChange={(next) => onLaunch(kind, 'model', next)}
              />
              <AgentLaunchChoice
                label={t('agentLaunch.row.effort')}
                ariaLabel={t('rnd.settings.effortLabel', { who: t('rnd.settings.' + kind) })}
                choices={launch[kind].effort.choices}
                current={launch[kind].effort.current}
                pinned={launch[kind].effort.pinned}
                defaultWord={launch[kind].effort.defaultWord}
                onChange={(next) => onLaunch(kind, 'effort', next)}
              />
            </div>
          </section>
        ))}

        <section aria-labelledby={scoutsRunId} className="flex flex-col gap-3" data-rnd-scouts-run={settings.scouts_run}>
          <Rule id={scoutsRunId}>{t('rnd.settings.scoutsRun')}</Rule>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('rnd.settings.scoutsRunAbout')}</p>
          <SegmentedControl<RndScoutsRun>
            label={t('rnd.settings.scoutsRun')}
            options={[
              { value: 'one_at_a_time', label: t('rnd.settings.scoutsRunOne') },
              { value: 'all_at_once', label: t('rnd.settings.scoutsRunAll') },
            ]}
            value={settings.scouts_run}
            onChange={(next) => {
              if (!busy && next !== settings.scouts_run) onScoutsRun(next);
            }}
          />
        </section>

        <section aria-labelledby={webId} className="flex flex-col gap-3">
          <Rule id={webId}>{t('rnd.settings.web')}</Rule>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm leading-relaxed text-muted-foreground">{settings.web_search ? t('rnd.settings.webOn') : t('rnd.settings.webOff')}</p>
            <Switch checked={settings.web_search} onChange={onWebSearch} label={t('rnd.settings.web')} disabled={busy} />
          </div>
        </section>
      </div>
    </Sheet>
  );
}
