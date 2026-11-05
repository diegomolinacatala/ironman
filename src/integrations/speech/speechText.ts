/**
 * Text prepared for the ear, unit-tested.
 *
 * - `toSpokenText`: what a person would say out loud — no markdown, bullets or emoji, training
 *   shorthand expanded ("Z2" → "zona 2", "45'" → "45 minutos", "4x8'" → "4 por 8 minutos",
 *   "1h30" → "1 hora y 30 minutos", "km/h", "W", "ppm", "FC"), ranges read as "3 a 4".
 * - `splitForSpeech`: sentence-sized pieces for the neural voice. The first piece is short so the
 *   coach starts talking in about a second while the rest is synthesised.
 */

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
/** The `speech` function accepts at most 600 characters per request. */
export const MAX_CHUNK_CHARS = 600;
const DEFAULT_CHUNK_CHARS = 260;
const FIRST_CHUNK_CHARS = 140;

const ZONE_WORD = /\bZ([1-7])\b/g;

function unit(value: string, singular: string, plural: string): string {
  return `${value} ${value === '1' ? singular : plural}`;
}

function expandShorthand(text: string): string {
  return (
    text
      // 1h30, 1h30', 1 h 30 min → "1 hora y 30 minutos"
      .replace(/\b(\d{1,2})\s?h\s?(\d{1,2})(?:\s?(?:min|')(?![a-záéíóú]))?/gi, (_m, h: string, m: string) => `${unit(h, 'hora', 'horas')} y ${unit(String(Number(m)), 'minuto', 'minutos')}`)
      // 4x8' / 6 x 400 m → "4 por 8'"
      .replace(/\b(\d+)\s?[x×]\s?(?=\d)/gi, '$1 por ')
      .replace(ZONE_WORD, 'zona $1')
      .replace(/(\d)\s?km\/h\b/gi, '$1 kilómetros por hora')
      .replace(/\b(\d+(?:[.,]\d+)?)\s?km\b/gi, (_m, n: string) => unit(n, 'kilómetro', 'kilómetros'))
      .replace(/\b(\d+)\s?(?:min|')(?![a-záéíóú'])/gi, (_m, n: string) => unit(n, 'minuto', 'minutos'))
      .replace(/\b(\d+)\s?(?:seg|s|")(?![a-záéíóú])/g, (_m, n: string) => unit(n, 'segundo', 'segundos'))
      .replace(/\b(\d+)\s?h\b/gi, (_m, n: string) => unit(n, 'hora', 'horas'))
      .replace(/\b(\d+)\s?W\b/g, '$1 vatios')
      .replace(/\b(\d+)\s?ppm\b/gi, '$1 pulsaciones')
      .replace(/\bFC\b/g, 'frecuencia cardiaca')
      // 3-4 → 3 a 4 (not dates such as 2026-11-05)
      .replace(/(?<![-–/\d])\b(\d{1,3})\s?[-–]\s?(\d{1,3})\b(?![-–/]\d)/g, '$1 a $2')
      .replace(/\s+vs\.?\s+/gi, ' frente a ')
      .replace(/\s&\s/g, ' y ')
  );
}

/** Plain, natural text for text-to-speech (also improves the on-device voice). */
export function toSpokenText(value: string): string {
  const plain = value
    .replace(EMOJI, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*•>]|#{1,6}|\d+[.)])\s+/gm, '')
    .replace(/[*_`#]+/g, '')
    // A line break without punctuation is still a pause.
    .replace(/([^\s.!?…:;,])\s*\n+\s*/g, '$1. ')
    .replace(/\s+/g, ' ')
    .trim();
  return expandShorthand(plain).replace(/\s+/g, ' ').trim();
}

function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const clause = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
    const space = window.lastIndexOf(' ');
    const cut = clause > max * 0.4 ? clause + 1 : space > 0 ? space : max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Sentences of `text` (keeps the closing punctuation). */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Pieces of at most `maxChars` (≤ 600), cut between sentences when possible. The first piece is
 * at most ~140 characters so playback starts quickly.
 */
export function splitForSpeech(text: string, maxChars: number = DEFAULT_CHUNK_CHARS): string[] {
  const max = Math.max(40, Math.min(MAX_CHUNK_CHARS, maxChars));
  const sentences = sentencesOf(text.replace(/\s+/g, ' ').trim()).flatMap((sentence) => splitLong(sentence, max));
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks[chunks.length - 1];
    const limit = chunks.length === 1 ? Math.min(FIRST_CHUNK_CHARS, max) : max;
    if (last !== undefined && last.length + 1 + sentence.length <= limit) {
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    } else {
      chunks.push(sentence);
    }
  }
  return chunks;
}
