#!/usr/bin/env node
/**
 * Mirrors the pure domain modules the edge functions need (periodization,
 * zones, season overview and their dependencies) from `src/domain` into
 * `supabase/functions/_shared/planning/domain`. Edge bundles cannot import
 * `src/`, and the app and the server must compute the same weeks, zones and
 * targets, so the server copy is generated, never edited by hand.
 *
 *   node scripts/sync-domain-mirror.mjs           # write the mirror
 *   node scripts/sync-domain-mirror.mjs --check   # exit 1 when it is stale
 *
 * `supabase/functions/_shared/planning/domain/mirror.test.ts` runs the check
 * in `npm run test:functions`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'domain');
export const MIRROR_DIR = join(ROOT, 'supabase', 'functions', '_shared', 'planning', 'domain');

/** Modules copied whole (their imports must stay inside this list, `dates` or `types`). */
const WHOLE = ['constants', 'recoveryLayout', 'periodization', 'zones', 'season', 'prescription'];

/** Declarations of src/domain/dates.ts the mirrored modules use (in source order). */
const DATE_DECLS = [
  'DATE_RE',
  'MS_PER_DAY',
  'pad',
  'parts',
  'isISODate',
  'toISODate',
  'parseISODate',
  'addDays',
  'diffDays',
  'weekdayOf',
  'startOfWeek',
  'weekRange',
  'isoWeekNumber',
];

const header = (source) =>
  `// GENERATED MIRROR of ${source} — do not edit here.\n// Edit the app file and run \`node scripts/sync-domain-mirror.mjs\` (checked by mirror.test.ts).\n`;

function rewriteImports(code) {
  return code.replace(/from '\.\/([A-Za-z]+)'/g, "from './$1.ts'");
}

function wholeModule(name) {
  const code = readFileSync(join(SRC, `${name}.ts`), 'utf8');
  return header(`src/domain/${name}.ts`) + rewriteImports(code);
}

/** Top-level declaration `name` with the comment block right above it. */
function extractDecl(lines, name) {
  const start = lines.findIndex((l) =>
    new RegExp(`^(export )?(function ${name}\\(|const ${name} =)`).test(l),
  );
  if (start < 0) throw new Error(`dates.ts: no declaration named ${name}`);
  let end = start;
  if (/^(export )?function /.test(lines[start])) {
    while (end < lines.length && lines[end] !== '}') end += 1;
  }
  let first = start;
  while (first > 0 && /^(\/\*\*|\s\*|\/\/)/.test(lines[first - 1])) first -= 1;
  return lines.slice(first, end + 1).join('\n');
}

function datesModule() {
  const lines = readFileSync(join(SRC, 'dates.ts'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const body = DATE_DECLS.map((name) => extractDecl(lines, name)).join('\n\n');
  return (
    header('src/domain/dates.ts (subset used by the planning modules)') +
    `/** Local-calendar date helpers (ISODate = 'YYYY-MM-DD'); weeks start on Monday. */\n` +
    `import type { DateRange, ISODate, Weekday } from './types.ts';\n\n` +
    body +
    '\n'
  );
}

const TYPES_MODULE = `${header('the domain types used by the mirrored modules')}/**
 * Re-exports the edge-function type mirror (../../types.ts) plus the two
 * calendar types the mirrored date helpers need.
 */
export type {
  AthleteLevel,
  Intensity,
  ISODate,
  NumberRange,
  Race,
  RaceDistance,
  Sport,
  StepTarget,
  Thresholds,
  TrainableSport,
  WeekPlan,
  WeekPlanDraft,
  WeekPlanKind,
  WorkoutCoaching,
  WorkoutStep,
  WorkoutStepKind,
} from '../../types.ts';

import type { ISODate } from '../../types.ts';

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

/** 0 = Monday … 6 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
`;

/** File name → expected content. */
export function renderMirror() {
  const files = { 'types.ts': TYPES_MODULE, 'dates.ts': datesModule() };
  for (const name of WHOLE) files[`${name}.ts`] = wholeModule(name);
  return files;
}

function normalize(s) {
  return s.replace(/\r\n/g, '\n');
}

/** Names of mirror files that are missing or differ from the app source. */
export function staleFiles() {
  return Object.entries(renderMirror())
    .filter(([file, content]) => {
      const path = join(MIRROR_DIR, file);
      return !existsSync(path) || normalize(readFileSync(path, 'utf8')) !== normalize(content);
    })
    .map(([file]) => file);
}

function main() {
  if (process.argv.includes('--check')) {
    const stale = staleFiles();
    if (stale.length > 0) {
      process.stderr.write(`Domain mirror out of date: ${stale.join(', ')}. Run node scripts/sync-domain-mirror.mjs\n`);
      process.exit(1);
    }
    process.stdout.write('Domain mirror up to date.\n');
    return;
  }
  mkdirSync(MIRROR_DIR, { recursive: true });
  for (const [file, content] of Object.entries(renderMirror())) writeFileSync(join(MIRROR_DIR, file), content);
  process.stdout.write(`Mirrored ${Object.keys(renderMirror()).length} files into ${MIRROR_DIR}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
