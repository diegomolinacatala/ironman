/**
 * Minimal .xlsx reader: the first worksheet as a table of strings. An .xlsx is
 * a zip of XML parts; `fflate` (MIT, pure JS, works in Hermes) unzips it and
 * the few parts we need are read with small regular expressions:
 * xl/workbook.xml (first sheet) → xl/_rels/workbook.xml.rels (its file) →
 * xl/sharedStrings.xml + the sheet's <row>/<c> cells. Numbers stay as written
 * (dates arrive as Excel serial days, times as fractions of a day; the table
 * parser understands both). Formulas use their cached value.
 */
import { strFromU8, unzipSync } from 'fflate';

const MAX_ROWS = 2000;
const MAX_COLS = 40;

export class XlsxError extends Error {}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Text of every <t> inside a fragment (rich-text runs are concatenated). */
function texts(fragment: string): string {
  const out: string[] = [];
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) out.push(decodeXml(m[1] ?? ''));
  return out.join('');
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(texts(m[1] ?? ''));
  return out;
}

/** "B12" → column index 1. */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref.toUpperCase())?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function firstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const sheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  if (sheet && rels) {
    const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${sheet}"[^>]*\\bTarget="([^"]+)"`).exec(rels)
      ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${sheet}"`).exec(rels);
    const target = rel?.[1];
    if (target) {
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      if (files[path]) return path;
    }
  }
  const fallback = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!fallback) throw new XlsxError('El Excel no tiene hojas.');
  return fallback;
}

/** First worksheet of an .xlsx as rows of trimmed strings (empty rows dropped). */
export function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  } catch {
    throw new XlsxError('No he podido abrir el Excel. Guárdalo como .xlsx o expórtalo a CSV.');
  }
  const strings = sharedStrings(files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : null);
  const sheet = strFromU8(files[firstSheetPath(files)] as Uint8Array);
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheet)) && rows.length < MAX_ROWS) {
    const row: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let next = 0;
    while ((cm = cellRe.exec(rm[1] ?? ''))) {
      const attrs = cm[1] ?? '';
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      if (col >= MAX_COLS) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') value = texts(body);
      else if (type === 'b') value = v === '1' ? 'VERDADERO' : 'FALSO';
      else value = v !== undefined ? decodeXml(v) : '';
      while (row.length < col) row.push('');
      row[col] = value.trim();
    }
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  return rows;
}
