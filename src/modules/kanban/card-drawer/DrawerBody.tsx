import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MarkdownPreview } from '@/modules/markdown-preview';
import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import type { KanbanCardDetail, KanbanPriority } from '@/shared/kanban-types';
import { Badge, Button, Chip, Field, Input } from '@/shared/ui';

/**
 * THE CARD EVERY BOARD HAS: what this card is called, how urgent it is, what it is filed under,
 * what it is for, and the long text behind it.
 *
 * IT IS THE HALF THAT IS ALWAYS VISIBLE. Nothing here is gated on autonomy, because none of it
 * belongs to an autonomous run — a board a human drives alone still has titles, priorities, tags
 * and a description. The run's own ledger is the three sections after this one.
 *
 * THE FACE FIRST. Title, priority and tags open the sheet in that order because they are exactly
 * what the reader was looking at on the card they just pressed: the drawer continues the card
 * rather than presenting a form they have to re-orient inside. The two long fields follow, in the
 * order they are written — what this is for, then what was written about it.
 *
 * EVERY FIELD HOLDS A DRAFT AND SAVES DELIBERATELY. A keystroke is not a write: the board is
 * shared, every write broadcasts, and a card whose title is saved per character floods four other
 * screens with frames. The draft is seeded once per card (the shell keys this component on the
 * card id), so a re-read that arrives while the reader is typing repaints everything EXCEPT what
 * is under their hands.
 *
 * EVERY WRITE BELOW IS A VERB ON `useKanbanMutations`, which the shell hands down. That hook is
 * where a write becomes a toast and where a refusal carries the server's own sentence, so this
 * file calls nothing itself: a second write path here would be a write the reader never hears the
 * outcome of.
 *
 * PRIORITY IS THE CARD'S OWN LADDER, SPELLED. `high` is amber and never red — an urgent card is
 * not a denied one — `medium` carries no tone at all, and `low` is the quiet end. The card face
 * prints nothing for `medium` because it is what nearly every card is; here all three are
 * present, because this is where the reader CHOOSES, and a ladder with a missing rung cannot be
 * chosen from.
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

/** Rendered by KanbanCardDrawer, always. Nothing else mounts it. */
export function DrawerBody({ detail, writes }: DrawerBodyProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const bodyLabelId = useId();
  const priorityLabelId = useId();
  const tagId = useId();

  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);
  const [body, setBody] = useState(detail.body);
  const [editingBody, setEditingBody] = useState(false);
  const [tag, setTag] = useState('');

  /** The three text fields save the same way: skip a no-op, write, and put the DRAFT back the way
   *  the card still is when the write is refused. */
  const saveField = async (patch: Parameters<KanbanMutations['updateCard']>[1], revert: () => void) => {
    const landed = await writes.updateCard(detail.id, patch);
    if (!landed) revert();
    return landed;
  };

  const saveTitle = () => {
    const next = title.trim();
    // An empty title is refused HERE, before the round trip: the card keeps the name it had rather
    // than becoming the blank row a reader would have to hunt for on the board.
    if (next.length === 0) {
      setTitle(detail.title);
      return;
    }
    if (next === detail.title) return;
    void saveField({ title: next }, () => setTitle(detail.title));
  };

  const saveDescription = () => {
    if (description === detail.description) return;
    void saveField({ description }, () => setDescription(detail.description));
  };

  const saveBody = async () => {
    // The editor is left only once the write has landed: a failed save keeps the reader's text in
    // front of them rather than folding it away into a body the server never received.
    if (await saveField({ body }, () => setBody(detail.body))) setEditingBody(false);
  };

  const setPriority = (next: KanbanPriority) => {
    // It writes on the press. There is no draft to lose and no second control to confirm at, and
    // the pressed chip follows `detail.priority`, so a refusal simply leaves the old one lit.
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

  return (
    <section className="flex flex-col gap-5">
      <Field label={t('kanban.drawer.title')} htmlFor={titleId}>
        <Input
          id={titleId}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          onKeyDown={(event) => {
            // Enter LEAVES the field and the blur is what saves. Calling the saver here as well
            // would PATCH twice on Enter-then-click-away and broadcast two frames to every other
            // screen watching this board.
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          placeholder={t('kanban.drawer.titlePlaceholder')}
          className="h-10 text-base font-medium"
        />
      </Field>

      {/* A pressed group rather than a select: three options, all of them worth seeing at once,
          and the chosen one readable without opening anything. Not a `Field` — its `<label>` would
          name a single control, and what needs naming here is the GROUP of three, so the label is
          a span carrying the same ink and `role="group"` points at it. A `<label for>` with
          nothing to bind to is markup that reads as a mistake to anything walking the tree. */}
      <div className="flex flex-col gap-1.5">
        <span className="vv-field__label" id={priorityLabelId}>{t('kanban.drawer.priority')}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={priorityLabelId}>
          {PRIORITIES.map((step) => (
            <Chip
              key={step.value}
              size="sm"
              selected={detail.priority === step.value}
              tone={step.value === 'high' ? 'warn' : undefined}
              onClick={() => setPriority(step.value)}
            >
              {t(step.labelKey)}
            </Chip>
          ))}
        </div>
      </div>

      <Field label={t('kanban.drawer.tags')} htmlFor={tagId}>
        <div className="flex flex-col gap-2">
          {detail.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {detail.tags.map((name) => (
                <li key={name}>
                  {/* A tag is a name, never a verdict: outline, never a tone. The only coloured
                      thing a tag may carry is nothing at all. */}
                  <Badge variant="outline" className="vv-badge--compact gap-1">
                    {name}
                    <button
                      type="button"
                      className="text-ink-faint hover:text-foreground"
                      aria-label={t('kanban.drawer.removeTag', { tag: name })}
                      onClick={() => removeTag(name)}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Input
              id={tagId}
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTag();
              }}
              placeholder={t('kanban.drawer.tagPlaceholder')}
              className="h-8"
            />
            <Button variant="tonal" size="sm" className="h-8 shrink-0" onClick={addTag}>
              {t('kanban.drawer.addTag')}
            </Button>
          </div>
        </div>
      </Field>

      <Field label={t('kanban.drawer.description')} htmlFor={descriptionId}>
        <textarea
          id={descriptionId}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={saveDescription}
          placeholder={t('kanban.drawer.descriptionPlaceholder')}
          className="vv-input w-full resize-y px-3 py-2 text-sm"
        />
      </Field>

      {/* The long text is READ by default and written on purpose. It is the field most likely to
          hold something a machine wrote and a human is consulting, so the resting state RENDERS
          it — headings, lists, tables and fenced code as the writer meant them — and the editor
          holds the source. A reader consulting a plan should not be parsing hashes and pipes.
          `MarkdownPreview` comes through the markdown-preview barrel, the same door and the same
          `prose` wrapper the PRD editor already uses for exactly this. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="vv-field__label" id={bodyLabelId}>{t('kanban.drawer.body')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2"
            onClick={() => {
              // Cancel DISCARDS. Leaving the draft behind would re-open the abandoned text on the
              // next Edit press, over a body the server may have changed since.
              if (editingBody) setBody(detail.body);
              setEditingBody((editing) => !editing);
            }}
          >
            {editingBody ? t('kanban.drawer.bodyCancel') : t('kanban.drawer.bodyEdit')}
          </Button>
        </div>

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
            <Button variant="default" size="sm" className="self-end" onClick={saveBody}>
              {t('kanban.drawer.bodySave')}
            </Button>
          </div>
        ) : detail.body.trim().length > 0 ? (
          <section
            aria-labelledby={bodyLabelId}
            className="vv-card prose prose-sm max-w-none break-words p-3 dark:prose-invert"
          >
            <MarkdownPreview content={detail.body} />
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">{t('kanban.drawer.bodyEmpty')}</p>
        )}
      </div>
    </section>
  );
}
