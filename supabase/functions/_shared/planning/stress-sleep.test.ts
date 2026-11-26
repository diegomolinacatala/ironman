import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBriefingContext, promptPayload } from '../briefing/context.ts';
import { BRIEFING_SYSTEM_PROMPT } from '../briefing/prompt.ts';
import { COACH_SYSTEM_PROMPT } from '../coach/prompt.ts';
import { MCP_INSTRUCTIONS } from '../mcp/instructions.ts';
import { emptyState, fakeStore, fixedNow, USER } from '../testing/fakes.ts';
import type { DailyMetrics } from '../types.ts';
import { buildPlanningContext } from './context.ts';
import { stressSleepView } from './wellness.ts';

const DATE = '2026-10-24';

function day(back: number): string {
  const d = new Date(`${DATE}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const metric = (date: string, overrides: Partial<DailyMetrics> = {}): DailyMetrics & { userId: string } => ({
  userId: USER,
  date,
  source: 'garmin',
  hrvMs: 60,
  restingHr: 50,
  sleepHours: 7.5,
  sleepScore: 80,
  bodyBattery: 70,
  trainingReadiness: 70,
  vo2max: null,
  steps: null,
  stressAvg: 30,
  trainingStatus: null,
  sleepAwakeMin: 20,
  // 23:00 in Madrid (CEST in October: UTC+2).
  sleepStart: `${day(back(date) + 1)}T21:00:00Z`,
  ...overrides,
});

function back(date: string): number {
  return Math.round((Date.parse(`${DATE}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

/** 28 calm nights, then stressful days (58) and 1 h less sleep on the last two nights. */
function stressedMetrics(): (DailyMetrics & { userId: string })[] {
  const calm = Array.from({ length: 30 }, (_, i) => metric(day(i + 3)));
  return [
    ...calm,
    metric(day(2), { stressAvg: 58 }),
    metric(day(1), { stressAvg: 58, sleepHours: 6.5 }),
    metric(DATE, { stressAvg: null, sleepHours: 6.5 }),
  ];
}

test('stressSleepView: the mirrored signal with local bedtimes in the athlete zone', () => {
  const view = stressSleepView(stressedMetrics(), [], [], DATE, 'Europe/Madrid');
  assert.ok(view);
  assert.equal(view.level, 'moderate');
  assert.equal(view.flaggedNights, 2);
  assert.equal(view.message, 'Estrés alto 2 días y dormiste 1 h menos de lo habitual: hoy suave y acuéstate antes.');
  assert.equal(view.usualBedtime, '23:00');
  assert.equal(view.suggestedBedtime, '22:30');
  assert.equal(view.easeDays, 2);
  // Calm nights or no data: nothing to say.
  assert.equal(stressSleepView(stressedMetrics().map((m) => ({ ...m, stressAvg: 30 })), [], [], DATE, 'Europe/Madrid'), null);
  assert.equal(stressSleepView([], [], [], DATE, 'Europe/Madrid'), null);
});

test('briefing context: stress costing sleep reaches the model with its figure, stronger with an exam', async () => {
  const state = emptyState();
  state.metrics.push(...stressedMetrics());
  const ctx = await buildBriefingContext(fakeStore(state), { userId: USER, date: DATE, now: fixedNow() });
  const sent = promptPayload(ctx) as { stressSleep?: { level: string; exam: boolean; message: string; suggestedBedtime: string } };
  assert.equal(sent.stressSleep?.level, 'moderate');
  assert.match(sent.stressSleep?.message ?? '', /^Estrés alto 2 días y dormiste 1 h menos/);
  assert.equal(sent.stressSleep?.suggestedBedtime, '22:30');

  // An exam the day after tomorrow (outside today's imprevistos) still counts for the signal.
  state.events.push({ userId: USER, id: 'e1', kind: 'exam', title: 'Examen', startDate: day(-2), endDate: day(-2), startTime: null, durationMin: null, severity: 2, bodyArea: null, notes: null });
  const exam = promptPayload(await buildBriefingContext(fakeStore(state), { userId: USER, date: DATE, now: fixedNow() })) as {
    stressSleep?: { level: string; exam: boolean; message: string };
    activeImprevistos: unknown[];
  };
  assert.equal(exam.stressSleep?.exam, true);
  assert.equal(exam.stressSleep?.level, 'high');
  assert.match(exam.stressSleep?.message ?? '', /^Exámenes y estrés alto/);
  assert.equal(exam.activeImprevistos.length, 0);

  // Without the signal the payload has no stressSleep key.
  const calm = emptyState();
  calm.metrics.push(...Array.from({ length: 30 }, (_, i) => metric(day(i))));
  assert.equal('stressSleep' in promptPayload(await buildBriefingContext(fakeStore(calm), { userId: USER, date: DATE, now: fixedNow() })), false);
});

test('planning context (coach, Claude): wellness.stressSleep and how to use it', async () => {
  const state = emptyState();
  const today = fixedNow().toISOString().slice(0, 10);
  // Re-anchor the rows on the context's today.
  const shift = back(today);
  state.metrics.push(...stressedMetrics().map((m) => ({ ...m, date: day(back(m.date) + shift), sleepStart: m.sleepStart ? new Date(Date.parse(m.sleepStart) - shift * 86_400_000).toISOString() : null })));
  const ctx = await buildPlanningContext(fakeStore(state), { userId: USER, now: fixedNow(), detail: 'concise' });
  assert.equal(ctx.wellness.stressSleep?.flaggedNights, 2);
  assert.ok(ctx.notes.some((n) => n.startsWith('wellness.stressSleep')));
  assert.match(COACH_SYSTEM_PROMPT, /wellness\.stressSleep/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /stressSleep/);
  assert.match(MCP_INSTRUCTIONS, /wellness\.stressSleep/);
});
