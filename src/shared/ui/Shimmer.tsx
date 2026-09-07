import * as React from 'react';

import { cn } from '@/shared/utils';

type ShimmerProps = {
  children: string;
  className?: string;
  as?: React.ElementType;
};

/**
 * Used by the chat module for streaming text and by the shared Reasoning primitive.
 *
 * The gradient it used to spell in its own class string now lives in controls.css, with the
 * rest of the library's paint. `--text` is load-bearing, not decoration: it clips the sweep to
 * the glyphs. Without it the same gradient lands as an opaque band BEHIND live text, which
 * reads as highlighting rather than as waiting, and measured 4.02:1 at the trough in light.
 */
export const Shimmer = React.memo<ShimmerProps>(({ children, className, as: Component = 'span' }) => {
  return (
    <Component className={cn('vv-skeleton vv-skeleton--text inline-block', className)}>
      {children}
    </Component>
  );
});
Shimmer.displayName = 'Shimmer';

