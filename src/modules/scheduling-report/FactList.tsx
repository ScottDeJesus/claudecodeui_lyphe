import { Fragment } from 'react';

/** One fact of a sheet's list: its label, and its value as parts, each held whole when the line breaks. `mono` sets a value that is a code in the mono face. */
export type Fact = { label: string; parts: string[]; mono?: boolean };

/**
 * A SHEET'S FACTS: label and value, two columns. The label column is one fixed width, wide enough for the longest label
 * of any of the three lists, so the values of the head, of What Restorly offered and of What was chosen start on one line
 * down the sheet. Each value is its parts joined by a middle dot; a part is held whole, so a narrow sheet breaks a fact
 * between parts ("· 16 d ago" on its own line) and never inside one, while a lone part may break where it must (a long
 * customer name).
 *
 * Used by this module's `EntrySheetHead`, `EntryOffered` and `EntryChosen`: the three places the sheet says facts
 * rather than sentences, so they are one drawing.
 */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="m-0 grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {facts.map(({ label, parts, mono }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={mono ? 'm-0 min-w-0 break-words font-mono text-xs leading-[1.65] text-foreground' : 'm-0 min-w-0 break-words text-foreground'}>
            {parts.map((part, index) => (
              <Fragment key={part}>
                {index > 0 && ' '}
                <span className={parts.length > 1 ? 'inline-block max-w-full' : undefined}>{index < parts.length - 1 ? `${part} ·` : part}</span>
              </Fragment>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
