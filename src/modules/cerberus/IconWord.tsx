import type { LucideIcon } from 'lucide-react';

/**
 * A worded button's face as the house draws it: its mark and its word at a desk, its mark alone under a finger, where the button is a
 * 44 px square (`finger:size-11 finger:px-0` on the button) and the word stays its name and its title, which the button carries.
 *
 * Used by the Cerberus screen's worded buttons: the fleet's and a machine's openings, a need, a fix, the check sheet, History, the
 * catalog and the banner.
 */
export function IconWord({ icon: Icon, word }: { icon: LucideIcon; word: string }) {
  return (
    <>
      <Icon aria-hidden="true" />
      <span className="finger:hidden">{word}</span>
    </>
  );
}
