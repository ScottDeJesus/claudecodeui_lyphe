import type { TFunction } from 'i18next';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useUpdateBatch } from '@/modules/cerberus/hooks/useUpdateBatch';
import { DialogFrame } from '@/modules/cerberus/modals/DialogFrame';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import { canTake, freshestBatch } from '@/modules/cerberus/utils/wardenUpdates';
import type { CerberusUpdateView, CerberusWardens } from '@/shared/cerberus-types';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { CerberusStartedBatch, Tone } from '@/shared/types';
import { Button, Checkbox } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** One enrolled node as `GET /wardens` lists it: its warden's version (null before its first hello) and whether that is behind. */
type WardenNode = CerberusWardens['nodes'][number];

/** What a row says on its right: its words, the tone they are written in (null: the muted ink) and the mark before them. */
type RowState = { words: string; tone: Tone | null; glyph: '●' | '✓' | '✕' | '▲' | null };

/** Where the dialog stands: nodes being ticked, a batch going, or a batch whose every update has ended. */
type Phase = 'choosing' | 'running' | 'ended';

/** A release note as a clause of the note's first sentence: its own full stop dropped, since the sentence brings one. */
const asClause = (note: string): string => note.trim().replace(/\.+$/, '');

/** "0.4.2", "0.4.1 and 0.4.2", "0.4.0, 0.4.1 and 0.4.2": the versions an update keeps for rollback, oldest first. */
function versionList(t: TFunction, versions: string[]): string {
  if (versions.length < 2) return versions.join('');
  return t('cerberus.updates.versions', { rest: versions.slice(0, -1).join(', '), last: versions[versions.length - 1] });
}

/**
 * What a row says on its right. A node in the batch says how its update stands: "Waiting its turn" until its
 * warden's first word, then that word in the info ink behind the ● every running thing on the tab wears
 * ("● Restarting the warden"), and once it ended "✓ Updated",
 * "✕ Rolled back to 0.4.2", or "▲" before the sentence it failed with, both in the warn ink. A node outside the
 * batch: "Already on 0.4.3" when it is not behind, "Waiting for the first heartbeat" before its first hello,
 * otherwise nothing.
 */
function rowState(t: TFunction, node: WardenNode, update: CerberusUpdateView | undefined): RowState | null {
  if (update !== undefined) {
    const last = update.steps[update.steps.length - 1];
    if (update.result === 'updated') return { words: t('cerberus.updates.updated'), tone: 'positive', glyph: '✓' };
    if (update.result === 'rolled_back') {
      return { words: t('cerberus.updates.rolledBack', { from: update.from ?? '—' }), tone: 'warn', glyph: '✕' };
    }
    // Center files the sentence an update failed with as its last step, so a failed update always has one.
    if (update.result === 'failed') return { words: last?.text ?? '', tone: 'warn', glyph: '▲' };
    if (last === undefined) return { words: t('cerberus.updates.queued'), tone: null, glyph: null };
    return { words: last.text, tone: 'info', glyph: '●' };
  }
  if (node.version === null) return { words: t('cerberus.node.waiting'), tone: null, glyph: null };
  if (!node.behind) return { words: t('cerberus.updates.current', { version: node.version }), tone: null, glyph: null };
  return null;
}

type UpdateWardensDialogProps = {
  /** Whether the dialog is up. Closed, nothing of it is mounted, so it opens clean every time. */
  open: boolean;
  /** Cancel, Close, Done, the ✕, Escape and the backdrop. Closing never stops a batch. */
  onClose: () => void;
};

/**
 * UPDATE WARDENS: the release center holds, taken to the nodes one at a time (`design/cerberus/Cerberus
 * Tab.dc.html` :644-690; spec §4, "Update").
 *
 * Top to bottom: the note, "Warden 0.4.3 · Fixes heartbeat drift after the machine sleeps. One node at a time;
 * its checks pause for about 3 s while the warden restarts. 0.4.2 is kept for rollback.", its last sentence
 * naming the versions the nodes it takes are on (the ticked ones while choosing, the batch's own once it
 * runs; "0.4.1 and 0.4.2 are kept" when they differ, nothing when no node is ticked); then a row per enrolled
 * node; then the footer.
 *
 * A ROW, while choosing: a node that can take the update is a `Checkbox`, "eis1 · warden 0.4.2", the whole row
 * its press target; any other node is the same words plain, with "Already on 0.4.3" or "Waiting for the first
 * heartbeat" on its right. Once a batch runs every row is plain, and a node in the batch says how its update
 * stands (`rowState`). Under it, its steps in mono with their times, the failed one in the warn ink: a log, so
 * each step is heard as it lands.
 *
 * THE FOOTER says where the batch stands: Cancel and "Update 2 nodes" (waiting while none is ticked) when
 * choosing; "Closing this doesn't stop it." and Close while it runs; once every update ended, "✓ Every selected
 * warden is on 0.4.3." and Done — or "▲ 1 selected warden isn't on 0.4.3." and Done when one did not take it,
 * so an ending is never said greener than it was. Its words are the dialog's one status region. It is pinned to
 * the panel's foot under a hairline, so a list taller than the screen opens at its top with the footer in view.
 *
 * Nothing is optimistic: Update N nodes waits for center's answer, every way out with it, and a row only moves
 * when the batch's read says so. With no release built (`latest` null) there is nothing to offer, and it draws
 * nothing.
 *
 * For the cerberus module's `CerberusPanel`, which hosts one and opens it from the header's Update wardens
 * button.
 */
export function UpdateWardensDialog({ open, onClose }: UpdateWardensDialogProps) {
  if (!open) return null;
  return <UpdateWardensFlow onClose={onClose} />;
}

/** The dialog itself, mounted for as long as it is open. */
function UpdateWardensFlow({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  useReturnFocus();

  // The release on offer and where each node stands against it, as the provider keeps them: read beside the
  // overview and again on every `cerberus_changed`, so the rows follow a batch as it moves.
  const { wardens, startUpdate } = useCerberus();

  // The batch this dialog follows, with its updates as they stand: the answer to Update N nodes, or the batch
  // `wardens.running` held, adopted below, and then whatever that read pushes that knows more (an update frame
  // re-reads it within milliseconds; the poll below is every 2 s). Essential and not derivable: once the batch ends
  // the wardens read drops it, and the ended batch must stay on screen until Done. Null while choosing.
  const [followed, setFollowed] = useState<CerberusStartedBatch | null>(null);
  const running = wardens?.running ?? [];
  if (followed === null && running.length > 0) setFollowed({ batch: running[0].batch, updates: running });
  if (followed !== null && running[0]?.batch === followed.batch) {
    const updates = freshestBatch(followed.updates, running);
    if (updates.some((update, index) => update !== followed.updates[index])) setFollowed({ batch: followed.batch, updates });
  }
  // Read again every 2 s while this dialog stands; closing it stops the reads, never the batch.
  const batch = useUpdateBatch(followed?.batch ?? null, followed?.updates ?? []);

  // The nodes ticked while choosing, starting as every node that can take the update. Essential: it is the
  // person's choice, and what Update N nodes sends. A node ticked that stops being able to take the update
  // (it caught up some other way) is left out of what is sent (`ticked`).
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set((wardens?.nodes ?? []).filter(canTake).map((node) => node.node)),
  );
  const onToggle = (node: string, next: boolean) => {
    setSelected((held) => {
      const changed = new Set(held);
      if (next) changed.add(node);
      else changed.delete(node);
      return changed;
    });
  };

  // True from the press of Update N nodes until center answers: the Checkboxes, Cancel and the ✕ hold still, so
  // what was sent cannot change under the answer, and the press is guarded against a second.
  const [starting, setStarting] = useState(false);

  if (wardens === null || wardens.latest === null) return null;
  const { latest } = wardens;

  const phase: Phase = batch === null ? 'choosing' : batch.some((update) => update.result === null) ? 'running' : 'ended';
  const ticked = wardens.nodes.filter((node) => canTake(node) && selected.has(node.node));
  // A landed start is followed from its answer; a refused one (a batch already going) has been said by the
  // provider's toast, and the dialog follows the batch the wardens read then holds, adopted above.
  const onStart = () => {
    if (starting || ticked.length === 0) return;
    setStarting(true);
    void startUpdate(ticked.map((node) => node.node)).then((started) => {
      setStarting(false);
      if (started !== null) setFollowed(started);
    });
  };
  // A node the offer found already on the release (`from === to`) swapped nothing, so it keeps nothing for rollback.
  const kept = [...new Set(batch === null ? ticked.map((node) => node.version) : batch.filter((update) => update.from !== update.to).map((update) => update.from))]
    .filter((version): version is string => version !== null)
    .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));
  // The ending names the release the batch took its nodes to, not `latest`: a newer build landing while the batch
  // runs, or while Done waits, would otherwise make the footer say "on 0.8.0" over nodes taken to 0.7.0.
  const took = batch?.[0]?.to ?? latest.version;
  const missed = batch === null ? 0 : batch.filter((update) => update.result !== null && update.result !== 'updated').length;
  // Closing: Cancel, the ✕, Escape and the backdrop. Never while Update N nodes is out — its answer decides.
  const dismiss = () => {
    if (!starting) onClose();
  };

  return (
    <DialogFrame
      size="lg"
      marker="update"
      title={t('cerberus.updates.title')}
      accent={{ words: t('cerberus.updates.titleAccent') }}
      busy={starting}
      onDismiss={dismiss}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-[1.6] text-secondary-foreground [text-wrap:pretty]">
          {t('cerberus.updates.note', { version: latest.version, note: asClause(latest.note) })}
          {kept.length > 0 && ` ${t('cerberus.updates.kept', { count: kept.length, from: versionList(t, kept) })}`}
        </p>

        {/* A Checkbox the keyboard reaches is scrolled into view clear of the pinned footer, never under it. */}
        <ul className="overflow-hidden rounded-xl border border-border [&_input]:scroll-mb-28">
          {wardens.nodes.map((node) => (
            <NodeRow
              key={node.node}
              node={node}
              update={batch?.find((update) => update.node === node.node)}
              offer={phase === 'choosing' && canTake(node)}
              checked={selected.has(node.node)}
              disabled={starting}
              onToggle={onToggle}
              t={t}
            />
          ))}
        </ul>

        {/* Pinned to the panel's foot on the panel's own ground, under a hairline: a batch taller than a phone then
            opens at its top, because the first focus (Close, Done, or a Checkbox at the top) is already in view and
            the browser has nothing to scroll down to. The negative margin lays its bottom padding over the frame's,
            so unpinned it stands where an unpinned footer would. */}
        <div className="sticky bottom-0 z-10 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card pb-4 pt-3">
          {/* Mounted from the first frame, so the batch going and its ending are each heard as they arrive. */}
          <div role="status" className="min-w-0">
            {phase === 'running' && <p className="text-[12.5px] text-muted-foreground">{t('cerberus.updates.running')}</p>}
            {phase === 'ended' && (
              <p data-tone={missed === 0 ? 'positive' : 'warn'} className="text-[13px] text-tone-ink motion-safe:animate-shape-rise">
                <span aria-hidden>{missed === 0 ? '✓ ' : '▲ '}</span>
                {missed === 0
                  ? t('cerberus.updates.done', { version: took })
                  : t('cerberus.updates.missed', { count: missed, version: took })}
              </p>
            )}
          </div>
          <div className="ml-auto flex flex-wrap justify-end gap-3">
            {phase === 'choosing' && (
              <>
                <Button variant="outline" className="max-md:h-11" disabled={starting} onClick={dismiss}>
                  {t('cerberus.updates.cancel')}
                </Button>
                {/* `busy`, not disabled, as Mute's and Promote's: a disabled button drops the focus it holds the
                    moment the press goes out. With nothing ticked it is aria-disabled: refused, focus kept. */}
                <Button
                  className="max-md:h-11"
                  busy={starting}
                  aria-disabled={ticked.length === 0 || undefined}
                  onClick={onStart}
                >
                  {t('cerberus.updates.start', { count: ticked.length })}
                </Button>
              </>
            )}
            {phase === 'running' && (
              <Button variant="outline" className="max-md:h-11" onClick={onClose}>
                {t('cerberus.updates.close')}
              </Button>
            )}
            {phase === 'ended' && (
              <Button className="max-md:h-11" onClick={onClose}>
                {t('cerberus.updates.finish')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

type NodeRowProps = {
  node: WardenNode;
  /** The node's update in the batch the dialog follows; undefined while choosing, or when the batch left it out. */
  update: CerberusUpdateView | undefined;
  /** Choosing, and the node can take the update: its row is a Checkbox. */
  offer: boolean;
  checked: boolean;
  /** Update N nodes is out: what it sent can no longer change. */
  disabled: boolean;
  onToggle: (node: string, next: boolean) => void;
  t: TFunction;
};

/** One enrolled node: its Checkbox while it can be chosen, else its words, how its update stands, and its steps. */
function NodeRow({ node, update, offer, checked, disabled, onToggle, t }: NodeRowProps) {
  const labelId = useId();
  const label = node.version === null ? node.node : t('cerberus.updates.node', { node: node.node, version: node.version });

  if (offer) {
    // The row's padding is the label's own, so the whole row — 44 px tall — is one press target.
    return (
      <li className="border-t border-border px-4 first:border-t-0">
        <Checkbox className="py-3" checked={checked} disabled={disabled} label={label} onChange={(next) => onToggle(node.node, next)} />
      </li>
    );
  }

  const state = rowState(t, node, update);
  const steps = update?.steps ?? [];
  return (
    <li className="flex flex-col gap-1.5 border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p id={labelId} className="min-w-0 text-[14.5px] leading-[1.4] [overflow-wrap:anywhere]">
          {label}
        </p>
        {state !== null && (
          // Keyed by its words, so each new word fades in where the last one stood.
          <p
            key={state.words}
            data-tone={state.tone ?? undefined}
            className={cn(
              'text-[12.5px] font-medium [overflow-wrap:anywhere] motion-safe:animate-[vv-fade_.25s_ease_both]',
              state.tone === null ? 'text-muted-foreground' : 'text-tone-ink',
            )}
          >
            {state.glyph !== null && (
              // The running node's ● breathes at 1.2 s, as `DiagnosisPanel`'s current step does; an ended update's mark stands still.
              <span aria-hidden className={cn(state.glyph === '●' && 'motion-safe:animate-[vv-pulse_1.2s_ease-in-out_infinite]')}>
                {state.glyph}{' '}
              </span>
            )}
            {state.words}
          </p>
        )}
      </div>
      {steps.length > 0 && (
        <div role="log" aria-labelledby={labelId}>
          {/* On the canvas, as Fix output's lines are: the times' muted ink measured 4.46:1 on the prototype's
              surface2 in light, under AA, and 4.73:1 here (8.07:1 in dark). */}
          <ol className="flex flex-col gap-0.5 rounded-lg bg-background px-2.5 py-2 font-mono text-[11.5px] text-secondary-foreground">
            {steps.map((step) => (
              // A step is stamped once and never changes, so its moment and word are its key; a new one rises in.
              <li
                key={`${step.at}-${step.step}`}
                data-tone={step.step === 'failed' ? 'warn' : undefined}
                className={cn('flex gap-2.5 motion-safe:animate-cerberus-line', step.step === 'failed' && 'text-tone-ink')}
              >
                <span className="flex-none tabular-nums text-muted-foreground">{hms(step.at)}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}
