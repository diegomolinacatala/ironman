/**
 * Post-dictation clean-up for what athletes say to their coach (pure, unit-tested).
 *
 * The iPhone recogniser writes numbers as words or loose digits and mangles training jargon:
 * "dos por cuatro kilómetros a cuatro veinticinco el kilómetro" → "2×4 km a 4:25 /km". Numbers
 * only become digits inside a training pattern (pace, series, unit, zone, RPE, percentage), so
 * "lo hacemos los dos" keeps its words.
 *
 * Pipeline: jargon fixes → number-word phrases marked with their value → patterns → unused marks
 * restored to the original words.
 */

const B0 = '(?<![\\p{L}\\d])';
const B1 = '(?![\\p{L}\\d])';

/** Mangled jargon → canonical spelling (whole words, case-insensitive). */
const JARGON_SOURCES: readonly (readonly [RegExp, string])[] = [
  [/efe\s*te\s*p[eé]|f\s*t\s*p/, 'FTP'],
  [/(?:uve|ve)\s+efe\s+ce|v\s*f\s*c/, 'VFC'],
  [/erre\s+pe\s+e|r\s*p\s*e/, 'RPE'],
  [/pe\s+pe\s+eme|p\s*p\s*m/, 'ppm'],
  [/bri(?:k|c|ck|que)s?/, 'brick'],
  [/far?t?le(?:k|c|ck|que)s?/, 'fartlek'],
  [/garm[ií]n/, 'Garmin'],
  [/cor[oó]s/, 'COROS'],
  [/estrava/, 'Strava'],
  [/s?[uz]wift|suift|zuift/, 'Zwift'],
  [/tri\s*atl[oó]n/, 'triatlón'],
  [/neo\s+preno/, 'neopreno'],
  [/(?:guatios|watios|watts)/, 'vatios'],
  [/vo\s*2\s*m[aá]x|uve\s+o\s+dos\s+m[aá]x(?:imo)?/, 'VO2max'],
];
const JARGON: readonly (readonly [RegExp, string])[] = JARGON_SOURCES.map(([pattern, word]) => [new RegExp(`${B0}(?:${pattern.source})${B1}`, 'giu'), word]);

const fold = (word: string): string => word.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

const SMALL: Readonly<Record<string, number>> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const UNITS = new Set(['un', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']);
const TENS: Readonly<Record<string, number>> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS: Readonly<Record<string, number>> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

interface Parsed {
  value: number;
  /** Words consumed. */
  length: number;
}

function below100(words: readonly string[], i: number): Parsed | null {
  const w = words[i];
  if (w === undefined) return null;
  if (w in SMALL) return { value: SMALL[w], length: 1 };
  if (!(w in TENS)) return null;
  const unit = words[i + 2];
  if (words[i + 1] === 'y' && unit !== undefined && UNITS.has(unit)) return { value: TENS[w] + SMALL[unit], length: 3 };
  return { value: TENS[w], length: 1 };
}

function below1000(words: readonly string[], i: number): Parsed | null {
  const w = words[i];
  if (w === undefined) return null;
  if (w === 'cien') return { value: 100, length: 1 };
  const hundreds = HUNDREDS[w] ?? 0;
  const start = hundreds > 0 ? 1 : 0;
  const rest = below100(words, i + start);
  if (hundreds === 0) return rest;
  return rest ? { value: hundreds + rest.value, length: 1 + rest.length } : { value: hundreds, length: 1 };
}

/** Longest Spanish number phrase starting at `i` ("tres mil ochocientos", "treinta y cinco"), or null. */
export function parseNumberWords(words: readonly string[], i = 0): Parsed | null {
  const head = below1000(words, i);
  const afterHead = i + (head?.length ?? 0);
  if (words[afterHead] !== 'mil' || (head && head.value === 1)) return head;
  const thousands = head ? head.value : 1;
  const tail = below1000(words, afterHead + 1);
  return { value: thousands * 1000 + (tail?.value ?? 0), length: (head?.length ?? 0) + 1 + (tail?.length ?? 0) };
}

const MARK_OPEN = '';
const MARK_SEP = '';
const MARK_CLOSE = '';

interface WordSpan {
  start: number;
  end: number;
  word: string;
  /** Only whitespace between this word and the next one. */
  joinsNext: boolean;
}

function wordSpans(text: string): WordSpan[] {
  const spans = [...text.matchAll(/\p{L}+/gu)].map((m) => ({ start: m.index, end: m.index + m[0].length, word: fold(m[0]) }));
  return spans.map((s, k) => {
    const next = spans[k + 1];
    return { ...s, joinsNext: next !== undefined && /^\s+$/.test(text.slice(s.end, next.start)) };
  });
}

/** Replaces each number-word phrase by a mark carrying its value and the index of the original text. */
function markNumbers(text: string, originals: string[]): string {
  const spans = wordSpans(text);
  let out = '';
  let cursor = 0;
  let k = 0;
  while (k < spans.length) {
    let run = 1;
    while (spans[k + run - 1].joinsNext && k + run < spans.length) run += 1;
    const parsed = parseNumberWords(spans.slice(k, k + run).map((s) => s.word));
    if (!parsed) {
      k += 1;
      continue;
    }
    const first = spans[k];
    const last = spans[k + parsed.length - 1];
    originals.push(text.slice(first.start, last.end));
    out += `${text.slice(cursor, first.start)}${MARK_OPEN}${parsed.value}${MARK_SEP}${originals.length - 1}${MARK_CLOSE}`;
    cursor = last.end;
    k += parsed.length;
  }
  return out + text.slice(cursor);
}

const restoreMarks = (text: string, originals: readonly string[]): string =>
  text.replace(new RegExp(`${MARK_OPEN}\\d+${MARK_SEP}(\\d+)${MARK_CLOSE}`, 'g'), (_m, index: string) => originals[Number(index)] ?? '');

/** A number: a mark (group 1) or digits (group 2). Two capture groups per use. */
const NUM = `(?:${MARK_OPEN}(\\d+)${MARK_SEP}\\d+${MARK_CLOSE}|(\\d+))`;
const num = (mark: string | undefined, digits: string | undefined): number => Number(mark ?? digits);
const pad = (n: number): string => String(n).padStart(2, '0');

const PER_KM = `\\s+(?:el|por|cada|al)\\s+(?:kil[oó]metro|kilo|km)${B1}`;
const MIN_SEC = `${NUM}(?:\\s*:\\s*|\\s+(?:minutos?\\s+)?(?:y\\s+|con\\s+)?)${NUM}(?:\\s+segundos?)?`;
const isPace = (min: number, sec: number): boolean => min >= 1 && min <= 12 && sec >= 0 && sec <= 59;

const UNIT_ABBR: readonly [RegExp, string][] = [
  [/kil[oó]metros?|kms?/, 'km'],
  [/metros?/, 'm'],
  [/vatios?/, 'W'],
  [/pulsaciones|ppm|latidos|pulsos/, 'ppm'],
  [/minutos?/, 'min'],
  [/horas?/, 'h'],
];
const UNIT = `(?:${UNIT_ABBR.map(([r]) => r.source).join('|')})`;
const abbr = (unit: string): string => UNIT_ABBR.find(([r]) => new RegExp(`^(?:${r.source})$`, 'iu').test(unit))?.[1] ?? unit;

type Rule = readonly [RegExp, (match: string, ...groups: (string | undefined)[]) => string];

const RULES: readonly Rule[] = [
  // "un minuto cuarenta los cien" → 1:40 /100 m
  [
    new RegExp(`${B0}${MIN_SEC}\\s+(?:los|por|cada|a\\s+los)\\s+${NUM}(?:\\s+metros)?${B1}`, 'giu'),
    (m, a1, a2, b1, b2, c1, c2) => (isPace(num(a1, a2), num(b1, b2)) && num(c1, c2) === 100 ? `${num(a1, a2)}:${pad(num(b1, b2))} /100 m` : m),
  ],
  // "cuatro veinticinco el kilómetro", "4 25 por km", "4:25 el kilo" → 4:25 /km
  [new RegExp(`${B0}${MIN_SEC}${PER_KM}`, 'giu'), (m, a1, a2, b1, b2) => (isPace(num(a1, a2), num(b1, b2)) ? `${num(a1, a2)}:${pad(num(b1, b2))} /km` : m)],
  // "a 425 el kilómetro" → 4:25 /km
  [new RegExp(`${B0}(\\d)([0-5]\\d)${PER_KM}`, 'giu'), (_m, a, b) => `${a}:${b} /km`],
  // "dos horas y media" → 2 h 30 min
  [new RegExp(`${B0}${NUM}\\s+horas?\\s+y\\s+media${B1}`, 'giu'), (_m, a1, a2) => `${num(a1, a2)} h 30 min`],
  // "dos por cuatro kilómetros", "3 x 8 minutos", "series de seis por mil" → 2×4 km, 3×8 min, series de 6×1000.
  // "por" needs a unit or "series/bloques/repeticiones de" before it: "uno por uno" stays as it is.
  [
    new RegExp(`${B0}(?:((?:series|bloques|repeticiones|intervalos)\\s+de)\\s+)?${NUM}\\s*(por|x|×)\\s*${NUM}(?:\\s+(${UNIT}))?${B1}`, 'giu'),
    (m, lead, a1, a2, sep, b1, b2, unit) => {
      const reps = num(a1, a2);
      const explicit = lead !== undefined || unit !== undefined || sep?.toLowerCase() !== 'por';
      if (reps < 1 || reps > 30 || !explicit) return m;
      return `${lead ? `${lead} ` : ''}${reps}×${num(b1, b2)}${unit ? ` ${abbr(unit)}` : ''}`;
    },
  ],
  // "entre ciento cuarenta y cinco y ciento cincuenta pulsaciones" → entre 145 y 150 ppm
  [
    new RegExp(`${B0}${NUM}(\\s+(?:y|a|o)\\s+)${NUM}\\s+(${UNIT})${B1}`, 'giu'),
    (_m, a1, a2, sep, b1, b2, unit) => `${num(a1, a2)}${sep ?? ' '}${num(b1, b2)} ${abbr(unit ?? '')}`,
  ],
  // "dieciséis kilómetros", "ciento ochenta vatios" → 16 km, 180 W
  [new RegExp(`${B0}${NUM}\\s+(${UNIT})${B1}`, 'giu'), (_m, a1, a2, unit) => `${num(a1, a2)} ${abbr(unit ?? '')}`],
  // "zona dos", "zeta 2", "z2" → Z2
  [new RegExp(`${B0}(?:zona|zeta|zeda|z)\\s*${NUM}`, 'giu'), (m, a1, a2) => (num(a1, a2) >= 1 && num(a1, a2) <= 5 ? `Z${num(a1, a2)}` : m)],
  // "RPE de siete" → RPE 7
  [new RegExp(`${B0}RPE\\s+(?:de\\s+)?${NUM}`, 'giu'), (m, a1, a2) => (num(a1, a2) >= 1 && num(a1, a2) <= 10 ? `RPE ${num(a1, a2)}` : m)],
  // "diez %" (from "por ciento") → 10 %
  [new RegExp(`${B0}${NUM}\\s*%`, 'gu'), (_m, a1, a2) => `${num(a1, a2)} %`],
];

/** Cleans a voice transcript for the coach. Text without training patterns comes back unchanged. */
export function normalizeDictation(text: string): string {
  let out = text;
  for (const [pattern, word] of JARGON) out = out.replace(pattern, word);
  out = out.replace(new RegExp(`${B0}por\\s+ciento${B1}`, 'giu'), '%');
  const originals: string[] = [];
  out = markNumbers(out, originals);
  for (const [pattern, replace] of RULES) out = out.replace(pattern, replace as (substring: string, ...args: unknown[]) => string);
  return restoreMarks(out, originals);
}
