/** Local inline links/images and reference definitions in maintained guidance.
 * Fragments are not filesystem paths; external schemes are outside this check. */
export function markdownLocalTargets(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, "");
  const patterns = [
    /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    /^\s{0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|(\S+))/gm,
  ];
  const targets = new Set<string>();
  for (const pattern of patterns) {
    for (const match of prose.matchAll(pattern)) {
      const raw = match[1] ?? match[2];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
      const local = raw.split(/[?#]/, 1)[0];
      if (!local) continue;
      try {
        targets.add(decodeURIComponent(local));
      } catch {
        targets.add(local); // Malformed encoding still fails an existence check.
      }
    }
  }
  return [...targets];
}
