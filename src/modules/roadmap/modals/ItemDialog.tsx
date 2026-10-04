import { Lock } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { Roadmap, RoadmapEpic, RoadmapFeature, RoadmapKind, RoadmapMilestone, RoadmapPicture, RoadmapWriteBody } from '@/shared/roadmap-types';
import { Button, Dialog, DialogContent, DialogTitle, Field, Input, Select, TextArea } from '@/shared/ui';
import { roadmapTextBreak } from '@/shared/utils';

/** The lane's fences (`roadmap-write.service.ts`), met as each field is typed: `maxLength` counts UTF-16 units, so it can stop an emoji-heavy text short of the lane's limit but never lets one past it. */
const FENCES = { title: 120, goal: 8000, label: 40, folder: 400 } as const;

/** Which of the lane's fences a field's text breaks — too long or holding a NUL (`text`), a line break in a one-line field (`line`), a goal of one `-` (`dash`) — each said by its own sentence under the field (`roadmapTextBreak` finds the first two). */
type FenceBreak = 'line' | 'text' | 'dash';

/** The one project choice that is not a known pair: a folder and its label, typed by hand. */
const ANOTHER_FOLDER = 'another-folder';

/** The words a feature has before design: its goal and its folder are still the operator's to change. */
const UNPROMOTED: ReadonlySet<string> = new Set(['idea', 'proposed']);

/** A promoted feature's goal and folder: words in a dashed, muted box, never a field to type in; selectable, in the muted ink that reads at AA. */
const DESIGN_OWNED = 'rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground';

/** One project a feature can be built in, as the picture carries it: the label the roadmap shows (always one: the feature's own, or the one the dispatcher derives) and the folder the work happens in. */
type ProjectPair = { project: string; repo: string };

/** What a draft's project comes to: a pair off the picture, or the folder typed for Another folder… under the label typed with it. That label is null when left blank: an add then sends no `project` and an edit sends `''`, and either way the dispatcher derives one. */
type ChosenProject = { project: string | null; repo: string };

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

/** The last folder of a path — `/home/lyphe/restorly/` reads `restorly` — or the path itself when it has none: Another folder…'s label placeholder, where the dispatcher's rule for a label ends. */
function folderName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path;
}

/** The value `values` holds most often, the first of them on a tie; null for none. */
function mostOf(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let most: string | null = null;
  for (const [value, count] of counts) if (most === null || count > (counts.get(most) ?? 0)) most = value;
  return most;
}

/**
 * The projects a feature can be built in, as the roadmaps' features carry them, in path order: each
 * distinct (project, folder) pair. Every feature carries a label, so every pair is on the picture as it
 * stands — an edited feature's own pair among them, and an edit opens on it unchanged.
 */
function projectPairs(picture: RoadmapPicture | null): ProjectPair[] {
  const pairs = new Map<string, ProjectPair>();
  for (const roadmap of picture?.roadmaps ?? []) {
    for (const feature of roadmap.milestones.flatMap((milestone) => milestone.epics.flatMap((epic) => epic.features))) {
      if (!pairs.has(pairKey(feature))) pairs.set(pairKey(feature), { project: feature.project, repo: feature.repo });
    }
  }
  return [...pairs.values()];
}

/**
 * The project an add opens on: the folder its epic's own features use most, under the label those
 * features carry most. An epic with no feature yet opens on the folder its roadmap's features use most,
 * under the label they give it. The first project stands in only for a roadmap with no feature at all;
 * a picture with none opens on Another folder….
 */
function openingPair(picture: RoadmapPicture | null, epic: string | undefined, pairs: ProjectPair[]): string {
  const first = pairs[0] ? pairKey(pairs[0]) : ANOTHER_FOLDER;
  const home = picture?.roadmaps.find((roadmap) => roadmap.milestones.some((milestone) => milestone.epics.some((item) => item.name === epic)));
  const mine = home?.milestones.flatMap((milestone) => milestone.epics).find((item) => item.name === epic)?.features ?? [];
  const own = mine.length > 0 ? mine : home?.milestones.flatMap((milestone) => milestone.epics.flatMap((item) => item.features)) ?? [];
  const repo = mostOf(own.map((feature) => feature.repo));
  const label = mostOf(own.flatMap((feature) => (feature.repo === repo ? [feature.project] : [])));
  return repo === null || label === null ? first : pairKey({ project: label, repo });
}

/** The pairs as choices: each called by its label, with its whole path beside it where another pair is called the same. */
function pairChoices(pairs: ProjectPair[]): { value: string; label: string }[] {
  return pairs.map((pair) => {
    const twin = pairs.some((other) => other !== pair && other.project === pair.project);
    return { value: pairKey(pair), label: twin ? `${pair.project} · ${pair.repo}` : pair.project };
  });
}

/**
 * The draft a dialog opens on: the item's own words and project, or a blank add on `opening`. Only a promoted
 * feature opens with its label typed, to be renamed in place; for any other the label field is Another
 * folder…'s, and it opens blank, because the label a feature merely reads is not one it stores and a save
 * would not send it. A feature whose pair the picture no longer carries opens on Another folder…, its path
 * and label already typed, so a save that moves nothing sends nothing.
 */
function draftOf(item: EditedItem | undefined, pairs: ProjectPair[], opening: string): ItemDraft {
  const feature = item && 'repo' in item ? item : null;
  const label = feature !== null && !UNPROMOTED.has(feature.word) ? feature.project : '';
  const opened = { title: item?.title ?? '', goal: item?.goal ?? '', folder: '', label };
  if (feature === null) return { ...opened, pair: opening };
  const pair = pairKey(feature);
  if (pairs.some((known) => pairKey(known) === pair)) return { ...opened, pair };
  return { ...opened, pair: ANOTHER_FOLDER, folder: feature.repo, label: feature.project };
}

/** The project a draft names: the chosen pair, or the folder and label typed for Another folder… (a blank label is none, and the dispatcher derives one). */
function pairOf(draft: ItemDraft, pairs: ProjectPair[]): ChosenProject | null {
  if (draft.pair === ANOTHER_FOLDER) return { project: draft.label.trim() || null, repo: draft.folder.trim() };
  return pairs.find((pair) => pairKey(pair) === draft.pair) ?? null;
}

/**
 * What an edit sends: each field whose trimmed value differs from the item's, so an empty answer means Save
 * waits. A promoted feature's goal and repo are its design's (the store refuses them): only its title and label.
 */
function changesOf(draft: ItemDraft, item: EditedItem, pairs: ProjectPair[]): RoadmapWriteBody {
  const feature = 'repo' in item ? item : null;
  const promoted = feature !== null && !UNPROMOTED.has(feature.word);
  const changes: RoadmapWriteBody = {};
  if (draft.title.trim() !== item.title) changes.title = draft.title.trim();
  if (!promoted && draft.goal.trim() !== (item.goal ?? '').trim()) changes.goal = draft.goal.trim();
  if (feature === null) return changes;
  const pair = promoted ? { project: draft.label.trim() || null, repo: feature.repo } : pairOf(draft, pairs);
  if (pair === null) return changes;
  // A label left blank sends '', which hands the feature back to the dispatcher's rule for a label. A feature moved
  // to another folder sends the label its project choice shows along with the repo, even when it is the one it
  // already reads: a label it only reads is stored nowhere, and would follow the new folder.
  const label = pair.project ?? '';
  if (label !== feature.project || pair.repo !== feature.repo) changes.project = label;
  if (pair.repo !== feature.repo) changes.repo = pair.repo;
  return changes;
}

/**
 * ADD OR EDIT, ANY KIND, ONE FORM: a roadmap, a milestone, an epic or a feature. A title is all an add
 * needs, and the store mints its name from it, so an add sends none. A feature also says where it is
 * built, right under its title: a project the roadmaps' features already carry, each under its label, or
 * Another folder…, typed by hand. An add opens on the folder its epic's features use most (its roadmap's,
 * while the epic has none), under the label they carry most (`projectPairs`, `openingPair`); an add left on
 * that opening pair sends its folder and no label, and only a pair chosen or a label typed names one.
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
  const writes = useRoadmapWrites();
  useReturnFocus();

  // The projects its features carry, and the parent epic's own, are read off the live picture.
  const { picture } = useRoadmap();
  const feature = item && 'repo' in item ? item : null;
  const pairs = useMemo(() => projectPairs(picture), [picture]);
  const opening = useMemo(() => openingPair(picture, props.parent?.name, pairs), [picture, props.parent?.name, pairs]);
  // The form as typed. Opened ONCE, on the item (or a blank add on `opening`), because the picture redraws
  // on every frame the lane sends and a frame that lands mid-edit must never overwrite what is being typed.
  const [draft, setDraft] = useState<ItemDraft>(() => draftOf(item, pairs, opening));
  const change = (patch: Partial<ItemDraft>) => setDraft((typed) => ({ ...typed, ...patch }));
  // The write is out, so its button shows busy and Cancel, Escape and the backdrop wait for the answer: it is already at the dispatcher.
  const [busy, setBusy] = useState(false);

  const promoted = feature !== null && !UNPROMOTED.has(feature.word);
  const projected = kind === 'plan' && !promoted;
  const chosen = pairOf(draft, pairs);
  const another = projected && draft.pair === ANOTHER_FOLDER;
  const folder = draft.folder.trim();
  const folderWrong = another && folder !== '' && !folder.startsWith('/');
  // The lane's other fences, met before anything is sent: each field's own invalid state, with its sentence under it.
  const titleBreak = roadmapTextBreak(draft.title.trim(), FENCES.title, true);
  const goalBreak: FenceBreak | null = roadmapTextBreak(draft.goal.trim(), FENCES.goal, false) ?? (draft.goal.trim() === '-' ? 'dash' : null);
  // The label's fence holds only for a label the operator typed: one the field is not drawing, or the feature's own
  // left alone, is the dispatcher's to give, and its step for a repo no feature labels (the folder's name) is not
  // fenced, so a label a feature reads can run past 40 and must never hold its title back.
  const labelTyped = (another || promoted) && draft.label.trim() !== (feature?.project ?? '');
  const labelBreak = labelTyped ? roadmapTextBreak(draft.label.trim(), FENCES.label, true) : null;
  const goalAsked = props.goalFirst !== undefined || feature?.word === 'proposed';
  const changed = item === undefined || Object.keys(changesOf(draft, item, pairs)).length > 0;
  const ready = draft.title.trim() !== '' && (!goalAsked || draft.goal.trim() !== '') && (!another || folder.startsWith('/')) && changed
    && titleBreak === null && goalBreak === null && labelBreak === null
    // A frame can take the chosen pair away mid-dialog (the last feature carrying it moved or was re-labelled elsewhere):
    // the Select then shows its placeholder, and a write sent now would carry no repo and no project, which the dispatcher
    // answers by quietly building the feature in its epic's folder. It waits until a project is chosen.
    && (!projected || chosen !== null);

  // An add names no item: the store mints its name from the title and its ADDED line says it. An edit sends only the
  // fields that changed, and the toast calls the item by the title it now has.
  const submit = async () => {
    setBusy(true);
    let landed: boolean;
    if (item === undefined) {
      const body: RoadmapWriteBody = { kind, parent: props.parent?.name, title: draft.title.trim() };
      const goal = draft.goal.trim();
      if (goal !== '') body.goal = goal;
      // A feature's project is the pair chosen, or the folder and label typed for Another folder…. The pair the dialog opened
      // on is one the picture only READS (the dispatcher may have derived its label, and a derived label is stored nowhere), so
      // left as opened it sends the repo alone and the feature reads its repo's label; another pair, or a label typed, names
      // one. With that label left blank no project is sent either.
      const pair = projected ? pairOf(draft, pairs) : null;
      if (pair !== null) {
        body.repo = pair.repo;
        if (pair.project !== null && (draft.pair === ANOTHER_FOLDER || draft.pair !== opening)) body.project = pair.project;
      }
      landed = await writes.add(body);
    } else {
      const changes = changesOf(draft, item, pairs);
      landed = await writes.edit({ kind, name: item.name, ...changes, itemTitle: changes.title ?? item.title });
    }
    // A landed write closes the dialog; a refusal keeps it open, with what was typed, beside the hook's toast.
    if (landed) onClose(true);
    else setBusy(false);
  };

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
    <Field label={t('roadmap.dialog.item.title')} htmlFor={`${fieldId}-title`} error={titleBreak === null ? undefined : t(`roadmap.dialog.fence.${titleBreak}`, { max: FENCES.title })}>
      <Input
        id={`${fieldId}-title`} value={draft.title} maxLength={FENCES.title} invalid={titleBreak !== null} aria-required="true" autoComplete="off"
        onChange={(event) => change({ title: event.target.value })}
      />
    </Field>
  );
  const goalField = !promoted && (
    <Field
      label={t('roadmap.dialog.item.goal')} htmlFor={`${fieldId}-goal`} helper={goalHint}
      error={goalBreak === null ? undefined : t(`roadmap.dialog.fence.${goalBreak}`, { max: FENCES.goal })}
    >
      <TextArea
        id={`${fieldId}-goal`} value={draft.goal} rows={props.goalFirst ? 6 : 4} maxLength={FENCES.goal} invalid={goalBreak !== null}
        aria-required={goalAsked || undefined} aria-describedby={`${fieldId}-goal-helper`} onChange={(event) => change({ goal: event.target.value })}
      />
    </Field>
  );
  // A project's name, typed: Another folder…'s label, or a promoted feature's project renamed in place. Blank is none: the
  // dispatcher derives one. Another folder…'s placeholder shows its folder's name, where that rule ends; a promoted feature's
  // field has none, because a blanked label reads what the rule gives it, which is not the folder's name.
  const labelField = (placeholder?: string) => (
    <Field label={t('roadmap.dialog.item.folderLabel')} htmlFor={`${fieldId}-label`} error={labelBreak === null ? undefined : t(`roadmap.dialog.fence.${labelBreak}`, { max: FENCES.label })}>
      <Input
        id={`${fieldId}-label`} value={draft.label} maxLength={FENCES.label} invalid={labelBreak !== null} placeholder={placeholder || undefined} autoComplete="off"
        onChange={(event) => change({ label: event.target.value })}
      />
    </Field>
  );

  // A feature's project, right under its title, so the list opens with the goal's room below it; and Another folder…'s path and name.
  const projectFields = projected && (
    <>
      <Field label={t('roadmap.dialog.item.project')} helper={another ? undefined : chosen?.repo}>
        <Select
          options={[...pairChoices(pairs), { value: ANOTHER_FOLDER, label: t('roadmap.dialog.item.anotherFolder') }]}
          value={draft.pair}
          ariaLabel={t('roadmap.dialog.item.project')}
          onChange={(next) => change({ pair: next })}
        />
      </Field>
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
    </>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      {/* Sized to its content, and a scroller only on a screen too short for its tallest state (goal first, Another folder…
          and its amber error: 811px with its margin at 320 wide). A scrolling panel clips the project list, which opens in
          place under its trigger, and on a phone no touch reaches the clipped choices: the list keeps a pan, and a press
          outside it closes it. */}
      <DialogContent
        aria-labelledby={titleId}
        data-roadmap-dialog="item"
        className="w-[calc(100vw-2rem)] max-w-lg p-0 [@media(max-height:820px)]:max-h-[calc(100dvh-2rem)] [@media(max-height:820px)]:overflow-y-auto [@media(max-height:820px)]:overscroll-contain"
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
          {props.goalFirst ? <>{goalField}{titleField}{projectFields}</> : <>{titleField}{projectFields}{goalField}</>}

          {promoted && feature && (
            <>
              {labelField()}
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
