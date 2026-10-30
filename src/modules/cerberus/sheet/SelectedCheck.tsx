import { useEffect, useRef, type ReactElement } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DiagnoseButton } from '@/modules/cerberus/DiagnoseButton';
import { StatusPill } from '@/modules/cerberus/StatusMarks';
import { hm, hms, stretchKey } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCheckView, CerberusDiagnosisView } from '@/shared/cerberus-types';
import { Badge, Button } from '@/shared/ui';

type SelectedCheckProps = {
  check: CerberusCheckView;
  /** The label editor while it is open, drawn where the name stands; `null` while it is closed. */
  editor: ReactElement | null;
  /** "Name this check", or the ✎ beside a name: opens the editor. */
  onName: () => void;
  /** Mute, offered while no mute covers the check. Absent, no Mute is drawn: the sheet's host has no Mute dialog to open. */
  onMute?: () => void;
  /** Unmute, beside the note of the mute that covers the check. */
  onUnmute: () => void;
  /** The check's newest diagnosis, or null when it has none. "Diagnose again" reads once there is one, and no button stands while it runs: center takes one diagnosis at a time on a check. */
  diagnosis: CerberusDiagnosisView | null;
  /** Whether the check's own read has answered. Until it has, nobody knows whether the check has a diagnosis, so the button is not drawn rather than drawn with the wrong word. */
  diagnosisRead: boolean;
  /** A diagnosis has just started: reads the check again, so the sheet holds it (and Diagnose's busy look ends on it, not before). Resolves when that read has settled. */
  onDiagnosisStarted: () => Promise<void>;
};

/**
 * THE CHECK THE SHEET SHOWS, the head of everything under it:
 * - its name: the label in the serif display face, or, for a check no one has named, its key in mono.
 *   The editor takes that place while it is open.
 * - its status as a pill with the icon and the word, right against the name: it is what the sheet
 *   was opened for. Then the way to name it, a ✎ to rename a label or "Name this check" for a key,
 *   which is what wraps to the next line on a phone.
 * - the value it reported; "Checked 17:52:10 · every 30 s · by the warden on eis1" (by Cerberus on
 *   this server for the hub's own checks, "No result yet" before the first); and the raw key, which
 *   a check with no label already shows as its name.
 * - the action row: Diagnose ("Diagnose again" once the check has a diagnosis), then Mute (where the sheet's host
 *   offers one), or the mute's note ("Muted until 18:40 · <reason>") with Unmute.
 *
 * When the editor closes it takes focus with it. If focus fell to the page, it comes back to what
 * opened the editor, which after a save is the ✎ that now follows the name.
 *
 * Used by the cerberus module's `CheckSheet`, which wires the callbacks and the editor.
 */
export function SelectedCheck({ check, editor, onName, onMute, onUnmute, diagnosis, diagnosisRead, onDiagnosisStarted }: SelectedCheckProps) {
  const { t } = useTranslation();
  const nameTriggerRef = useRef<HTMLButtonElement>(null);
  const editing = editor !== null;
  const wasEditingRef = useRef(editing);

  useEffect(() => {
    if (wasEditingRef.current && !editing) {
      const active = nameTriggerRef.current?.ownerDocument.activeElement ?? null;
      if (active === null || active === active.ownerDocument.body) nameTriggerRef.current?.focus();
    }
    wasEditingRef.current = editing;
  }, [editing]);

  const stretch = stretchKey(check.every);
  const every = t(stretch.key, { count: stretch.count });
  const hub = check.origin === 'self';
  const checked = check.at === null
    ? t(hub ? 'cerberus.sheet.notCheckedHub' : 'cerberus.sheet.notChecked', { every, node: check.node })
    : t(hub ? 'cerberus.sheet.checkedHub' : 'cerberus.sheet.checked', { time: hms(check.at), every, node: check.node });

  const heading = check.label === null ? (
    <h3 className="m-0 min-w-0 font-mono text-base font-normal text-foreground [overflow-wrap:anywhere]">{check.key}</h3>
  ) : (
    <h3 className="m-0 min-w-0 font-serif text-2xl font-normal leading-[1.15] text-foreground [overflow-wrap:anywhere]">
      {check.label}
    </h3>
  );

  // "Name this check" is a quiet text action, never a filled chip: a second filled pill beside the
  // status (in the accent green) would compete with a refused red or a failing amber for the eye.
  const nameAction = check.label === null ? (
    <Button ref={nameTriggerRef} variant="ghost" size="sm" className="h-8 px-2" onClick={onName}>
      <Pencil aria-hidden />
      {t('cerberus.sheet.nameThis')}
    </Button>
  ) : (
    <Button
      ref={nameTriggerRef}
      variant="ghost"
      size="icon"
      className="h-8 w-8 flex-none text-muted-foreground"
      aria-label={t('cerberus.sheet.rename')}
      title={t('cerberus.sheet.rename')}
      onClick={onName}
    >
      <Pencil aria-hidden />
    </Button>
  );

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {editor ?? heading}
          <StatusPill status={check.status} />
          {editor === null && nameAction}
        </div>
        {check.value !== null && (
          <p className="text-sm text-secondary-foreground [overflow-wrap:anywhere]">{check.value}</p>
        )}
        <p className="text-[12.5px] tabular-nums text-muted-foreground">{checked}</p>
        {/* The raw key, unless it already stands as the name. While the editor is open it is shown
            either way: it is what is being named. */}
        {(check.label !== null || editing) && (
          <p className="font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{check.key}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {diagnosisRead && diagnosis?.status !== 'running' && (
          <DiagnoseButton
            node={check.node}
            checkKey={check.key}
            label={t(diagnosis === null ? 'cerberus.diagnosis.diagnose' : 'cerberus.diagnosis.again')}
            onStarted={onDiagnosisStarted}
          />
        )}
        {check.mute === null ? (
          onMute && (
            <Button variant="ghost" size="sm" onClick={onMute}>
              {t('cerberus.sheet.mute')}
            </Button>
          )
        ) : (
          <>
            {/* The mute is the operator's own note, so it reads in full: a neutral block that wraps,
                not a pill cut short. */}
            <Badge tone="neutral" className="max-w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] leading-snug">
              <span className="[overflow-wrap:anywhere]">
                {t('cerberus.sheet.muteNote', { time: hm(check.mute.until), reason: check.mute.reason })}
              </span>
            </Badge>
            <Button variant="ghost" size="sm" onClick={onUnmute}>
              {t('cerberus.sheet.unmute')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
