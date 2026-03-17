const SYGNATURA_RE = /^\s*(?:KIO\s+)?(\d{1,5}\s*\/\s*\d{2,4})\s*$/i;

/**
 * If the entire query is a case reference (e.g. "KIO 1243/17", "1243/17"),
 * returns the normalized form "KIO 1243/17". Otherwise returns null.
 */
export function parseSygnatura(query: string): string | null {
  const m = query.match(SYGNATURA_RE);
  if (!m) return null;
  const num = m[1].replace(/\s*\/\s*/, "/");
  return `KIO ${num}`;
}
