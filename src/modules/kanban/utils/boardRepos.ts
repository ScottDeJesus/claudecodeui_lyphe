/** The list with a typed path taken in: unchanged for an empty one or one already listed. */
export function withTypedRepo(repos: string[], typed: string): string[] {
  const path = typed.trim();
  return path.length === 0 || repos.includes(path) ? repos : [...repos, path];
}
