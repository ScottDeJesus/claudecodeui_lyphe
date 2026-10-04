import { Lock } from 'lucide-react';
// FILL: imports — the markers' own: react's useState beside useId, and useRoadmap and useRoadmapWrites under them
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { Roadmap, RoadmapEpic, RoadmapFeature, RoadmapKind, RoadmapMilestone, RoadmapWriteBody } from '@/shared/roadmap-types';
import { Button, Dialog, DialogContent, DialogTitle, Field, Input, Select, TextArea } from '@/shared/ui';
import { folderName } from '@/shared/utils';

// Add or edit one roadmap item of any kind, in one form.
//
// Each fill marker below governs the ONE statement under it, which holds a fake standing in for what the
// fill reads, holds or does; `imports` governs the react import under it and the lines the fill adds
// beside it. Every other line is composition and stays as it is.

/**
 * The lane's fences (`roadmap-write.service.ts`), met as each field is typed: a title and a project label
 * are one line, a folder an absolute path. `maxLength` counts UTF-16 units, never fewer than the code
 * points the lane counts, so a typed value never runs past its fence.
 */
const FENCES = { title: 120, goal: 8000, label: 40, folder: 400 } as const;

/** The one project choice that is not a known pair: a folder and its label, typed by hand. */
const ANOTHER_FOLDER = 'another-folder';

/** The words a feature has before design: its goal and its folder are still the operator's to change. */
const UNPROMOTED: ReadonlySet<string> = new Set(['idea', 'proposed']);

/**
 * What a promoted feature's goal and folder are drawn in: words in a dashed, muted box, so nothing about
 * them reads as a field to type in. They stay selectable, in the muted ink that reads at AA.
 */
const DESIGN_OWNED = 'rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground';

/** One project a feature can be built in: the label the roadmap shows (null: none, so its folder's name) and the folder the work happens in. */
type ProjectPair = { project: string | null; repo: string };

/** The form as typed. `pair` is a known pair's key or ANOTHER_FOLDER, whose folder and label are typed by hand; a promoted feature's `label` is its project, renamed in place. */
type ItemDraft = { title: string; goal: string; pair: string; folder: string; label: string };

/** What an edit opens on: the item as the picture draws it. Only a feature carries a `repo`. */
type EditedItem = Roadmap | RoadmapMilestone | RoadmapEpic | RoadmapFeature;

type ItemDialogProps = {
  /** The dispatcher's own word for what is added or edited: `arc` is an epic, `plan` a feature. */
  kind: RoadmapKind;
  /** Closes the dialog: `true` once its write landed, `false` on Cancel, Escape or the backdrop. */
  onClose: (written: boolean) => void;
} & (
  | {
      /** An add, and where it lands — the roadmap for a milestone, the milestone for an epic, the epic for a feature — said by its title; `null` for a roadmap. */
      parent: { name: string; title: string } | null;
      item?: never;
      goalFirst?: never;
    }
  | {
      /** An edit, of the item as the picture has it. */
      item: EditedItem;
      /** The goal first, and asked for: `FeatureDialog` on a feature with no goal, `then` naming what follows its Save; the roadmap header's missing goal, `then: null`. */
      goalFirst?: { then: 'propose' | 'promote' | null };
      parent?: never;
    }
);

/** A pair's key: both halves, so one label on two folders, or two labels on one, stays two choices. */
function pairKey(pair: ProjectPair): string {
  return JSON.stringify([pair.repo, pair.project]);
}

/** The pairs as choices: each called by its label, else its folder's name, with its whole path beside it where another pair is called the same. */
function pairChoices(pairs: ProjectPair[]): { value: string; label: string }[] {
  const called = (pair: ProjectPair) => pair.project ?? folderName(pair.repo);
  return pairs.map((pair) => {
    const twin = pairs.some((other) => other !== pair && called(other) === called(pair));
    return { value: pairKey(pair), label: twin ? `${called(pair)} · ${pair.repo}` : called(pair) };
  });
}

/**
 * The draft a dialog opens on: the item's own words and project, or a blank add on the first known
 * project. A folder no known pair holds — an empty picture's first feature, or a feature whose pair the
 * picture no longer carries — opens on Another folder… with its path and label already typed.
 */
function draftOf(item: EditedItem | undefined, pairs: ProjectPair[]): ItemDraft {
  const feature = item && 'repo' in item ? item : null;
  const opened = { title: item?.title ?? '', goal: item?.goal ?? '', folder: '', label: feature?.project ?? '' };
  if (feature === null) return { ...opened, pair: pairs[0] ? pairKey(pairs[0]) : ANOTHER_FOLDER };
  const pair = pairKey({ project: feature.project, repo: feature.repo });
  if (pairs.some((known) => pairKey(known) === pair)) return { ...opened, pair };
  return { ...opened, pair: ANOTHER_FOLDER, folder: feature.repo };
}

/** The project a draft names: the chosen pair, or the folder and label typed for Another folder… (a blank label is none, and the folder's name stands in). */
function pairOf(draft: ItemDraft, pairs: ProjectPair[]): ProjectPair | null {
  if (draft.pair === ANOTHER_FOLDER) return { project: draft.label.trim() || null, repo: draft.folder.trim() };
  return pairs.find((pair) => pairKey(pair) === draft.pair) ?? null;
}

/**
 * What an edit sends: each field whose trimmed value differs from the item's, and nothing else, so an
 * empty answer means nothing changed and Save waits. A promoted feature's goal and repo are its design's
 * (the store refuses them), so only its title and its project's label can change.
 */
function changesOf(draft: ItemDraft, item: EditedItem, pairs: ProjectPair[]): RoadmapWriteBody {
  const feature = 'repo' in item ? item : null;
  const promoted = feature !== null && !UNPROMOTED.has(feature.word);
  const changes: RoadmapWriteBody = {};
  if (draft.title.trim() !== item.title) changes.title = draft.title.trim();
  if (!promoted && draft.goal.trim() !== (item.goal ?? '').trim()) changes.goal = draft.goal.trim();
  if (feature === null) return changes;
  const pair = promoted ? { project: draft.label.trim() || null, repo: feature.repo } : pairOf(draft, pairs);
  if (pair !== null && (pair.project ?? '') !== (feature.project ?? '')) changes.project = pair.project ?? '';
  if (pair !== null && pair.repo !== feature.repo) changes.repo = pair.repo;
  return changes;
}

/**
 * ADD OR EDIT, ANY KIND, ONE FORM: a roadmap, a milestone, an epic or a feature. A title is all an add
 * needs, and the store mints its name from it, so an add sends none. A feature also says where it is
 * built: a (project, folder) pair the roadmap's features already carry, or Another folder…, typed by hand.
 *
 * AN EDIT SENDS ONLY WHAT CHANGED, and Save waits until something has. A promoted feature's goal and
 * folder belong to its design: they show locked under "Its design owns these now", and its title and its
 * project's name stay the operator's. A proposed feature keeps its goal (the store refuses to clear it).
 * Every field meets the lane's fence as it is typed; a folder that is not a full path says so in amber.
 *
 * THE GOAL FIRST, for `FeatureDialog`'s Propose and Promote on a feature with no goal and for a roadmap's
 * missing goal: the goal field leads, so the dialog's first focus lands on it; it is asked for; and the
 * button says what follows its Save.
 *
 * Mounted for as long as it is open, so focus goes back to its opener with it (`useReturnFocus`). NOTHING
 * IS OPTIMISTIC: a landed write closes it and the roadmap redraws from the next frame; a refusal keeps it
 * open, with what was typed, beside the hook's toast.
 *
 * Used by the roadmap module: `FeatureDialog` (Edit, Edit title and project, the goal first) and the
 * Roadmap face's dialog host for every other add and edit — New roadmap…, Add a milestone, Add an epic,
 * Add a feature, Edit on a roadmap, a milestone or an epic, and a roadmap's missing goal (the goal first).
 */
export function ItemDialog(props: ItemDialogProps) {
  const { kind, item, onClose } = props;
  const { t } = useTranslation();
  const titleId = useId();
  const fieldId = useId();
  useReturnFocus();

  // FILL: projects — every distinct (project, repo) pair the picture's features carry (useRoadmap().picture), in the picture's own order
  const pairs: ProjectPair[] = [
    { project: 'Restorly', repo: '/home/lyphe/restorly' }, { project: 'house', repo: '/home/lyphe/restorly' },
    { project: 'lyphecli', repo: '/home/lyphe/.claude/claudecodeui_lyphe' },
  ];
  // FILL: draft — component state, with its comment: the form as typed, opened ONCE on draftOf(item, pairs), so a frame that lands mid-edit never overwrites what is being typed
  const draft: ItemDraft = draftOf(item, pairs);
  // FILL: change — lays a field's new value over the draft: setDraft((typed) => ({ ...typed, ...patch }))
  const change = (_patch: Partial<ItemDraft>) => {};
  // FILL: busy — component state, with its comment: the write is out, so its button shows busy, and Cancel, Escape and the backdrop wait for the answer
  const busy = false;
  // FILL: submit — the write, through useRoadmapWrites with busy held. An add: writes.add({ kind, parent: parent?.name, title, goal (when one is typed) }, plus the pair's project and repo for a feature) — never a name. An edit: writes.edit({ kind, name: item.name, ...changesOf(draft, item, pairs), itemTitle: item.title }). true → onClose(true); false → it stays open
  const submit = () => {};

  const feature = item && 'repo' in item ? item : null;
  const promoted = feature !== null && !UNPROMOTED.has(feature.word);
  const projected = kind === 'plan' && !promoted;
  const chosen = pairOf(draft, pairs);
  const another = projected && draft.pair === ANOTHER_FOLDER;
  const folder = draft.folder.trim();
  const folderWrong = another && folder !== '' && !folder.startsWith('/');
  const goalAsked = props.goalFirst !== undefined || feature?.word === 'proposed';
  const changed = item === undefined || Object.keys(changesOf(draft, item, pairs)).length > 0;
  const ready = draft.title.trim() !== '' && (!goalAsked || draft.goal.trim() !== '') && (!another || folder.startsWith('/')) && changed;

  const then = props.goalFirst?.then ?? null;
  const submitLabel = item === undefined ? t('roadmap.dialog.item.add')
    : then === 'propose' ? t('roadmap.dialog.item.saveAndPropose')
      : then === 'promote' ? t('roadmap.dialog.item.saveAndPromote')
        : t('roadmap.dialog.item.save');
  const goalHint = props.goalFirst && kind === 'plan' ? t('roadmap.dialog.feature.noGoal')
    : feature?.word === 'proposed' ? t('roadmap.dialog.item.goalHint.proposed')
      : t(`roadmap.dialog.item.goalHint.${kind}`);

  // Closing without writing: Cancel, Escape and the backdrop. Never while the write is out — its answer decides.
  const dismiss = () => {
    if (!busy) onClose(false);
  };

  const titleField = (
    <Field label={t('roadmap.dialog.item.title')} htmlFor={`${fieldId}-title`}>
      <Input id={`${fieldId}-title`} value={draft.title} maxLength={FENCES.title} aria-required="true" autoComplete="off" onChange={(event) => change({ title: event.target.value })} />
    </Field>
  );
  const goalField = !promoted && (
    <Field label={t('roadmap.dialog.item.goal')} htmlFor={`${fieldId}-goal`} helper={goalHint}>
      <TextArea
        id={`${fieldId}-goal`} value={draft.goal} rows={props.goalFirst ? 6 : 4} maxLength={FENCES.goal}
        aria-required={goalAsked || undefined} aria-describedby={`${fieldId}-goal-helper`} onChange={(event) => change({ goal: event.target.value })}
      />
    </Field>
  );
  // A project's name, typed: Another folder…'s label, or a promoted feature's project renamed in place. Blank is none: the folder's name stands in, as the placeholder shows.
  const labelField = (placeholder: string) => (
    <Field label={t('roadmap.dialog.item.folderLabel')} htmlFor={`${fieldId}-label`}>
      <Input id={`${fieldId}-label`} value={draft.label} maxLength={FENCES.label} placeholder={placeholder || undefined} autoComplete="off" onChange={(event) => change({ label: event.target.value })} />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      {/* Sized to its content, never a scroller of its own: the project list opens in place under its trigger, and a scrolling
          body would cut it off. Only a screen too short to hold the form scrolls it. */}
      <DialogContent
        aria-labelledby={titleId}
        data-roadmap-dialog="item"
        className="w-[calc(100vw-2rem)] max-w-lg p-0 [@media(max-height:600px)]:max-h-[calc(100dvh-1rem)] [@media(max-height:600px)]:overflow-y-auto"
      >
        <form
          className="flex flex-col gap-5 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) submit();
          }}
        >
          <header className="min-w-0">
            <DialogTitle id={titleId} className="not-sr-only font-serif text-2xl font-normal leading-tight text-foreground">
              {item === undefined ? t(`roadmap.dialog.item.addTitle.${kind}`) : t(`roadmap.dialog.item.editTitle.${kind}`)}
            </DialogTitle>
            {props.parent && <p className="mt-1 truncate text-sm text-muted-foreground">{t('roadmap.dialog.item.addIn', { title: props.parent.title })}</p>}
          </header>

          {/* The goal first is the goal FIRST in the form too: the dialog's own first focus lands on it. */}
          {props.goalFirst ? <>{goalField}{titleField}</> : <>{titleField}{goalField}</>}

          {projected && (
            <Field label={t('roadmap.dialog.item.project')} helper={another ? undefined : chosen?.repo}>
              <Select
                options={[...pairChoices(pairs), { value: ANOTHER_FOLDER, label: t('roadmap.dialog.item.anotherFolder') }]}
                value={draft.pair}
                ariaLabel={t('roadmap.dialog.item.project')}
                onChange={(next) => change({ pair: next })}
              />
            </Field>
          )}

          {another && (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <Field
                label={t('roadmap.dialog.item.folderPath')}
                htmlFor={`${fieldId}-folder`}
                helper={t('roadmap.dialog.item.folderHint')}
                error={folderWrong ? t('roadmap.dialog.item.folderAbsolute') : undefined}
              >
                <Input
                  id={`${fieldId}-folder`} value={draft.folder} maxLength={FENCES.folder} invalid={folderWrong} className="font-mono text-[13px]"
                  aria-required="true" aria-describedby={`${fieldId}-folder-helper`} spellCheck={false} autoCapitalize="off" autoComplete="off"
                  onChange={(event) => change({ folder: event.target.value })}
                />
              </Field>
              {labelField(folderName(folder))}
            </div>
          )}

          {promoted && feature && (
            <>
              {labelField(folderName(feature.repo))}
              <div className="flex flex-col gap-4 border-t border-border pt-4" data-roadmap-design-owns>
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Lock aria-hidden="true" className="size-3.5 shrink-0" />
                  {t('roadmap.dialog.item.designOwns')}
                </p>
                {/* A design's goal runs long: it scrolls in its own box, which the keyboard can reach and scroll too. */}
                <Field label={t('roadmap.dialog.item.goal')} locked>
                  <div role="region" tabIndex={0} aria-label={t('roadmap.dialog.item.goal')} className={`${DESIGN_OWNED} max-h-40 overflow-y-auto whitespace-pre-wrap break-words`}>
                    {feature.goal}
                  </div>
                </Field>
                <Field label={t('roadmap.dialog.item.folderPath')} locked>
                  <p className={`${DESIGN_OWNED} break-all font-mono text-[13px]`}>{feature.repo}</p>
                </Field>
              </div>
            </>
          )}

          <footer className="flex flex-wrap justify-end gap-2.5 pt-1">
            <Button type="button" variant="ghost" className="max-md:h-11" disabled={busy} onClick={dismiss}>
              {t('roadmap.dialog.cancel')}
            </Button>
            <Button type="submit" className="max-md:h-11" disabled={!ready || busy} aria-busy={busy || undefined}>
              {submitLabel}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
