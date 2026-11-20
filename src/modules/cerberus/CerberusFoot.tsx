import { BookOpen, CalendarClock, CloudUpload, History, Map as MapIcon, Newspaper, Plus, Radar } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { CerberusView } from '@/shared/types';
import { Button, Tabs } from '@/shared/ui';

/** The faces in the strip's old order, each with its name and its mark. */
const FACES = [
  { id: 'fleet', labelKey: 'cerberus.fleet.tabs.fleet', icon: Radar },
  { id: 'catalog', labelKey: 'cerberus.catalog.tab', icon: BookOpen },
  { id: 'history', labelKey: 'cerberus.fleet.tabs.history', icon: History },
  { id: 'tours', labelKey: 'cerberus.tours.tab', icon: MapIcon },
  { id: 'bulletins', labelKey: 'cerberus.bulletins.tab', icon: Newspaper },
  { id: 'uploads', labelKey: 'cerberus.uploads.tab', icon: CloudUpload },
  { id: 'scheduling', labelKey: 'cerberus.scheduling.tab', icon: CalendarClock },
] as const satisfies ReadonlyArray<{ id: CerberusView; labelKey: string; icon: unknown }>;

type CerberusFootProps = {
  face: CerberusView;
  onFace: (face: CerberusView) => void;
  /** The checks that need a person, counted on the Fleet face while it is not the one shown. */
  needs: number;
  /** Enroll a node: the plus at the foot of the fleet. Absent while there is no fleet to enroll into. */
  onEnroll?: () => void;
  /** The instrument, docked: drawn at the foot's start while another face is the work, and a press there is the way back to it. */
  docked: ReactNode;
};

/**
 * THE FOOT OF CERBERUS: the docked instrument at the start while another face is the work above (still live: a machine that comes to
 * need you still turns the accent there, and a press on it brings the fleet back), and in the middle the seven faces (the old strip's
 * names, in its order) with, on the fleet, the plus that enrolls a node (its mark alone: the word is its title and its name).
 *
 * Each face is its mark and its word at a desk and its mark alone below the large breakpoint, where seven words do not fit; the word
 * stays its name, so a face is still found by it. The Fleet face counts the checks that need a person, in the warn tone, while
 * another face is shown. The docked instrument steps aside on a phone, where the Fleet face is the way back. Drawn by the panel
 * (`CerberusPanel`).
 */
export function CerberusFoot({ face, onFace, needs, onEnroll, docked }: CerberusFootProps) {
  const { t } = useTranslation();
  const enroll = t('cerberus.header.enroll');

  return (
    <footer data-cerberus-foot="" className="grid h-[72px] flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 pb-safe-area-inset-bottom md:h-[100px] md:gap-3 md:px-7">
      <div className="flex min-w-0 items-center">
        {face !== 'fleet' && (
          <button
            type="button"
            data-cerberus-docked=""
            aria-label={t('cerberus.fleet.tabs.fleet')}
            title={t('cerberus.fleet.tabs.fleet')}
            onClick={() => onFace('fleet')}
            className="hidden size-[84px] flex-none rounded-full outline-none transition-transform duration-150 hover:scale-[1.04] focus-visible:ring-1 focus-visible:ring-ring md:block"
          >
            {/* The instrument takes no press of its own here: the button round it is the press. */}
            <span className="pointer-events-none block size-full">{docked}</span>
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {/* Under a finger each face is a 44 px press, its mark alone. */}
        <div className="min-w-0 finger:[&_[role=tab]]:min-h-11 finger:[&_[role=tab]]:min-w-11 finger:[&_[role=tab]]:px-2 max-lg:[&_[role=tab]]:px-3">
          <Tabs
            variant="segmented"
            ariaLabel={t('tabs.cerberus')}
            active={face}
            onChange={(id) => {
              const next = FACES.find((entry) => entry.id === id);
              if (next) onFace(next.id);
            }}
            tabs={FACES.map((entry) => ({
              id: entry.id,
              label: t(entry.labelKey),
              icon: entry.icon,
              ...(entry.id === 'fleet' && face !== 'fleet' && needs > 0
                ? { count: needs, attention: t('cerberus.fleet.bar.needs', { count: needs }) }
                : {}),
            }))}
          />
        </div>
        {face === 'fleet' && onEnroll && (
          <Button variant="outline" size="icon" data-cerberus-enroll-foot="" aria-label={enroll} title={enroll} onClick={onEnroll} className="size-9 shrink-0 finger:size-11">
            <Plus aria-hidden="true" />
          </Button>
        )}
      </div>
    </footer>
  );
}
