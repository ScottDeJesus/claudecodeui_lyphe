/**
 * Two letters for a label nobody wrote initials for.
 *
 * The letters come from the LOCAL PART only — never the domain. Everyone here shares
 * `gmail.com`, so a domain letter says nothing about identity and actively hides it:
 * `scottdejesus@gmail.com` and `sdjesus89@gmail.com` both drew "SG" until this took the
 * domain out. Within the local part the second letter follows the first separator when there
 * is one (`scottdejesus.dev` → SD), and is otherwise the second character (`sdjesus89` → SD).
 *
 * Two addresses can still land on the same pair — that is a property of the addresses, not of
 * this rule: on the live set `scottdejesus.dev` and `sdjesus89` BOTH read SD, one of them the
 * account in use. What keeps that from costing anything is the pair of mitigations every site
 * carries: a different avatar hue per row, and the full label in a `title` on the label beside
 * it (the labels truncate at this width, so the `title` is the only way back to the address).
 * An empty label gets the em-dash the rest of the panel uses for "we do not know", never a
 * blank circle that looks like a person with no name.
 *
 * Module-private to `accounts`, in its own file because both the panel's rows and the footer
 * row draw the same avatar and neither may spell this rule a second time.
 */
export function accountInitials(label: string | null): string {
  const localPart = (label ?? '').split('@')[0] ?? '';
  const words = localPart.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}
