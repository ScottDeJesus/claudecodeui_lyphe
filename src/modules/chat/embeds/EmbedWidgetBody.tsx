import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLinkIcon, ListIcon } from 'lucide-react';

import type { EmbedUrlRef } from '@/shared/types';
import { classifyWidgetBody, EmbedUrlFrame, resolveDocSpaceOrigin, resolveEmbedUrl } from '@/modules/widgets';
import { useChatEmbedTargets } from '@/modules/chat/embeds/embedSource';
import { Input, Select } from '@/shared/ui';

/**
 * The Embed widget's body: one live page, beside the transcript, in the gutter.
 *
 * WHAT PUTS A PAGE HERE. Two things, and they are deliberately not the same thing. The CHAT declares
 * an address by writing an embed fence, and every address a chat has declared arrives here through
 * `useChatEmbedTargets` — so "show me the board" is something the model can simply do. The READER
 * picks one from the dropdown — the house's own services are in it before any chat speaks — or types
 * one, which is what makes this a generic view rather than a chat-output viewer: the widget is worth
 * having with no model in the loop at all.
 *
 * THE NEWEST DECLARED ADDRESS WINS, AND A READER'S CHOICE SURVIVES UNTIL THERE IS A NEWER ONE. A
 * widget that ignored new declarations would make the model's fence useless; one that discarded the
 * reader's pick on every re-render would snatch the page away mid-read. So the follow is latched:
 * the newest address is adopted when it CHANGES, and until it changes again whatever the reader
 * chose stands. The latch is compared during render rather than in an effect — React's own
 * derived-state adjustment, the shape `useShapeCollapse` uses — because an effect would paint one
 * frame of the old page first.
 *
 * ONE VALIDATOR, NOT TWO. A typed address is checked by building the fence body it is equivalent to
 * and handing it to `classifyWidgetBody`, the same call the transcript makes. So the field inherits
 * the scheme check, the length ceiling and the title/height repair without restating any of them,
 * and the widget can never accept an address the inline card would have refused. A value with no
 * scheme is retried once as `http://` — the reader typing `myhost:8005` means a host, not a protocol.
 *
 * THE FRAME ITSELF IS `EmbedUrlFrame`, the very component the transcript card draws, with `fill` set
 * because the gutter card owns the height here. Nothing about the sandbox, the origin gate or the
 * loopback rewrite is re-decided in this file; there is one embed frame in this app.
 */

/**
 * The value the dropdown carries for "let me type one", which is not an address and must never be
 * mistaken for one. A sentinel rather than the empty string: `''` is what the Select shows for
 * "nothing chosen yet", and the two states are different — one is a request, the other is a start.
 */
const CUSTOM_OPTION = '\u0000custom';

/**
 * The house's own services, offered in the dropdown before any chat has named one.
 *
 * WHY THERE IS A LIST AT ALL. A bare address field is a blank page: it works, and it asks the reader
 * to remember a host and a port to use the widget at all. The service they actually want is almost
 * always one of the operator's own, and this app already knows where that one is.
 *
 * ARCHPULSE'S ADDRESS IS NOT SPELLED HERE. It comes from `resolveDocSpaceOrigin`, the same resolver
 * the DocSpace embed uses — so the `VITE_DOCSPACE_EMBED_ORIGIN` override moves this entry with it,
 * and the derived default gives the page's OWN hostname, which is the whole reason a reader on
 * Tailscale gets a reachable address and not a loopback one. A hard-coded address here
 * would be a second answer to "where is ArchPulse", wrong the first time either changes.
 *
 * Descent (`:7878`) is deliberately absent: the descent-sunset plan ends with that port dark, and an
 * entry that offers a service being retired is a dead link with a friendly name.
 */
function housePresets(): EmbedUrlRef[] {
  if (typeof window === 'undefined') return [];
  return [{ url: `${resolveDocSpaceOrigin()}/`, title: 'ArchPulse' }];
}
export function EmbedWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const targets = useChatEmbedTargets(sessionId);
  const newest = targets.length > 0 ? targets[targets.length - 1] : null;

  // What the reader picked or typed, and the declared address that was newest when they did. The
  // pair is the latch: a change in `newest` is a fresh declaration and takes the frame back.
  const [chosen, setChosen] = useState<EmbedUrlRef | null>(null);
  const [followed, setFollowed] = useState<string | null>(newest?.url ?? null);
  const [typed, setTyped] = useState('');
  const [rejected, setRejected] = useState(false);
  // Whether the reader has asked to type an address instead of choosing one. ONE ROW, two modes,
  // rather than a dropdown stacked on a field: this widget is 300px wide in a gutter column, and two
  // rows of chrome took a third of the card's inside before the page got any of it. Measured, not
  // guessed — 92px of a 242px body — which is why the row is a mode and not a stack.
  const [typing, setTyping] = useState(false);

  if ((newest?.url ?? null) !== followed) {
    setFollowed(newest?.url ?? null);
    setChosen(null);
  }

  const current = chosen ?? newest;

  // EVERY ADDRESS THE READER CAN GET TO, in the order they would look for one: the house's own
  // services first — there before a chat has said anything, which is what makes the widget usable
  // on its own — then whatever this chat declared, then the one entry that is not an address.
  //
  // Deduplicated on the URL with the CHAT'S entry winning, because a chat that embedded ArchPulse
  // gave it a title of its own ("ArchPulse — DocSpace hub") and that is more use to the reader than
  // the bare preset name. A `current` that is neither — an address the reader typed — is added so
  // the dropdown can show what it is actually drawing rather than falling back to its placeholder.
  const options = useMemo(() => {
    const byUrl = new Map<string, EmbedUrlRef>();
    for (const preset of housePresets()) byUrl.set(preset.url, preset);
    for (const target of targets) byUrl.set(target.url, target);
    if (current && !byUrl.has(current.url)) byUrl.set(current.url, current);
    return [...byUrl.values()];
  }, [targets, current]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = typed.trim();
    if (!raw) return;
    // The bare value first, then the same value given a scheme: `10.0.0.5:8005` parses as a
    // URL whose protocol is `10.0.0.5:`, which the classifier correctly refuses, and which is
    // never what a reader typing a host and a port meant.
    const parsed = readAddress(raw) ?? readAddress(`http://${raw}`);
    if (!parsed) {
      setRejected(true);
      return;
    }
    setRejected(false);
    setTyped('');
    setTyping(false);
    setChosen(parsed);
  };

  return (
    <div data-testid="embed-widget" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/20 px-2 py-1.5">
        {/* THE DROPDOWN IS THE DEFAULT CONTROL, and it is there before any chat has declared an
            address: the house's services are already in it, so the widget is usable the moment it is
            opened. Typing is a mode the list itself offers, as its last entry. */}
        {typing ? (
          <form onSubmit={submit} className="min-w-0 flex-1">
            <Input
              value={typed}
              onChange={(event) => { setTyped(event.target.value); setRejected(false); }}
              placeholder={t('gutters.embed.placeholder')}
              aria-label={t('gutters.embed.address')}
              invalid={rejected}
              autoFocus
              className="h-7 text-xs"
            />
          </form>
        ) : (
          <div data-embed-widget-pick className="min-w-0 flex-1">
            <Select
              size="sm"
              ariaLabel={t('gutters.embed.pick')}
              placeholder={t('gutters.embed.choose')}
              value={current?.url ?? ''}
              options={[
                ...options.map((option) => ({ value: option.url, label: option.title ?? option.url })),
                { value: CUSTOM_OPTION, label: t('gutters.embed.custom') },
              ]}
              onChange={(next) => {
                if (next === CUSTOM_OPTION) {
                  setTyping(true);
                  setRejected(false);
                  return;
                }
                const found = options.find((option) => option.url === next);
                if (found) setChosen(found);
              }}
            />
          </div>
        )}
        {/* The way back from typing. Only drawn there: the dropdown carries its own way FORWARD. */}
        {typing ? (
          <button
            type="button"
            data-embed-widget-mode
            onClick={() => { setTyping(false); setRejected(false); }}
            aria-label={t('gutters.embed.pick')}
            title={t('gutters.embed.pick')}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ListIcon aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {/* The way out, on the same terms the transcript card gives it: a page that refuses to be
            framed shows nothing and cannot say so, and this is the reader's recourse. */}
        {current ? (
          <a
            data-embed-widget-open
            // The RESOLVED address, like the frame's own: a link the reader follows lands in their own
            // browser, so a loopback host written by the model would open a tab that fails exactly
            // the way the frame it is rescuing them from does.
            href={resolveEmbedUrl(current.url)}
            target="_blank"
            rel="noopener noreferrer"
            title={t('gutters.embed.open')}
            aria-label={t('gutters.embed.open')}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLinkIcon aria-hidden="true" className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      {rejected ? (
        <p className="shrink-0 px-2 py-1 text-xs text-destructive">{t('gutters.embed.rejected')}</p>
      ) : null}

      <div className="min-h-0 flex-1">
        {current ? (
          // Keyed on the address for the reason every other embed is: a different page must arrive as
          // a NEW element rather than as a reassigned `src`, so a frame navigates once in its life.
          <EmbedUrlFrame key={current.url} url={current.url} title={current.title} framed fill />
        ) : (
          <p className="p-3 text-xs text-muted-foreground">{t('gutters.embed.empty')}</p>
        )}
      </div>
    </div>
  );
}

/** One address, through the app's ONE classifier, or null. Never throws — the input is typed by hand. */
function readAddress(value: string): EmbedUrlRef | null {
  const shape = classifyWidgetBody(JSON.stringify({ kind: 'embed', url: value }));
  return shape.kind === 'embed' ? shape.ref : null;
}
