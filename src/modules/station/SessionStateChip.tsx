import { useTranslation } from 'react-i18next';

import type { StationSessionState } from '@/shared/station-types';
import type { Tone } from '@/shared/types';
import { Badge } from '@/shared/ui';

/**
 * How each state of a chat is said: its tone and its word, and whether its chip is the faint one (an outline, no fill). Working is
 * info, waiting on you warn, idle neutral, asleep neutral and faint. The house's `live` (a process up, nothing running) is "Idle"
 * on the page. Every chip says its state in words, so no state is colour alone (MAN-578).
 */
const STATE_LOOK: Record<StationSessionState, { tone: Tone; faint: boolean; key: string; english: string }> = {
  working: { tone: 'info', faint: false, key: 'station.sessions.state.working', english: 'Working' },
  waiting: { tone: 'warn', faint: false, key: 'station.sessions.state.waiting', english: 'Waiting on you' },
  live: { tone: 'neutral', faint: false, key: 'station.sessions.state.idle', english: 'Idle' },
  asleep: { tone: 'neutral', faint: true, key: 'station.sessions.state.asleep', english: 'Asleep' },
};

/**
 * A chat's state chip: the kit's `Badge` in its compact size (a dense row's), toned and worded by the state. A phrasing `<span>`,
 * so it can ride inside a `<button>`. Used by this module's `ChatStage`, which draws the chip on the stage.
 */
export function SessionStateChip({ state }: { state: StationSessionState }) {
  const { t } = useTranslation();
  const look = STATE_LOOK[state];
  return (
    <Badge
      as="span"
      tone={look.tone}
      variant={look.faint ? 'outline' : undefined}
      data-station-session-state={state}
      className="vv-badge--compact shrink-0 whitespace-nowrap"
    >
      {t(look.key, { defaultValue: look.english })}
    </Badge>
  );
}
