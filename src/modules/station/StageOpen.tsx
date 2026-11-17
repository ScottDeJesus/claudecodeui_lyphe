import { ArrowUpRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AnchorHTMLAttributes, ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { StageFoot } from '@/modules/station/stageSlots';
import { Button, buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';

type StageOpenProps = Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size' | 'onClick'> & {
  /** Where the press goes, in full ("Open the chat"): its name for a reader and its hover. */
  name: string;
  /** The word on the button, where it is not the plain "Open" (a card that opens something other than itself says what). */
  word?: string;
  /** The mark beside the word, and the whole button under a finger. The way-out arrow unless the kind has its own. */
  icon?: LucideIcon;
} & (
  /** A press the page answers… */
  | { onOpen: () => void; href?: undefined }
  /** …or a place outside the app, which opens in a new tab as a real link. */
  | { href: string; onOpen?: undefined }
);

/** The button's own sizes: the kit's small outline button, and a 44 px square holding its mark alone under a finger. */
const SIZE = 'finger:h-11 finger:w-11 finger:px-0';

/**
 * THE PANEL'S "OPEN": the one press that takes you to the thing itself (the chat, the check, the plan), as the kit's button at the
 * panel's foot, outside what scrolls, so a long body never carries it away. Its word is "Open", because the panel's head already
 * names the thing; its full name ("Open the chat") is what a reader hears. Under a finger it is its mark alone, at 44 px.
 *
 * A place outside the app (`href`: a DocSpace page) is a real link drawn as the same button, opening in a new tab.
 *
 * Every other prop reaches the button, so a kind keeps its own handles on it (`data-station-chat-open`, `data-station-fire`).
 *
 * Used by this module's `ChatStageView`, `AskStageView`, `FollowupsStageView`, `CheckStageView` and `NoteStageView`.
 */
export function StageOpen({ name, word, icon: Icon = ArrowUpRight, onOpen, href, ...rest }: StageOpenProps) {
  const { t } = useTranslation();
  const inside = (
    <>
      <span className="finger:hidden">{word ?? t('station.stage.open', { defaultValue: 'Open' })}</span>
      <Icon aria-hidden="true" />
    </>
  );
  return (
    <StageFoot>
      <div className="flex justify-end">
        {href !== undefined ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={name}
            title={name}
            {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), SIZE)}
          >
            {inside}
          </a>
        ) : (
          <Button variant="outline" size="sm" aria-label={name} title={name} {...rest} className={SIZE} onClick={onOpen}>
            {inside}
          </Button>
        )}
      </div>
    </StageFoot>
  );
}
