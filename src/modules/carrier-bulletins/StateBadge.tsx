import type { BulletinLook } from '@/modules/carrier-bulletins/utils/bulletinModel';
import { Badge } from '@/shared/ui';

type StateBadgeProps = {
  /** The state's tone and glyph, from one of `bulletinModel`'s look tables. */
  look: BulletinLook;
  /** The state in words, which a reader without the colour reads. */
  words: string;
};

/**
 * A state in the view's one spelling: the library `Badge` in the state's tone, with its glyph and its word, so a state
 * is never colour alone (MAN-578). Phrasing content (`as="span"`), so it stands inside a row that is itself a button.
 *
 * Used by the carrier-bulletins module's `CarrierRow`, `CarrierPages`, `PageRow`, `PageScreen` and `JudgedList`, which
 * each draw a carrier's standing, a page's state or a rule's verdict and must not each spell a pill of their own.
 */
export function StateBadge({ look, words }: StateBadgeProps) {
  const Icon = look.icon;
  return (
    <Badge as="span" tone={look.tone} className="max-w-full flex-none gap-1.5 whitespace-nowrap">
      <Icon className="size-3.5 flex-none" aria-hidden="true" />
      <span className="truncate">{words}</span>
    </Badge>
  );
}
