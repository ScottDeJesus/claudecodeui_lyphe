import { useEffect } from 'react';

import { useCompanion } from '@/modules/companion';

/**
 * The station is her home, so it holds her floor: the page she acts on, and the one that plays her voice. It takes the floor
 * as it mounts and whenever its window gains focus — the provider's own `setOpen(true)`, the same act that opening her
 * panel is — so an alert she speaks unasked plays where he keeps her. The workspace takes the floor back by its own acts
 * (typing to her, opening her panel); nothing here holds it against them.
 *
 * Used by `StationRoute`, once, inside her provider.
 */
export function useTakeHerFloor(): void {
  const { setOpen } = useCompanion();

  useEffect(() => {
    setOpen(true);
    const take = () => setOpen(true);
    window.addEventListener('focus', take);
    return () => window.removeEventListener('focus', take);
  }, [setOpen]);
}
