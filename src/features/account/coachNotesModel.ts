/**
 * "Lo que tu coach sabe de ti": `profile.coachNotes` shown and edited as one
 * fact per line (pure). The coach appends lines too (backend keeps ≤ 2000 chars).
 */

export const COACH_NOTES_MAX = 2000;
export const COACH_NOTE_MAX = 200;

/** A sentence end followed by a new sentence ("…14 h. Juego…"): older notes were one paragraph. */
const SENTENCE_BREAK = /([.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/g;

/** Lines of the notes (one fact per line or sentence), trimmed, without bullets or empty lines. */
export function noteLines(notes: string | null | undefined): string[] {
  return (notes ?? '')
    .replace(SENTENCE_BREAK, '$1\n')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•*·]\s*/, '').trim())
    .filter(Boolean);
}

/** Lines back to the stored text (null when empty). */
export function joinNoteLines(lines: readonly string[]): string | null {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  return clean.length ? clean.join('\n') : null;
}

export function noteError(text: string, lines: readonly string[], editingIndex: number | null = null): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'Escribe algo';
  if (trimmed.length > COACH_NOTE_MAX) return `Máximo ${COACH_NOTE_MAX} caracteres`;
  const others = lines.filter((_, i) => i !== editingIndex);
  if (others.some((l) => l.toLowerCase() === trimmed.toLowerCase())) return 'Tu coach ya lo sabe';
  const total = (joinNoteLines([...others, trimmed]) ?? '').length;
  if (total > COACH_NOTES_MAX) return 'Hay demasiadas notas: borra alguna antigua';
  return null;
}

export function addNote(lines: readonly string[], text: string): string[] {
  return [...lines, text.trim()];
}

export function editNote(lines: readonly string[], index: number, text: string): string[] {
  return lines.map((line, i) => (i === index ? text.trim() : line));
}

export function removeNote(lines: readonly string[], index: number): string[] {
  return lines.filter((_, i) => i !== index);
}
