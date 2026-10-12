import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useEnrollmentStatus } from '@/modules/cerberus/hooks/useEnrollmentStatus';
import { EnrollInstall, EnrollRefusal } from '@/modules/cerberus/modals/EnrollInstall';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import { askForCommand } from '@/modules/cerberus/utils/enrollAsk';
import type { CerberusEnrollment, CerberusOverview } from '@/shared/cerberus-types';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { CerberusEnrollRefusal } from '@/shared/types';
import { Button, DialogFrame, Field, Input, Steps } from '@/shared/ui';
import { copyTextToClipboard } from '@/shared/utils';

/** The server's node grammar (`NODE_ID_PATTERN`) allows 32 characters; the field stops there as it is typed. */
const NAME_MAX = 32;

/** The server's limit on a description (`MAX_LABEL_LENGTH`), met as it is typed. */
const DESC_MAX = 200;

/** What the first step says while the overview reports the warden gateway unbound, before anyone asks. */
const NOT_LISTENING: CerberusEnrollRefusal = { kind: 'notListening' };

/** How long the third ✓ is on screen before "It said hello" replaces the install step: long enough to be seen landing. */
const HELLO_HOLD_MS = 1_200;

/** How long Copy says "✓ Copied" before it says Copy again. */
const COPIED_MS = 2_000;

/**
 * The name offered first: the first `node-N` the fleet does not hold, counting up from N = the number of
 * nodes it has — center and eis1 offer node-2, not node-1, the way the prototype counts. `node-1` while no
 * overview has been read, when nothing is known to be taken yet.
 */
function suggestName(overview: CerberusOverview | null): string {
  const held = new Set<string>(overview?.nodes.map((node) => node.id));
  let count = Math.max(1, overview?.nodes.length ?? 0);
  while (held.has(`node-${count}`)) count += 1;
  return `node-${count}`;
}

type EnrollDialogProps = {
  /** Whether the dialog is up. Closed, nothing of it is mounted, so it opens clean every time. */
  open: boolean;
  /** Cancel, Done, the ✕, Escape and the backdrop. A token already issued still works until it expires. */
  onClose: () => void;
};

/**
 * ENROLL A NODE, in three steps (`design/cerberus/Cerberus Tab.dc.html` :595-643): Name it · Install ·
 * Say hello.
 *
 * 1. NAME IT: what a node is; the name, offered as the first free `node-N`, kept to the server's grammar
 *    as it is typed and said wrong in amber the moment it is blank or taken; what the machine is, which
 *    may stay blank; and "Get the install command". While the overview reports the warden gateway
 *    unbound, the button waits and a warn banner says why before anyone presses it.
 * 2. INSTALL: the command, its token's expiry, and three lines that tick as the machine gets there
 *    (`EnrollInstall`). The third ✓ is held on screen for a moment before the dialog moves on.
 * 3. SAY HELLO: a ✓ that grows in and rings once, "It said *hello*", the node's warden and first
 *    heartbeat, what Fleet shows of it now, and Done.
 *
 * The steps say where the flow stands and are not pressable: there is no going back to rename a node
 * whose token is out. Closing at any step is safe: a token already issued still works until it expires,
 * and the node turns up in Fleet when its warden speaks.
 *
 * For the cerberus module's `CerberusPanel`, which hosts one and opens it from the header's "Enroll a
 * node".
 */
export function EnrollDialog({ open, onClose }: EnrollDialogProps) {
  if (!open) return null;
  return <EnrollFlow onClose={onClose} />;
}

/** The dialog itself, mounted for as long as it is open. */
function EnrollFlow({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const fieldId = useId();
  useReturnFocus();

  const { overview } = useCerberus();
  const hostWindow = useHostWindow();

  // The name as typed, seeded once with the suggestion: the overview moving on while the person types must not
  // rewrite what they are in the middle of.
  const [name, setName] = useState(() => suggestName(overview));
  // What the machine is, as typed under "What it is". Optional: a blank one is not sent.
  const [desc, setDesc] = useState('');
  // The command to run and when its token expires, null until the server issues one: it is what moves the flow
  // from step one to step two. A new command (after an expiry) replaces it.
  const [issued, setIssued] = useState<CerberusEnrollment | null>(null);
  // True while a command is being asked for, the first one or a new one: it holds the form and the button.
  const [issuing, setIssuing] = useState(false);
  // Why the last ask came back without a command, null before one fails and cleared by each ask.
  const [refusal, setRefusal] = useState<CerberusEnrollRefusal | null>(null);
  // The overview reading this dialog last looked at. Essential: a refusal is judged against the readings that
  // arrive after it, so the render that first sees a new one has to know it is new.
  const [lastOverview, setLastOverview] = useState(overview);
  // The name the server last refused as already enrolled. The overview is read on its own clock, so a node
  // enrolled since is known only by this answer; it holds for exactly that name, and typing another clears it.
  const [takenName, setTakenName] = useState<string | null>(null);
  // How far the machine has got, read every 2 s while the install step is open; null until the first answer.
  const status = useEnrollmentStatus(issued);
  // True 1.2 s after the status first carries the warden's first heartbeat, so the third ✓ is seen landing before
  // "It said hello" takes its place.
  const [helloShown, setHelloShown] = useState(false);
  // The moment the last Copy landed, null once its 2 s are up: the button says "✓ Copied" meanwhile. A moment and
  // not a flag, so a second press while it shows is a new value and starts the 2 s over.
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const copied = copiedAt !== null;

  const heardAt = status?.node?.firstHeartbeatAt ?? null;
  useEffect(() => {
    if (heardAt === null) return undefined;
    const hold = window.setTimeout(() => setHelloShown(true), HELLO_HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [heardAt]);
  useEffect(() => {
    if (copiedAt === null) return undefined;
    const hold = window.setTimeout(() => setCopiedAt(null), COPIED_MS);
    return () => window.clearTimeout(hold);
  }, [copiedAt]);

  // A "not listening" answer is true of the moment center gave it. A reading of the overview that arrives after
  // it and says the gateway listens makes it untrue, and the banner goes without another ask. Keyed on the
  // reading and not on the boolean: an answer that lands after the gateway came back is cleared by the next
  // reading, which a flag that never changed would not give.
  if (overview !== lastOverview) {
    setLastOverview(overview);
    if (overview?.gateway.listening && refusal?.kind === 'notListening') setRefusal(null);
  }

  const nameError = name === '' ? 'empty' : overview?.nodes.some((node) => node.id === name) || takenName === name ? 'taken' : null;

  // The server's node grammar as it is typed: lower case, letters, digits and dashes, no dash first.
  const onName = (typed: string) => setName(typed.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, ''));
  const onDesc = setDesc;
  // The first command and a new one are the same ask, for the same name and description. Each answer lands in the
  // one place it is said: the command opens the install step, a taken name is the name field's, anything else a banner.
  const onIssue = () => {
    setIssuing(true);
    setRefusal(null);
    void askForCommand(name, desc.trim()).then((answer) => {
      setIssuing(false);
      if (answer.kind === 'issued') {
        setIssued(answer.enrollment);
        setCopiedAt(null);
      } else if (answer.kind === 'refused') {
        setRefusal(answer.refusal);
      } else if (issued === null) {
        setTakenName(name);
      } else {
        // A new command, asked for from the install step, where the name field is not in view.
        setRefusal({ kind: 'refused', sentence: answer.sentence });
      }
    });
  };
  const onCopy = () => {
    if (issued === null) return;
    void copyTextToClipboard(issued.command, hostWindow).then((landed) => {
      if (landed) setCopiedAt(Date.now());
    });
  };
  const onReissue = onIssue;

  const gatewayDown = overview !== null && !overview.gateway.listening;
  const node = status?.node ?? null;
  const helloAt = node?.firstHeartbeatAt ?? null;
  const step = issued === null ? 'name' : helloAt !== null && helloShown ? 'hello' : 'install';
  const stepNames = [t('cerberus.enroll.steps.name'), t('cerberus.enroll.steps.install'), t('cerberus.enroll.steps.hello')];
  const canIssue = nameError === null && !gatewayDown && !issuing;
  const problem = refusal ?? (gatewayDown ? NOT_LISTENING : null);

  return (
    <DialogFrame size="lg" data-cerberus-dialog="enroll" title={t('cerberus.enroll.title')} accent={{ words: t('cerberus.enroll.titleAccent') }} onDismiss={onClose}>
      <div className="flex flex-col gap-5">
        {/* Past the last step once it said hello, so all three wear their ✓. */}
        <Steps steps={stepNames} current={step === 'name' ? 0 : step === 'install' ? 1 : stepNames.length} />

        {step === 'name' && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canIssue) onIssue();
            }}
          >
            <p className="text-sm leading-[1.6] text-secondary-foreground">{t('cerberus.enroll.intro')}</p>
            <Field
              label={t('cerberus.enroll.name')}
              htmlFor={`${fieldId}-name`}
              helper={t('cerberus.enroll.nameHelper')}
              error={nameError === 'empty' ? t('cerberus.enroll.nameEmpty') : nameError === 'taken' ? t('cerberus.enroll.nameTaken', { name }) : undefined}
            >
              <Input
                id={`${fieldId}-name`}
                value={name}
                maxLength={NAME_MAX}
                invalid={nameError !== null}
                readOnly={issuing}
                aria-required="true"
                aria-describedby={nameError === null ? `${fieldId}-name-helper` : undefined}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => onName(event.target.value)}
              />
            </Field>
            <Field label={t('cerberus.enroll.desc')} htmlFor={`${fieldId}-desc`} helper={t('cerberus.enroll.descHelper')}>
              <Input
                id={`${fieldId}-desc`}
                value={desc}
                maxLength={DESC_MAX}
                readOnly={issuing}
                placeholder={t('cerberus.enroll.descPlaceholder')}
                aria-describedby={`${fieldId}-desc-helper`}
                autoComplete="off"
                onChange={(event) => onDesc(event.target.value)}
              />
            </Field>
            {problem !== null && <EnrollRefusal refusal={problem} />}
            <div className="mt-1.5 flex flex-wrap justify-end gap-3">
              <Button type="button" variant="outline" className="max-md:h-11" onClick={onClose}>
                {t('cerberus.enroll.cancel')}
              </Button>
              {/* Never `disabled`: a disabled button gives up the focus it holds, and the 409 that says the name
                  is taken turns `nameError` on under the very press that is holding it. A name that cannot be
                  sent or a gateway that is down is `aria-disabled`, and the ask in flight is `busy`; either
                  way the button refuses the press itself and keeps its place in the tab order. */}
              <Button type="submit" className="max-md:h-11" aria-disabled={nameError !== null || gatewayDown} busy={issuing}>
                {t('cerberus.enroll.getCommand')}
              </Button>
            </div>
          </form>
        )}

        {step === 'install' && issued !== null && (
          <EnrollInstall
            key={issued.token}
            issued={issued}
            status={status}
            copied={copied}
            issuing={issuing}
            refusal={refusal}
            onCopy={onCopy}
            onReissue={onReissue}
          />
        )}

        {step === 'hello' && issued !== null && node !== null && helloAt !== null && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              {/* The prototype's arrival: the ✓ grows in on the spring, then rings once in Verve's own halo. */}
              <span
                aria-hidden
                data-tone="positive"
                className="flex size-[34px] flex-none items-center justify-center rounded-full bg-tone-soft text-[15px] text-tone-ink motion-safe:animate-[cerberus-check_.6s_.1s_theme(transitionTimingFunction.spring)_both,vv-ring_1.4s_.5s_ease-out_1]"
              >
                ✓
              </span>
              <h3 className="m-0 font-serif text-2xl font-normal leading-tight text-foreground motion-safe:animate-shape-rise">
                {t('cerberus.enroll.helloLead')} <em className="italic text-accent-ink">{t('cerberus.enroll.helloAccent')}</em>
              </h3>
            </div>
            <p className="text-sm text-secondary-foreground [overflow-wrap:anywhere]">
              {/* The install's enroll step writes the warden's version with the node, before any heartbeat, so
                  no hello arrives without one; a null is passed through as the fleet's warden line does. */}
              {t('cerberus.enroll.done', { name: issued.name, version: node.wardenVersion ?? '', time: hms(helloAt) })}
            </p>
            <p className="text-[13px] text-muted-foreground">{t('cerberus.enroll.inFleet')}</p>
            <div className="mt-2.5 flex justify-end">
              <Button type="button" autoFocus className="max-md:h-11" onClick={onClose}>
                {t('cerberus.enroll.finish')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </DialogFrame>
  );
}
