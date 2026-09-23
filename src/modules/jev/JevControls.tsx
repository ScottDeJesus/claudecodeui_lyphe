import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ago, count } from '@/modules/jev/jevFormat';
import { api, readApiJson } from '@/shared/api';
import { useJevSwitches } from '@/shared/hooks/useJevSwitches';
import type { JevScopeName } from '@/shared/hooks/useJevSwitches';
import type { JevSummary } from '@/shared/types';
import { Badge, Button, ConfirmDialog, Switch } from '@/shared/ui';

type JevScope = JevScopeName;

type JevControlsProps = {
  cache: JevSummary['cache'];
  budget: JevSummary['budget'];
  noSend: JevSummary['no_send'];
  /** The panel's own re-read, run once the cache has been cleared so the old key count does not linger. */
  onCleared: () => void;
};

/** A cache figure, or `—` when the status could not read the file. */
const figure = (value: number | null): string => (value === null ? '—' : count(value));

/**
 * Used by JevPanel as its fifth block: the four things the operator can act on or must know.
 *
 * (1) The three switches, written through the house hook — the flag files are the truth and a row
 * draws what was read back, never what was pressed. (2) The replay cache, as the on-disk facts only:
 * whether a process replays from it is that PROCESS's `JEV_CACHE=1`, so no "armed" badge is drawn
 * here — it would be a fact about the reader drawn as a fact about Jev. (3) The per-session ask
 * counters, with no ceiling figure for the same reason: the ceiling is the asking process's own
 * `JEV_BUDGET_CALLS`. (4) The no-send list, read-only.
 */
export function JevControls({ cache, budget, noSend, onCleared }: JevControlsProps) {
  const { t } = useTranslation();
  // The SAME store Settings draws from, so a flip made up there is on this row the moment the server
  // confirms it, and a flip made here reaches Settings the same way.
  const switches = useJevSwitches();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The dialog closes first — that is the press's own acknowledgement — and the write follows it. The
  // panel is re-read whatever the write answered: a clear that failed must not leave the row showing
  // the key count the operator just tried to remove.
  const onClearCache = () => {
    setConfirmOpen(false);
    void (async () => {
      try {
        await readApiJson(await api.jev.clearCache());
      } catch (error) {
        console.error('Error clearing the Jev replay cache:', error);
      }
      onCleared();
    })();
  };

  const position = switches.state;
  // The refusals are Settings' own (JevContent.tsx:176-187, :214-219). A row is dead only when there
  // is no position to set, or while ANOTHER row's write is crossing — that write would swallow a
  // press here and the row would read as broken. NOT for its own write: `Switch` renders a real
  // `disabled` attribute, Chromium blurs the element the instant one lands, and the second Space a
  // keyboard user presses would go to the document. The store drops that second write itself.
  //
  // A scope is gated in ONE direction: it refuses to be turned on while the master is off, so the
  // narrowing act never requires widening the blast radius first, and it can always be turned off.
  const gated = position !== null && !position.master;
  const rows: { key: 'master' | JevScope; label: string; hint: string; on: boolean; live: boolean; set: (next: boolean) => Promise<void>; disabled: boolean }[] = [
    { key: 'master', label: t('jev.controls.switches.master', { defaultValue: 'Jev' }), hint: t('jev.controls.switches.masterHint', { defaultValue: 'the master — off, nothing is sent anywhere' }), on: position?.master ?? false, live: position?.master ?? false, set: switches.setMaster, disabled: position === null || (switches.saving !== null && switches.saving !== 'master') },
    { key: 'prompts', label: t('jev.controls.switches.prompts', { defaultValue: 'Prompts' }), hint: t('jev.controls.switches.promptsHint', { defaultValue: 'let a hook ask about what a session was told' }), on: position?.prompts ?? false, live: position?.promptsLive ?? false, set: (next) => switches.setScope('prompts', next), disabled: position === null || (switches.saving !== null && switches.saving !== 'prompts') || (gated && position?.prompts !== true) },
    { key: 'toolOutput', label: t('jev.controls.switches.toolOutput', { defaultValue: 'Tool output' }), hint: t('jev.controls.switches.toolOutputHint', { defaultValue: 'let a hook ask about what a command printed' }), on: position?.toolOutput ?? false, live: position?.toolOutputLive ?? false, set: (next) => switches.setScope('toolOutput', next), disabled: position === null || (switches.saving !== null && switches.saving !== 'toolOutput') || (gated && position?.toolOutput !== true) },
  ];
  const cacheFigures = [
    { key: 'keys', label: t('jev.controls.cache.keys', { defaultValue: 'keys' }), value: figure(cache.keys) },
    { key: 'draws', label: t('jev.controls.cache.draws', { defaultValue: 'draws' }), value: figure(cache.draws) },
    { key: 'bytes', label: t('jev.controls.cache.bytes', { defaultValue: 'bytes' }), value: figure(cache.bytes) },
    { key: 'file', label: t('jev.controls.cache.fileBytes', { defaultValue: 'file size' }), value: figure(cache.file_bytes) },
  ];

  return (
    <div className="grid gap-6 [@container(min-width:48rem)]:grid-cols-2" data-jev-controls>
      <Block
        title={t('jev.controls.switches.title', { defaultValue: 'Switches' })}
        // The press a control with no readable position can honour: ask again (JevContent.tsx:169-174).
        // Without it the only route out was the header's summary refresh, which reaches the switches
        // only incidentally — an operator whose files were briefly unreadable had to guess that.
        aside={switches.unreadable ? (
          <Button variant="outline" size="sm" onClick={() => void switches.refresh()} data-jev-switches-retry>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        ) : undefined}
      >
        {switches.unreadable && <p className="text-xs text-muted-foreground">{t('jev.controls.switches.unreadable', { defaultValue: 'The switch files could not be read — the positions below are not known' })}</p>}
        <ul className="flex flex-col divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3 py-2" data-jev-switch={row.key}>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{row.label}</div>
                <div className="text-xs text-muted-foreground">
                  {row.hint}
                  {row.on && !row.live && <> · {t('jev.controls.switches.offWhileMasterOff', { defaultValue: 'off while the master is off' })}</>}
                </div>
              </div>
              <Switch checked={row.on} onChange={(next) => void row.set(next)} label={row.label} disabled={row.disabled} />
            </li>
          ))}
        </ul>
      </Block>

      <Block
        title={t('jev.controls.cache.title', { defaultValue: 'Replay cache' })}
        aside={<Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} disabled={cache.keys === null || cache.keys === 0} data-jev-cache-clear>{t('jev.controls.cache.clear', { defaultValue: 'Clear' })}</Button>}
      >
        <dl className="grid grid-cols-4 gap-2">
          {cacheFigures.map((item) => (
            <div key={item.key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="font-mono text-sm tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
        <p className="font-mono text-xs text-muted-foreground">{cache.path}</p>
        {cache.error !== null && <p className="text-xs text-muted-foreground">{t('jev.controls.cache.error', { defaultValue: 'could not be read: {{error}}', error: cache.error })}</p>}
        <p className="text-xs text-muted-foreground">{t('jev.controls.cache.caption', { defaultValue: 'armed only in processes started with JEV_CACHE=1' })}</p>
        <ConfirmDialog
          open={confirmOpen}
          title={t('jev.controls.cache.confirmTitle', { defaultValue: 'Clear the replay cache?' })}
          message={t('jev.controls.cache.confirmMessage', { defaultValue: 'Every cached answer goes. The next ask of each key is sent again and paid for.' })}
          actions={[
            { label: t('jev.controls.cache.keep', { defaultValue: 'Keep it' }), variant: 'outline', onSelect: () => setConfirmOpen(false) },
            { label: t('jev.controls.cache.confirm', { defaultValue: 'Clear it' }), variant: 'destructive', onSelect: onClearCache },
          ]}
          onDismiss={() => setConfirmOpen(false)}
        />
      </Block>

      <Block title={t('jev.controls.budget.title', { defaultValue: 'Ask counters' })}>
        {budget.counters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('jev.controls.budget.empty', { defaultValue: 'No counter on disk — no process has asked under a budget' })}</p>
        ) : (
          <table className="w-full text-sm" data-jev-budget>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="py-1 pr-3 text-left font-medium">{t('jev.controls.budget.key', { defaultValue: 'key' })}</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">{t('jev.controls.budget.used', { defaultValue: 'used' })}</th>
                <th scope="col" className="py-1 text-right font-medium">{t('jev.controls.budget.last', { defaultValue: 'last used' })}</th>
              </tr>
            </thead>
            <tbody>
              {budget.counters.map((counter) => (
                <tr key={counter.key} className="border-b border-border/60">
                  <td className="max-w-[16rem] truncate py-1 pr-3 font-mono text-xs" title={counter.key}>{counter.key}</td>
                  <td className="whitespace-nowrap py-1 pr-3 text-right font-mono text-xs tabular-nums">{count(counter.used)}</td>
                  <td className="whitespace-nowrap py-1 text-right font-mono text-xs tabular-nums text-muted-foreground">{t('jev.controls.budget.ago', { defaultValue: '{{ago}} ago', ago: ago(counter.mtime) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground">{t('jev.controls.budget.caption', { defaultValue: 'the ceiling is JEV_BUDGET_CALLS in the asking process' })}</p>
      </Block>

      <Block
        title={t('jev.controls.noSend.title', { defaultValue: 'Never sent' })}
        aside={
          <Badge as="span" tone={noSend.source === 'file' ? 'neutral' : 'warn'} className="text-xs">
            {noSend.source === 'missing' && <><span aria-hidden="true">▲</span>&nbsp;</>}
            {t(`jev.controls.noSend.${noSend.source}`, { defaultValue: noSend.source })}
          </Badge>
        }
      >
        {noSend.paths.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('jev.controls.noSend.empty', { defaultValue: 'No path on file — the built-in list stands' })}</p>
        ) : (
          <ul className="flex flex-col gap-1" data-jev-no-send>
            {noSend.paths.map((path, i) => <li key={i} className="font-mono text-xs">{path}</li>)}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t('jev.controls.noSend.caption', { defaultValue: 'path prefixes whose output never leaves this machine, whatever the switches say' })}</p>
      </Block>
    </div>
  );
}

/** One of the four blocks: a small heading, an optional control beside it, the rows under it. */
function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        {aside}
      </div>
      {children}
    </div>
  );
}
