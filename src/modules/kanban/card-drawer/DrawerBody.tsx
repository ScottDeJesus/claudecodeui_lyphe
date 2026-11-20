import { Pencil, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MarkdownPreview } from '@/modules/markdown-preview';
import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import { plainTagsOf } from '@/modules/kanban/utils/walkModel';
import type { KanbanCardDetail, KanbanPriority } from '@/shared/kanban-types';
import { Button, Rule, SegmentedControl } from '@/shared/ui';

/**
 * THE CARD EVERY BOARD HAS: what this card is called and what it is for (`DrawerTitle`, first in the open card whatever else
 * leads), how urgent it is, what it is filed under, and the long text behind it (`DrawerBody`).
 *
 * IT IS THE HALF THAT IS ALWAYS VISIBLE. Nothing here is gated on autonomy, because none of it belongs to an autonomous run — a
 * board a human drives alone still has titles, priorities, tags and a description. The run's own ledger is the sections after
 * this one.
 *
 * WRITTEN IN PLACE, READ AS TEXT. The title is the Opening's title and the description the line under it, each a field only
 * under the hand: a hairline while pointed at, the accent while it has the focus, and no box at rest. How urgent it is and what
 * it is filed under are two quiet facts on the design system's label column; the long text is read as Prose under its Rule,
 * whose pencil is the way to write it.
 *
 * EVERY FIELD HOLDS A DRAFT AND SAVES DELIBERATELY. A keystroke is not a write: the board is shared, every write broadcasts,
 * and a card whose title is saved per character floods four other screens with frames. The draft is seeded once per card (the
 * shell keys this component on the card id), so a re-read that arrives while the reader is typing repaints everything EXCEPT
 * what is under their hands.
 *
 * EVERY WRITE BELOW IS A VERB ON `useKanbanMutations`, which the shell hands down. That hook is where a write becomes a toast
 * and where a refusal carries the server's own sentence, so this file calls nothing itself: a second write path here would be
 * a write the reader never hears the outcome of.
 *
 * PRIORITY IS THE CARD'S OWN LADDER, SPELLED. All three rungs are offered at once (the kit's segmented control), low to high;
 * a chosen `high` is the warn ink and never red — an urgent card is not a denied one.
 */

type DrawerBodyProps = {
  /** The open card, as the shell read it. This section fetches nothing. */
  detail: KanbanCardDetail;
  /** The board's verbs, from the shell. This section reaches the network through none of its own. */
  writes: KanbanMutations;
};

/** The ladder, low to high, left to right — the direction the value grows. */
const PRIORITIES = [
  { value: 'low', labelKey: 'kanban.priority.low' },
  { value: 'medium', labelKey: 'kanban.priority.medium' },
  { value: 'high', labelKey: 'kanban.priority.high' },
] satisfies { value: KanbanPriority; labelKey: string }[];

/** The three text fields save the same way: write, and put the DRAFT back the way the card still is when the write is refused. */
async function saveField(writes: KanbanMutations, cardId: string, patch: Parameters<KanbanMutations['updateCard']>[1], revert: () => void) {
  const landed = await writes.updateCard(cardId, patch);
  if (!landed) revert();
  return landed;
}

/**
 * The open card's name and the line under it, written in place: the title as the Opening's title, the description as its quiet
 * lead. The title is the first field of the open card, which is what a new card's naming finds (`KanbanCardDrawer`).
 *
 * Rendered by KanbanCardDrawer, first, always. Nothing else mounts it.
 */
export function DrawerTitle({ detail, writes }: DrawerBodyProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);

  const saveTitle = () => {
    const next = title.trim();
    // An empty title is refused HERE, before the round trip: the card keeps the name it had rather than becoming the blank row
    // a reader would have to hunt for on the board.
    if (next.length === 0) {
      setTitle(detail.title);
      return;
    }
    if (next === detail.title) return;
    void saveField(writes, detail.id, { title: next }, () => setTitle(detail.title));
  };

  const saveDescription = () => {
    if (description === detail.description) return;
    void saveField(writes, detail.id, { description }, () => setDescription(detail.description));
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        data-bug-title=""
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={saveTitle}
        onKeyDown={(event) => {
          // Enter LEAVES the field and the blur is what saves. Calling the saver here as well would PATCH twice on
          // Enter-then-click-away and broadcast two frames to every other screen watching this board.
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        placeholder={t('kanban.drawer.titlePlaceholder')}
        aria-label={t('kanban.drawer.title')}
        className="bug-field bug-title"
      />
      <textarea
        rows={2}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={saveDescription}
        placeholder={t('kanban.drawer.descriptionPlaceholder')}
        aria-label={t('kanban.drawer.description')}
        data-quiet="true"
        className="bug-field"
      />
    </div>
  );
}

/** Rendered by KanbanCardDrawer, always, after the questions when a card leads with them. Nothing else mounts it. */
export function DrawerBody({ detail, writes }: DrawerBodyProps) {
  const { t } = useTranslation();
  const bodyLabelId = useId();
  const priorityLabelId = useId();
  const tagsLabelId = useId();
  const tagId = useId();

  const [body, setBody] = useState(detail.body);
  const [editingBody, setEditingBody] = useState(false);
  const [tag, setTag] = useState('');

  // The tags that are only names. The flow's tag is the word in the Opening's head and each link is a row under this body
  // (`DrawerLinks`), by the other card's title: neither is a tag here, where a link would read as `duplicate-of:` and an id.
  const tagNames = plainTagsOf(detail.tags);

  const saveBody = async () => {
    // The editor is left only once the write has landed: a failed save keeps the reader's text in front of them rather than
    // folding it away into a body the server never received.
    if (await saveField(writes, detail.id, { body }, () => setBody(detail.body))) setEditingBody(false);
  };

  const setPriority = (next: KanbanPriority) => {
    // It writes on the press. There is no draft to lose and no second control to confirm at, and the chosen rung follows
    // `detail.priority`, so a refusal simply leaves the old one chosen.
    if (next === detail.priority) return;
    void writes.updateCard(detail.id, { priority: next });
  };

  const addTag = async () => {
    const next = tag.trim();
    if (next.length === 0 || detail.tags.includes(next)) return;
    if (await writes.addTag(detail.id, next)) setTag('');
  };

  const removeTag = (name: string) => {
    void writes.removeTag(detail.id, name);
  };

  const bodyPress = editingBody ? t('kanban.drawer.bodyCancel') : t('kanban.drawer.bodyEdit');

  return (
    <section className="flex flex-col gap-4">
      <dl className="bug-facts">
        <dt id={priorityLabelId}>{t('kanban.drawer.priority')}</dt>
        <dd data-priority={detail.priority}>
          <SegmentedControl
            label={t('kanban.drawer.priority')}
            options={PRIORITIES.map((step) => ({ value: step.value, label: t(step.labelKey) }))}
            value={detail.priority}
            onChange={setPriority}
          />
        </dd>

        <dt id={tagsLabelId}>{t('kanban.drawer.tags')}</dt>
        <dd>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby={tagsLabelId}>
            {tagNames.map((name) => (
              // A tag is a name, never a verdict: a hairline, never a tone.
              <span key={name} className="bug-tag">
                {name}
                <button type="button" className="ast-file-x" aria-label={t('kanban.drawer.removeTag', { tag: name })} title={t('kanban.drawer.removeTag', { tag: name })} onClick={() => removeTag(name)}>
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            <span className="bug-add flex-1 basis-28">
              <input
                id={tagId}
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addTag();
                }}
                placeholder={t('kanban.drawer.tagPlaceholder')}
                aria-label={t('kanban.drawer.tagPlaceholder')}
                className="bug-field"
              />
              {/* The press arrives with what it adds: a tag being typed. Enter adds it too. */}
              {tag.trim().length > 0 && (
                <Button variant="outline" size="icon" className="size-7 shrink-0 finger:size-11" aria-label={t('kanban.drawer.tagPlaceholder')} title={t('kanban.drawer.tagPlaceholder')} onClick={() => void addTag()}>
                  <Plus aria-hidden="true" />
                </Button>
              )}
            </span>
          </div>
        </dd>
      </dl>

      {/* The long text is READ by default and written on purpose. It is the field most likely to hold something a machine wrote
          and a human is consulting, so the resting state RENDERS it — headings, lists, tables and fenced code as the writer meant
          them — and the editor holds the source. `MarkdownPreview` comes through the markdown-preview barrel, the same door the
          PRD editor uses. With nothing written, the Rule and its pencil are all there is. */}
      <section className="flex flex-col gap-2" aria-labelledby={bodyLabelId}>
        <Rule
          id={bodyLabelId}
          end={
            <Button
              variant="outline"
              size="icon"
              className="size-7 finger:size-11"
              aria-label={bodyPress}
              title={bodyPress}
              aria-pressed={editingBody}
              onClick={() => {
                // Cancel DISCARDS. Leaving the draft behind would re-open the abandoned text on the next press, over a body the
                // server may have changed since.
                if (editingBody) setBody(detail.body);
                setEditingBody((editing) => !editing);
              }}
            >
              {editingBody ? <X aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            </Button>
          }
        >
          {t('kanban.drawer.body')}
        </Rule>

        {editingBody ? (
          <div className="flex flex-col gap-2">
            <textarea
              aria-labelledby={bodyLabelId}
              rows={10}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t('kanban.drawer.bodyPlaceholder')}
              className="vv-input w-full resize-y px-3 py-2 font-mono text-xs leading-relaxed"
            />
            <Button variant="default" size="sm" className="self-end" onClick={() => void saveBody()}>
              {t('kanban.drawer.bodySave')}
            </Button>
          </div>
        ) : (
          detail.body.trim().length > 0 && (
            <div className="bug-prose prose prose-sm max-w-none dark:prose-invert">
              <MarkdownPreview content={detail.body} />
            </div>
          )
        )}
      </section>
    </section>
  );
}
