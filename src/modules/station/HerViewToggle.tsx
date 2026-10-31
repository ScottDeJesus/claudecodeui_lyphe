import { MessageCircle, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StationHerView } from '@/shared/types';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

type HerViewToggleProps = {
  /** The view her column is in now: the press names the other one. */
  herView: StationHerView;
  /** The view the press chooses (`useHerView`'s setter on the page). */
  onChange: (next: StationHerView) => void;
  /** The place's own sizing: her menu's panel stretches it across, her head's forms leave it at its width. */
  className?: string;
};

/**
 * THE TOGGLE BETWEEN HER TWO VIEWS, one kit `Button` named by its word: "Show chat" while her portrait is drawn, "Show portrait"
 * while her conversation is, each with its glyph. A 44 px catch under a finger (`finger:h-11`, INV-10275); the word is drawn, never
 * only a title, so it reads where nothing hovers. `data-station-head-view` reads the view drawn now.
 *
 * Used by this module's StationHeadView, which stands it in her head beside "Her controls" (and under her controls' line where they
 * stand open), and by HeadRow, which stands it in her one menu on a phone, where the row has no room for a word of its own.
 */
export function HerViewToggle({ herView, onChange, className }: HerViewToggleProps) {
  const { t } = useTranslation();
  const toChat = herView === 'portrait';
  const Glyph = toChat ? MessageCircle : UserRound;
  return (
    <Button
      variant="outline"
      size="sm"
      data-station-head-view={herView}
      className={cn('finger:h-11', className)}
      onClick={() => onChange(toChat ? 'chat' : 'portrait')}
    >
      <Glyph aria-hidden="true" />
      {toChat ? t('station.head.showChat', { defaultValue: 'Show chat' }) : t('station.head.showPortrait', { defaultValue: 'Show portrait' })}
    </Button>
  );
}
