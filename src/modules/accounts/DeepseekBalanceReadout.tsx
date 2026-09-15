import { cn } from '@/shared/utils';
import type { DeepseekBalance } from '@/shared/types';

/**
 * The vendor's currency codes we can draw as a symbol. Anything else keeps its code beside the
 * figure — `1,234.50 SEK` — because a guessed symbol is a wrong amount on a screen about money.
 */
const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', CNY: '¥', EUR: '€', GBP: '£' };

/** The server's word for `bad-response`, named once because `readOut` answers a blank amount with it too. */
const UNREADABLE_IN_WORDS = 'DeepSeek answered with something this app could not read';

/**
 * The server's five words for a balance it could not read, in the app's.
 *
 * Unlike the usage meters — whose `pending` is a reading in flight rather than a fault — every one
 * of these is an absence, so all five draw the same em-dash and differ only in the sentence under
 * it. The words are OUR server's (`deepseek.service.ts`), which is why an unrecognised one is
 * quoted rather than translated: it means this client and that server disagree, and that is worth
 * seeing rather than smoothing over.
 */
const UNKNOWN_REASONS: Record<string, string> = {
  unconfigured: 'no DeepSeek API key is set on this server',
  auth: 'DeepSeek refused the API key this server holds',
  timeout: 'DeepSeek did not answer in time',
  unreachable: 'DeepSeek could not be reached',
  'bad-response': UNREADABLE_IN_WORDS,
};

/**
 * The reason in words, for a word this app did not expect of the server either.
 *
 * `unknown` rather than `string` on purpose: a body that reached this component without being the
 * contract would otherwise print `(undefined)` in an accessible name, which reads as a bug in this
 * app rather than as the unknown it is. A missing word is its own sentence.
 */
function unknownReasonInWords(reason: unknown): string {
  if (typeof reason !== 'string') return 'the balance could not be read';
  return UNKNOWN_REASONS[reason] ?? `the balance could not be read (${reason})`;
}

/** A plain decimal as a vendor writes money: digits, an optional fraction, an optional sign. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Past this many integer digits a float no longer holds the amount exactly, so the string is drawn as it arrived. */
const MAX_EXACT_INTEGER_DIGITS = 15;

/**
 * The figure as a person reads money, from the vendor's own decimal string.
 *
 * `total` is never arithmetic here beyond formatting, and only a plain decimal takes even that much:
 * the vendor's string is parsed to place a thousands separator and two decimals, and ANY other
 * string — `1e3`, `0x10`, a word — is drawn exactly as it arrived. The float ceiling is the second
 * half of the same rule: `"12345678901234567890.99"` through a `Number` prints
 * `$12,345,678,901,234,567,000.00`, so past fifteen integer digits the string is drawn verbatim too.
 * A balance is the one number on this screen that must never be invented.
 *
 * A BLANK amount has no figure at all, and that is a `null` rather than an empty string: `Number("")`
 * is `0`, so a blank would otherwise draw as a confident `$0.00` on the one screen where that is a
 * lie about money. The server refuses blanks (`isReadableEntry`); this is the second lock on the
 * same door, and it says "nothing here" in the type rather than in a string the caller must test.
 */
function moneyInWords(currency: string, total: string): string | null {
  const amount = total.trim();
  if (amount.length === 0) return null;

  const integerDigits = amount.replace(/^-/, '').split('.')[0]?.length ?? 0;
  const exact = DECIMAL.test(amount) && integerDigits <= MAX_EXACT_INTEGER_DIGITS;
  const figure = exact
    ? Number(amount).toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount;
  const code = currency.trim().toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${figure}` : `${figure} ${code}`;
}

/** When the reading was taken, on the reader's own clock — the fact that keeps a stale figure from looking fresh. */
function readAtInWords(checkedAt: number): string {
  return new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The em-dash that stands for every unknown — never `$0.00`, which is a reading. */
const NO_FIGURE = '—';

type Readout = {
  /** The figure, or `null` when the answer carries no amount — the caller draws `NO_FIGURE` for it. */
  figure: string | null;
  /** What the reading is, in one sentence: the accessible name and the hover text, so the row can abbreviate without the meaning being lost. */
  sentence: string;
  /** The line under the figure in the panel: what needs explaining, and failing that, when the reading was taken. */
  note: string | null;
};

/**
 * The ONE reading, in the three forms this component draws it.
 *
 * Computed together rather than by three functions over the same body, because the two registers
 * are the same reading: a figure of `—` standing under a sentence that says `$ left` is the one
 * disagreement this component exists to make impossible — and it is not hypothetical, it is what
 * a blank amount drew before this was one function.
 */
function readOut(balance: DeepseekBalance | null): Readout {
  if (!balance) return { figure: null, sentence: 'DeepSeek balance — not read yet', note: null };

  if (!balance.reachable) {
    const reason = unknownReasonInWords(balance.reason);
    return { figure: null, sentence: `DeepSeek balance — unknown: ${reason}.`, note: `Balance unknown — ${reason}.` };
  }

  if (!balance.available) {
    const sentence = 'DeepSeek reports this account is not available for requests.';
    return { figure: moneyInWords(balance.currency, balance.total), sentence, note: sentence };
  }

  const figure = moneyInWords(balance.currency, balance.total);
  // A blank amount is a reading of NOTHING, not a reading of zero — and it is the server's own lock
  // failing rather than a shape the vendor sends. It is answered in the server's word for an answer
  // this app could not read, because that is what it is; inventing a figure here is the one thing
  // this screen must never do.
  if (!figure) {
    return {
      figure: null,
      sentence: `DeepSeek balance — unknown: ${UNREADABLE_IN_WORDS}.`,
      note: `Balance unknown — ${UNREADABLE_IN_WORDS}.`,
    };
  }

  const readAt = readAtInWords(balance.checkedAt);
  // A reading with nothing to explain still says WHEN it was taken. A healthy figure is not
  // self-explanatory about its age: the panel is where someone checks the money after something
  // stopped, and a frozen tab would otherwise hold a five-minute-old number that looks fresh — and
  // a read the client's own floor skipped (see `useDeepseekBalance`) shows as its age, not as a
  // figure that merely looks new.
  return { figure, sentence: `DeepSeek balance — ${figure} left, read at ${readAt}.`, note: `Read at ${readAt}` };
}

type DeepseekBalanceReadoutProps = {
  /** The last reading the server answered with, or `null` while none has been asked for. */
  balance: DeepseekBalance | null;
  /**
   * `stacked` is the panel's register: label, figure and a line of words under it.
   * `inline` is the one-line form for the sidebar's account row, where the figure rides under the
   * account name beside the usage meters and there is no room for the sentence.
   */
  variant?: 'stacked' | 'inline';
};

/**
 * The money left on this host's DeepSeek account.
 * Used by the accounts module twice: `AccountFooterRow` draws the inline register under the
 * account name, and `AccountPopover` draws the stacked one in the panel. Both read the ONE
 * reading `useDeepseekBalance` holds, so the two registers can never disagree.
 *
 * Deliberately NOT a Meter. Every other reading on this surface is a share of a limit, and the
 * Meter's whole business is the bar that share is drawn on — but a balance has no limit to be a
 * share OF, and a bar over money would have to invent the ceiling it is measured against. So this
 * composes the same type register the Meter's stacked form uses — label left, figure right, a
 * faint line under it — and draws no bar at all.
 */
export function DeepseekBalanceReadout({ balance, variant = 'stacked' }: DeepseekBalanceReadoutProps) {
  const { figure, sentence, note } = readOut(balance);
  // An em-dash is an unknown, and every unknown is drawn in the faint ink — including a blank
  // amount, which is a reading of nothing rather than a quiet zero.
  const known = figure !== null;

  if (variant === 'inline') {
    return (
      <span
        className="flex min-w-0 items-baseline gap-1.5 text-xs"
        title={sentence}
        aria-label={sentence}
      >
        <span className="flex-none text-ink-faint">DeepSeek</span>
        <span className={cn('truncate tabular-nums', known ? 'text-muted-foreground' : 'text-ink-faint')}>
          {figure ?? NO_FIGURE}
        </span>
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-foreground">DeepSeek balance</span>
        <span className={cn('ml-auto text-[12.5px] tabular-nums', known ? 'text-muted-foreground' : 'text-ink-faint')}>
          {figure ?? NO_FIGURE}
        </span>
      </div>
      {note && <span className="text-xs leading-relaxed text-ink-faint">{note}</span>}
    </div>
  );
}
