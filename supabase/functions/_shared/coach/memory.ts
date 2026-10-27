/**
 * Coach memory: short, durable facts or preferences the athlete states
 * ("Prefiere nadar por la mañana") appended to `profiles.coach_notes`, one per
 * line prefixed "- ", deduplicated case- and accent-insensitively. Existing
 * lines are NEVER removed or rewritten (they may be the athlete's own notes):
 * a new fact that would push the notes over the DB limit (4000) is skipped.
 */

export const MAX_MEMORY_ITEMS = 3;
export const MAX_MEMORY_CHARS = 140;
/** Same limit as the `profiles.coach_notes` check constraint. */
export const MAX_COACH_NOTES_CHARS = 4000;

const BULLET = '- ';

/** Comparison key: no bullet, no trailing punctuation, collapsed spaces, lower case, no accents. */
export function memoryKey(line: string): string {
  return line
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/[.;,!\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Model output → at most 3 clean, distinct facts of ≤ 140 chars (longer or empty ones are dropped). */
export function normalizeMemory(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const text = item.replace(/^\s*[-*•]\s*/, '').replace(/\s+/g, ' ').trim();
    const key = memoryKey(text);
    if (!text || text.length > MAX_MEMORY_CHARS || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === MAX_MEMORY_ITEMS) break;
  }
  return out;
}

export interface MergedNotes {
  /** New coach_notes text, or null when nothing changes. */
  notes: string | null;
  /** Facts appended now. */
  added: string[];
  /** Facts that were already in the notes. */
  known: string[];
  /** Facts left out because the notes are full (nothing is ever evicted). */
  skipped: string[];
}

/** Appends new facts to the athlete's notes without touching the existing lines (pure). */
export function mergeCoachNotes(current: string | null, memory: readonly string[], max = MAX_COACH_NOTES_CHARS): MergedNotes {
  const base = (current ?? '').replace(/\s+$/, '');
  const known = new Set(base.split(/\r?\n/).map(memoryKey).filter(Boolean));
  const result = normalizeMemory(memory).reduce<{ text: string; added: string[]; known: string[]; skipped: string[] }>(
    (acc, fact) => {
      const key = memoryKey(fact);
      if (known.has(key)) return { ...acc, known: [...acc.known, fact] };
      const next = acc.text ? `${acc.text}\n${BULLET}${fact}` : `${BULLET}${fact}`;
      if (next.length > max) return { ...acc, skipped: [...acc.skipped, fact] };
      known.add(key);
      return { ...acc, text: next, added: [...acc.added, fact] };
    },
    { text: base, added: [], known: [], skipped: [] },
  );
  return { notes: result.added.length ? result.text : null, added: result.added, known: result.known, skipped: result.skipped };
}
