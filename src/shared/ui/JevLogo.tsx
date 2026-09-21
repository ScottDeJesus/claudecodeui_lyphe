import { cn } from '@/shared/utils';

type JevLogoProps = {
  /** Tailwind size classes; the mark is square and cut to a circle whatever the size. */
  className?: string;
};

/**
 * TypeSafe's mark, cut circular, beside the word "Jev".
 * Used by the accounts module's Jev balance readout (both registers) and the settings module's Jev
 * master switch. Decorative: the word next to it already names the thing, so it carries no alt text.
 */
export function JevLogo({ className }: JevLogoProps) {
  return (
    <img
      src="/icons/jev.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('inline-block flex-none rounded-full object-cover', className ?? 'h-3.5 w-3.5')}
    />
  );
}
