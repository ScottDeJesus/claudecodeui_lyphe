import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { ComposerMenuHeading, ComposerMenuItem } from '@/modules/chat/composer/ComposerMenuPrimitives';
import type { SessionToolsetsState } from '@/modules/chat/hooks/useSessionToolsets';
import type { ToolsetServerOutcome, ToolsetSetView } from '@/shared/toolset-types';

type ComposerToolsetSectionProps = {
  /** The open chat's tool sets, as the hook answers them. Nothing is drawn while its `view` is null. */
  toolsets: SessionToolsetsState;
};

/** Each kind of line the section can say, carried on the line as `data-toolset-line` for a probe to find. */
type SectionLineKind = 'error' | 'node' | 'unreadable' | 'none' | 'trouble' | 'next-message';

/**
 * One line of prose in the section. A note is in the descriptions' muted ink. The menu's faint ink
 * measures 3.34:1 on its surface in light, and the empty registry's note holds the path the operator
 * has to read. A warning is in the warn tone behind the tone's ▲, so it is a shape as well as a
 * colour. `inset` lines the words up with the words of the row above.
 */
function SectionLine({
  kind,
  warn = false,
  inset = false,
  children,
}: {
  kind: SectionLineKind;
  warn?: boolean;
  inset?: boolean;
  children: ReactNode;
}) {
  return (
    <p
      data-toolset-line={kind}
      data-tone={warn ? 'warn' : undefined}
      className={cn(
        'flex gap-1.5 pb-1 pr-2.5 pt-1 text-xs leading-snug',
        inset ? 'pl-9' : 'pl-2.5',
        warn ? 'text-tone-ink' : 'text-muted-foreground',
      )}
    >
      {warn && <span aria-hidden className="shrink-0">▲</span>}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * The servers of a switch that did not come up, one sentence each. `failed` carries the CLI's error and
 * `unconfirmed` the reason no answer came; either may come without one.
 */
function troubleSentences(servers: ToolsetServerOutcome[], t: TFunction): string[] {
  return servers.flatMap((server) => {
    if (server.outcome === 'failed') {
      return [server.detail
        ? t('composer.toolsets.failed', { server: server.name, detail: server.detail, defaultValue: '{{server}} did not connect: {{detail}}' })
        : t('composer.toolsets.failedBare', { server: server.name, defaultValue: '{{server}} did not connect.' })];
    }
    if (server.outcome === 'unconfirmed') {
      return [server.detail
        ? t('composer.toolsets.unconfirmed', { server: server.name, detail: server.detail, defaultValue: '{{server}} could not be confirmed: {{detail}}' })
        : t('composer.toolsets.unconfirmedBare', { server: server.name, defaultValue: '{{server}} could not be confirmed.' })];
    }
    return [];
  });
}

/** The words a switching row says in place of its servers, for as long as its press is out. */
function switchingWords(on: boolean, t: TFunction): string {
  return on
    ? t('composer.toolsets.switchingOff', { defaultValue: 'Switching off…' })
    : t('composer.toolsets.switchingOn', { defaultValue: 'Switching on…' });
}

/**
 * What a set's last switch still says about it: the servers that did not come up, else that it starts
 * with the next message. It speaks only while the set stands where that switch left it, and not while
 * a new press of it is out. A later switch from elsewhere (the model's own `toolset` in Bash) leaves
 * the set on the other side, and the old answer says nothing true about that.
 */
function answerWords(
  name: string,
  on: boolean,
  toolsets: SessionToolsetsState,
  t: TFunction,
): { troubles: string[]; nextMessage: string | null } {
  const result = toolsets.lastResult;
  if (!result || toolsets.pendingSet === name || result.set !== name || result.on !== on) {
    return { troubles: [], nextMessage: null };
  }
  const troubles = troubleSentences(result.servers, t);
  const nextMessage = troubles.length === 0 && result.live === 'next-message'
    ? t('composer.toolsets.nextMessage', { defaultValue: 'Applies from the next message.' })
    : null;
  return { troubles, nextMessage };
}

/**
 * One set: its box and its name, what it is for, the servers it starts, and under it whatever its
 * last switch left to say. That is a server that did not come up, or a start that waits for the next
 * message.
 */
function ToolsetRow({
  set,
  toolsets,
  onPress,
}: {
  set: ToolsetSetView;
  toolsets: SessionToolsetsState;
  onPress: (name: string, on: boolean) => void;
}) {
  const { t } = useTranslation('chat');
  const busy = toolsets.pendingSet === set.name;
  const { troubles, nextMessage } = answerWords(set.name, set.on, toolsets, t);

  return (
    <>
      <ComposerMenuItem
        role="menuitemcheckbox"
        // A name is data: it wraps rather than ending in an ellipsis on a phone.
        label={<span className="whitespace-normal">{set.name}</span>}
        description={(
          <>
            {set.description && <span className="block">{set.description}</span>}
            {/* While its press is out the row says so where its servers stand, one line for one line, so
                it keeps its height and the rows under it stay where they are. */}
            {busy
              ? <span className="block">{switchingWords(set.on, t)}</span>
              : set.servers.length > 0 && <span className="block font-mono text-[11px]">{set.servers.join(', ')}</span>}
          </>
        )}
        isSelected={set.on}
        busy={busy}
        waiting={toolsets.pendingSet !== null && !busy}
        onSelect={() => onPress(set.name, !set.on)}
      />
      {troubles.length > 0 && (
        <SectionLine kind="trouble" warn inset>
          {troubles.map((sentence) => <span key={sentence} className="block">{sentence}</span>)}
        </SectionLine>
      )}
      {nextMessage && <SectionLine kind="next-message" inset>{nextMessage}</SectionLine>}
    </>
  );
}

/**
 * Rendered by chat's ComposerModelMenu as the menu's last group, whenever the open chat's tool-set view
 * has been read. It shows which of the sets this box defines are on for this conversation, and a press
 * switches one on or off with the menu left open.
 *
 * It lives in the model menu, which already holds this conversation's runtime choices. The composer
 * strip's widths are measured to the pixel, and a section adds none. It is drawn in every Claude chat,
 * the empty registry included: that is one note naming the file, so the operator sees where a set is
 * defined on the day the first one is.
 *
 * Nothing here binds a window. It draws inside the menu's own portal, which the menu binds to the host
 * window (MAN-7466).
 */
export function ComposerToolsetSection({ toolsets }: ComposerToolsetSectionProps) {
  const { t } = useTranslation('chat');
  const { view, pendingSet, error } = toolsets;
  if (!view) {
    return null;
  }

  const heading = t('composer.toolsets.heading', { defaultValue: 'Tool sets for this conversation' });
  // One switch at a time. The hook tracks ONE pending set, so a second press while one is out would take
  // the first row's spinner away before its answer came back. So the switching row is `busy` and every
  // other row is `waiting`: each says so, and none takes a press until that one answer lands.
  const press = (name: string, on: boolean) => {
    void toolsets.toggle(name, on);
  };
  const onNode = view.availability === 'node';
  const nothingDefined = !view.registryError && view.sets.length === 0 && view.strays.length === 0;
  const errorWords = error ? t('composer.toolsets.error', { error, defaultValue: 'Not updated: {{error}}' }) : null;
  // The one live region. What a press raises (the hook's error, a server that did not come up, a start
  // that waits for the next message) is drawn as a line where it belongs AND copied here, into a region
  // already in the tree, so a screen reader hears it arrive. A region inserted already holding its words
  // is often skipped. Only the last switch's set can have words, and a node chat draws no rows.
  const lastSet = toolsets.lastResult?.set;
  const answered = onNode ? undefined : view.sets.find((set) => set.name === lastSet);
  const answer = answered ? answerWords(answered.name, answered.on, toolsets, t) : null;
  const announcement = [errorWords, ...(answer?.troubles ?? []), answer?.nextMessage].filter(Boolean).join(' ');

  return (
    // Every line inherits `[overflow-wrap:anywhere]`. A registry path, a node, a set's name and a server's
    // error are data, and any of them can be one unbroken token wider than a phone. Spaces still break
    // first, and only a token with none is cut, so each one wraps whole at any width.
    <div role="group" aria-label={heading} className="min-w-0 [overflow-wrap:anywhere]" data-toolset-section>
      <ComposerMenuHeading>{heading}</ComposerMenuHeading>
      {errorWords && <SectionLine kind="error" warn>{errorWords}</SectionLine>}
      {onNode ? (
        <SectionLine kind="node">
          {t('composer.toolsets.onNode', {
            node: view.node ?? '',
            defaultValue: "This chat runs on {{node}}. Tool sets are this box's own.",
          })}
        </SectionLine>
      ) : (
        <>
          {view.registryError && (
            <SectionLine kind="unreadable" warn>
              {t('composer.toolsets.unreadable', {
                error: view.registryError,
                defaultValue: 'The tool-set file could not be read: {{error}}',
              })}
            </SectionLine>
          )}
          {nothingDefined && (
            <SectionLine kind="none">
              {t('composer.toolsets.none', {
                file: view.registryFile,
                defaultValue: 'No tool sets are defined on this box yet. They live in {{file}}.',
              })}
            </SectionLine>
          )}
          {view.sets.map((set) => (
            <ToolsetRow key={set.name} set={set} toolsets={toolsets} onPress={press} />
          ))}
          {/* A stray is still on for this chat, though the box no longer starts it. It is ticked, because it is on,
              and its words are a warning: it does nothing now, and a set defined again under its name would start in
              this chat without a press. Its press switches it off, after which it is gone from the list. */}
          {view.strays.map((name) => (
            <ComposerMenuItem
              key={`stray:${name}`}
              role="menuitemcheckbox"
              label={(
                <span data-tone="warn" className="flex gap-1.5 whitespace-normal text-tone-ink">
                  <span aria-hidden className="shrink-0">▲</span>
                  <span className="min-w-0">
                    {t('composer.toolsets.stray', { name, defaultValue: '{{name}} — no longer defined on this box' })}
                  </span>
                </span>
              )}
              description={pendingSet === name ? switchingWords(true, t) : undefined}
              isSelected
              busy={pendingSet === name}
              waiting={pendingSet !== null && pendingSet !== name}
              onSelect={() => press(name, false)}
            />
          ))}
        </>
      )}
      <p role="status" className="sr-only" data-toolset-announce>{announcement}</p>
    </div>
  );
}
