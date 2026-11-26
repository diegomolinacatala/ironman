import assert from 'node:assert/strict';
import test from 'node:test';
import type { BriefingStore, StoredBriefing } from '../briefing/ports.ts';
import { silentLogger } from '../log.ts';
import { emptyState, fakeStore, fixedNow, USER } from '../testing/fakes.ts';
import type { ToolResult } from './tool.ts';
import { createToolRegistry } from './tools/index.ts';
import { CLAUDE_BRIEFING_MODEL } from './tools/save-briefing.ts';

const tool = createToolRegistry().get('save_briefing');

function memoryBriefings(): BriefingStore & { rows: Map<string, StoredBriefing> } {
  const rows = new Map<string, StoredBriefing>();
  return {
    rows,
    getBriefing: async (userId, date) => rows.get(`${userId}:${date}`) ?? null,
    upsertBriefing: async (userId, row) => {
      rows.set(`${userId}:${row.date}`, row);
      return row;
    },
  };
}

const SCRIPT =
  'Buenos días, Diego. Has dormido siete horas y veinte minutos y la variabilidad de tu pulso está en tu media, así que llegas fresco. Ayer rodaste suave justo en tus pulsaciones. Hoy toca la tirada larga con dos bloques a ritmo de media: buscamos que el cuerpo aprenda a sostener ese ritmo cuando ya lleva kilómetros en las piernas.';

const args = {
  date: '2026-10-24',
  headline: "Dormiste 7 h 20' · Hoy tirada larga con 2×4 km",
  script: SCRIPT,
  focus: 'Bloques a 4:25-4:35 /km, RPE 6-7',
  sleep_verdict: 'good',
  sleep_summary: '7 h 20 min, VFC en tu media.',
};

async function run(input: unknown, briefings: BriefingStore | undefined): Promise<ToolResult> {
  assert.ok(tool);
  return tool.run(input, { userId: USER, store: fakeStore(emptyState()), briefings, now: fixedNow, logger: silentLogger });
}

test('save_briefing stores the day as a Claude briefing the app will show', async () => {
  const briefings = memoryBriefings();
  const result = await run(args, briefings);
  assert.equal(result.isError, undefined, result.content[0].text);
  const row = briefings.rows.get(`${USER}:2026-10-24`);
  assert.ok(row);
  assert.equal(row.model, CLAUDE_BRIEFING_MODEL);
  assert.equal(row.sleepVerdict, 'good');
  assert.equal(row.sleep, null);
  assert.equal(row.script, SCRIPT);
});

test('save_briefing defaults the sleep fields and accepts tomorrow', async () => {
  const briefings = memoryBriefings();
  const { sleep_verdict: _v, sleep_summary: _s, ...rest } = args;
  const result = await run({ ...rest, date: '2026-10-25' }, briefings);
  assert.equal(result.isError, undefined, result.content[0].text);
  const row = briefings.rows.get(`${USER}:2026-10-25`);
  assert.equal(row?.sleepVerdict, 'unknown');
  assert.equal(row?.sleepSummary, '');
});

test('save_briefing refuses days outside yesterday-tomorrow, short scripts and missing storage', async () => {
  const briefings = memoryBriefings();
  const far = await run({ ...args, date: '2026-10-27' }, briefings);
  assert.equal(far.isError, true);
  assert.match(far.content[0].text, /ayer, hoy o mañana/);
  const short = await run({ ...args, script: 'Hoy rodaje.' }, briefings);
  assert.equal(short.isError, true);
  assert.equal(briefings.rows.size, 0);
  const missing = await run(args, undefined);
  assert.equal(missing.isError, true);
});

test('save_briefing keeps the sleep snapshot an earlier briefing stored', async () => {
  const briefings = memoryBriefings();
  const sleep = { durationMin: 440 } as unknown as StoredBriefing['sleep'];
  await briefings.upsertBriefing(USER, { date: '2026-10-24', headline: 'x', sleepVerdict: 'good', sleepSummary: '', script: 'x', focus: '', sleep, model: 'qwen', createdAt: '2026-10-24T05:00:00.000Z' });
  const result = await run(args, briefings);
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.equal(briefings.rows.get(`${USER}:2026-10-24`)?.sleep, sleep);
  assert.equal(briefings.rows.get(`${USER}:2026-10-24`)?.model, CLAUDE_BRIEFING_MODEL);
});
