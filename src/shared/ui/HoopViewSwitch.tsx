import { List } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HEAD_PRESS } from '@/shared/constants';
import type { HoopView } from '@/shared/types';
import { Button } from '@/shared/ui/Button';

type HoopViewSwitchProps = {
  /** What the screen's set is shown as now. */
  view: HoopView;
  /** The other was chosen. */
  onChange: (next: HoopView) => void;
};

/**
 * THE SWITCH BETWEEN AN INSTRUMENT'S HOOP AND ITS LIST, in a screen's head just before the menu: the list's mark, lit quietly while
 * the list is shown (`aria-pressed`), as the chat head's switches are lit. Its mark says what it does, so it carries no word: "List
 * view" is its name and its title. It is drawn as the head's other presses are (`HEAD_PRESS`): 36 px at a desk, 28 px under a finger
 * and still caught at 44.
 *
 * Used by the kanban module's `BugHead` (the board and its proposed features) and the cerberus module's `CerberusPanel` (the fleet,
 * drawn into the screen head through `HeadTools`).
 */
export function HoopViewSwitch({ view, onChange }: HoopViewSwitchProps) {
  const { t } = useTranslation();
  const list = view === 'list';
  const name = t('buttons.listView', { defaultValue: 'List view' });
  return (
    <Button
      data-hoop-view-switch={view}
      variant={list ? 'tonal' : 'outline'}
      size="icon"
      className={HEAD_PRESS}
      aria-pressed={list}
      aria-label={name}
      title={name}
      onClick={() => onChange(list ? 'hoop' : 'list')}
    >
      <List aria-hidden="true" />
    </Button>
  );
}
