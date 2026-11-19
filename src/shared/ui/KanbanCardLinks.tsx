import { cn } from '@/shared/utils';

/**
 * The cards a card points at, on its face: each one a word for how the two are tied and the other
 * card's title, and a press that opens that card.
 *
 * KIT, and part of `KanbanCard`: it knows no link kinds and no ids' meaning. The board decides
 * which cards are linked and what each link is called; this draws the word and the title it was
 * handed and raises the linked card's id through the card's own `onOpen`, so a board has ONE way
 * to open a card and a link is a second door to it rather than a second verb.
 *
 * THE TITLE, NEVER THE ID. `id` is what the press carries and is never painted: a reader is told
 * which card by its name.
 *
 * A LINK WITH NOWHERE TO GO IS WORDS, NOT A PRESS. A link whose `id` is `null` names a card that
 * can no longer be opened; it is drawn in the same place and the same ink, without the underline,
 * and it takes no Tab stop — a press that can only fail is a dead end offered as a door.
 *
 * TWO ON THE FACE, THE REST COUNTED. A card tied to five others would otherwise be five rows of
 * other cards' titles under one line of its own. The count is words, not a press: the card itself
 * is the press that shows the whole list.
 *
 * UNDER A FINGER EVERY ROW IS 44 PX (`finger:min-h-11`); at a desk a row is one compact line.
 */

export type KanbanCardLink = {
  /** The linked card's id: what the press opens. Never painted. `null` for a card that cannot be
   *  opened any more: its row is then words alone. */
  id: string | null;
  /** How this card is tied to that one, in the board's words: "Duplicate of", "Split from". */
  word: string;
  /** The linked card's title: what the reader is told. */
  title: string;
};

type KanbanCardLinksProps = {
  links: KanbanCardLink[];
  /** The card's own roving Tab stop: a link is reachable by Tab from the one card a lane lets in. */
  tabStop: boolean;
  onOpen: (id: string) => void;
};

/** How many links a face names before the rest fold into a count. */
const LINKS_ON_FACE = 2;

/** The marker `KanbanCard` reads to tell a press on a link from a press on the card around it. */
export const KANBAN_CARD_LINK_ATTRIBUTE = 'data-card-link';

const WORDS = {
  open: (word: string, title: string) => `${word} ${title}. Open that card`,
  more: (n: number) => `and ${n} more linked card${n === 1 ? '' : 's'}`,
};

/** Rendered by KanbanCard, under its signals, for a card whose model carries links. */
export function KanbanCardLinks({ links, tabStop, onOpen }: KanbanCardLinksProps) {
  const shown = links.slice(0, LINKS_ON_FACE);
  const folded = links.length - shown.length;

  return (
    <div className="flex min-w-0 flex-col">
      {shown.map((link, index) => {
        const { id } = link;
        if (id === null) {
          return (
            <p key={`${link.word}-gone-${index}`} className="flex min-h-6 min-w-0 items-center gap-1.5 text-xs">
              <span className="shrink-0 text-muted-foreground">{link.word}</span>
              <span className="min-w-0 truncate text-muted-foreground">{link.title}</span>
            </p>
          );
        }
        return (
          <button
            key={`${link.word}-${id}`}
            type="button"
            {...{ [KANBAN_CARD_LINK_ATTRIBUTE]: id }}
            tabIndex={tabStop ? 0 : -1}
            aria-label={WORDS.open(link.word, link.title)}
            className={cn(
              'vv-lane-card__link -mx-1 flex min-h-6 min-w-0 items-center gap-1.5 rounded px-1 text-left text-xs',
              'finger:min-h-11',
            )}
            onClick={() => onOpen(id)}
          >
            <span className="shrink-0 text-muted-foreground">{link.word}</span>
            <span className="vv-lane-card__link-title min-w-0 truncate text-foreground">{link.title}</span>
          </button>
        );
      })}
      {folded > 0 && <span className="text-xs text-ink-faint">{WORDS.more(folded)}</span>}
    </div>
  );
}
