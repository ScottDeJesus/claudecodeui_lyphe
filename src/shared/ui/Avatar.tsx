import { cn } from '@/shared/utils';

type AvatarProps = {
  initials: string;
  /** Picks one of the three identity gradients; any integer works, it wraps. */
  hue?: number;
  size?: number;
  /** The overflow chip in a stack ("+3") and any placeholder that stands for nobody. */
  muted?: boolean;
};

/** The three identity gradients defined in controls.css, indexed by `hue`. */
const HUE_CLASSES = ['', 'vv-avatar--hue1', 'vv-avatar--hue2'];

/**
 * A round initials badge.
 * Used by the accounts module (Phase 13) in three places: the sidebar footer's account row, the
 * same row drawn smaller in the collapsed rail, and each switchable account in the panel — which
 * is the only caller that passes `hue`, one per row, so two rows never read alike.
 *
 * Geometry is inline because `size` is a number the caller chooses; every colour is a class,
 * so a new palette never means editing this file.
 */
export function Avatar({ initials, hue = 0, size = 36, muted = false }: AvatarProps) {
  const hueClass = HUE_CLASSES[((hue % HUE_CLASSES.length) + HUE_CLASSES.length) % HUE_CLASSES.length];

  return (
    <span
      className={cn('vv-avatar inline-flex items-center justify-center', muted ? 'vv-avatar--muted' : hueClass)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}
