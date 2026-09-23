import { useTranslation } from 'react-i18next';

import type { Tone } from '@/shared/types';
import { Badge } from '@/shared/ui';

/**
 * One switch as the view mirrors it: on, off, or a read that failed — never a guessed position.
 * `detail` is the heal switch's model word (`deepseek` / `claude`) and the swarm's lane ceiling as
 * digits, `null` for the swarm meaning NO ceiling; the chat switch carries none.
 */
type Mirror = { state: 'on' | 'off' | 'unreadable'; detail: string | null };
type Mirrors = { chat: Mirror; heal: Mirror; swarm: Mirror };

const STATE_TONE: Record<Mirror['state'], Tone> = { on: 'positive', off: 'neutral', unreadable: 'warn' };
const STATE_GLYPH: Record<Mirror['state'], string> = { on: '✓', off: '·', unreadable: '▲' };

/**
 * Used by DeepseekUsagePanel as its fifth block: the three switches that route work to DeepSeek,
 * MIRRORED — each a word on a toned badge, never a toggle, because a toggle that looks disabled still
 * invites a press and this view changes nothing. The caption names where each one IS changed:
 * Settings for the chat and swarm switches, Heal for the heal model. An unreadable switch is its own
 * word in amber, not a guess at off.
 */
export function DeepseekSwitches() {
  const { t } = useTranslation();
  // FILL: switchMirrors
  const mirrors: Mirrors = { chat: { state: 'on', detail: null }, heal: { state: 'off', detail: 'claude' }, swarm: { state: 'on', detail: '4' } };
  const rows: { key: keyof Mirrors; detail: string | null }[] = [
    { key: 'chat', detail: null },
    { key: 'heal', detail: mirrors.heal.detail },
    {
      key: 'swarm',
      detail: mirrors.swarm.state === 'unreadable' ? null : mirrors.swarm.detail === null
        ? t('deepseekUsage.switches.noCeiling')
        : t('deepseekUsage.switches.lanes', { n: mirrors.swarm.detail }),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border">
        {rows.map((row) => {
          const mirror = mirrors[row.key];
          const tone = STATE_TONE[mirror.state];
          return (
            <li key={row.key} className="flex min-w-0 items-center gap-3 px-3 py-2" data-deepseek-switch={row.key}>
              <span className="min-w-0 flex-1 truncate text-sm">{t(`deepseekUsage.switches.${row.key}`)}</span>
              {row.detail && <span className="font-mono text-xs tabular-nums text-muted-foreground">{row.detail}</span>}
              <Badge as="span" tone={tone} className="text-xs">
                <span aria-hidden="true">{STATE_GLYPH[mirror.state]}</span>&nbsp;{t(`deepseekUsage.switches.${mirror.state}`)}
              </Badge>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('deepseekUsage.switches.caption')}</p>
    </div>
  );
}
