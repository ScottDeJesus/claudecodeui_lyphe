import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { linksOf, type KanbanLinkedTitle } from '@/modules/kanban/utils/walkModel';
import type { KanbanCardDetail } from '@/shared/kanban-types';
import { Rule } from '@/shared/ui';

/**
 * THE CARDS THIS ONE IS TIED TO: a duplicate, the card it was split from, a related one, the
 * earlier fix it is a regression of.
 *
 * DIRECTLY UNDER THE CARD ITSELF, above everything the run wrote, because a tie changes what the
 * card IS: a card that is a duplicate of another is read differently from its first line down.
 *
 * THE TITLE, WHOLE, AND NEVER THE ID. Each row is the word for the tie and the other card's title,
 * unclipped. The row is the press, an object that opens and so no button's frame: it opens that
 * card in this same Opening. 44 px under a finger.
 *
 * A CARD THAT IS GONE IS SAID, NOT OFFERED. Its row is the same word and "a card that is no longer
 * on this board", in the calm ink, with no press: opening it could only show that it cannot be
 * read.
 *
 * NO TIES, NO SECTION.
 */

type DrawerLinksProps = {
  /** The open card, as the shell read it. This section fetches nothing. */
  detail: KanbanCardDetail;
  /** What the board knows of another of its cards: its title, not read yet, or gone. */
  titleOf: (cardId: string) => KanbanLinkedTitle;
  /** Opens the linked card in the drawer. */
  onOpenCard: (cardId: string) => void;
};

/** Rendered by KanbanCardDrawer, under the card's body, on every board. */
export function DrawerLinks({ detail, titleOf, onOpenCard }: DrawerLinksProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const links = linksOf(detail.tags, { t, titleOf });

  if (links.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId} data-drawer-links>
      <Rule id={headingId}>{t('kanban.links.title')}</Rule>
      <ul className="-mx-2 flex flex-col">
        {links.map((link, index) => {
          const { id } = link;
          if (id === null) {
            return (
              <li key={`${link.word}-gone-${index}`} className="flex min-w-0 items-baseline gap-2.5 px-2 py-1.5" data-linked-card-gone>
                <span className="bug-word">{link.word}</span>
                <span className="min-w-0 flex-1 break-words text-[13px] leading-[18px] text-muted-foreground">{link.title}</span>
              </li>
            );
          }
          return (
            <li key={`${link.word}-${id}`}>
              {/* The row is the press: an object that opens, so no frame of a button round it. */}
              <button type="button" className="bug-row" data-linked-card={id} onClick={() => onOpenCard(id)}>
                <span className="bug-word">{link.word}</span>
                <span className="min-w-0 flex-1 break-words text-[13px] leading-[18px]">{link.title}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
