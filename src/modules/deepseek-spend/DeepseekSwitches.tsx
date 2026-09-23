import { useTranslation } from 'react-i18next';

import { useDeepSeekFlashSwitch } from '@/shared/hooks/useDeepSeekFlashSwitch';
import { useHealModelSwitch } from '@/shared/hooks/useHealModelSwitch';
import { useSwarmSwitch } from '@/shared/hooks/useSwarmSwitch';
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
 * One hook reading as the row draws it. A switch with no answer is `unreadable`, never `off`: the
 * hooks report "could not ask" as a `null` position or an `unreadable` flag, and neither is the same
 * as a switch the server read as off.
 */
function mirrorOf(on: boolean | null, unreadable: boolean, detail: string | null = null): Mirror {
  if (unreadable || on === null) return { state: 'unreadable', detail };
  return { state: on ? 'on' : 'off', detail };
}

/**
 * Used by DeepseekUsagePanel as its fifth block: the three switches that route work to DeepSeek,
 * MIRRORED — each a word on a toned badge, never a toggle, because a toggle that looks disabled still
 * invites a press and this view changes nothing. The caption names where each one IS changed:
 * Settings for the chat and swarm switches, Heal for the heal model. An unreadable switch is its own
 * word in amber, not a guess at off.
 */
export function DeepseekSwitches() {
  const { t } = useTranslation();
  // The three switches' own readers, the ones Settings, the composer and Heal compose. Only the
  // positions are taken: no setter and no save is in reach from this view, so no press here can flip
  // anything. Each row is a statement of where the switch IS, not a control.
  const chat = useDeepSeekFlashSwitch();
  const heal = useHealModelSwitch();
  const swarm = useSwarmSwitch();
  const mirrors: Mirrors = {
    chat: mirrorOf(chat.enabled, chat.unreadable),
    // The heal switch's two sides are the words `deepseek` and `claude`, so the detail is the side
    // itself and the row reads as "on · deepseek" rather than an unlabelled badge.
    heal: mirrorOf(heal.position === null ? null : heal.position === 'deepseek', heal.unreadable, heal.position),
    // `lanes` is a ceiling or none at all; the ceiling rides the row as digits, `null` leaves the
    // row's own "no lane ceiling" line to say it.
    swarm: mirrorOf(swarm.enabled, swarm.unreadable, swarm.lanes === null ? null : String(swarm.lanes)),
  };
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
