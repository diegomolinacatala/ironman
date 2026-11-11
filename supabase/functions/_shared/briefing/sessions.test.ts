import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, fakeStore, fixedNow, USER, workout } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import { buildBriefingContext, promptPayload } from './context.ts';
import { BRIEFING_SYSTEM_PROMPT } from './prompt.ts';

const DATE = '2026-10-24';

const THRESHOLD_STEPS = [
  { kind: 'warmup' as const, durationMin: 15, intensity: 'recovery' as const },
  { kind: 'work' as const, durationMin: 8, repeat: 3, intensity: 'threshold' as const, cue: 'Solo palabras sueltas' },
  { kind: 'recovery' as const, durationMin: 3, repeat: 3, intensity: 'recovery' as const },
  { kind: 'cooldown' as const, durationMin: 7, intensity: 'recovery' as const },
];

function coachedState(): FakeState {
  const state = emptyState();
  state.races.push({ id: 'r1', userId: USER, name: 'Medio', date: '2027-04-18', distance: 'half', priority: 'A', location: null, goal: null, notes: null });
  state.workouts.push(
    workout({
      date: DATE,
      startTime: '19:00',
      title: 'Umbral 3×8',
      durationMin: 55,
      intensity: 'threshold',
      isKey: true,
      steps: THRESHOLD_STEPS,
      coaching: { objective: 'Subir tu umbral', keys: ['Series a 162–168 ppm'], success: 'Las 3 series en rango', planB: '2 series' },
    }),
    workout({ date: '2026-10-23', title: 'Rodaje', durationMin: 50, status: 'completed', completed: { durationMin: 50, avgHr: 160, rpe: 6, feel: 2, source: 'garmin' } }),
    workout({ date: '2026-10-25', sport: 'bike', title: 'Larga', durationMin: 150, coaching: { objective: 'Fondo en bici', keys: [], success: 'Z2 todo el rato', planB: null } }),
  );
  return state;
}

test('briefing: today carries targets, sensations, prescription and the structure (numbers only on work steps)', async () => {
  const ctx = await buildBriefingContext(fakeStore(coachedState()), { userId: USER, date: DATE, now: fixedNow() });
  const [today] = ctx.todayWorkouts;
  assert.equal(today.targets, "3×8' Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8");
  assert.equal(today.feel, 'Solo palabras sueltas');
  assert.deepEqual(today.coaching, { objective: 'Subir tu umbral', keys: ['Series a 162–168 ppm'], success: 'Las 3 series en rango', planB: '2 series' });
  assert.deepEqual(today.structure, [
    "15' · calentamiento · Z1",
    "3×8' · series · Z4 · 162–168 ppm · 4:27–4:44 /km · RPE 7–8 · Solo palabras sueltas",
    "3×3' · recuperación · Z1",
    "7' · vuelta a la calma · Z1",
  ]);
  const [tomorrow] = ctx.tomorrowWorkouts;
  assert.equal(tomorrow.objective, 'Fondo en bici');
  assert.match(String(tomorrow.targets), /W · \d+–\d+ ppm · RPE 3–4$/);
  assert.equal(tomorrow.structure, undefined, 'tomorrow fits in a line');
});

test('briefing: yesterday compares the watch with the plan (FC media, RPE, sensaciones)', async () => {
  const ctx = await buildBriefingContext(fakeStore(coachedState()), { userId: USER, date: DATE, now: fixedNow() });
  const [done] = ctx.yesterday.sessions;
  assert.deepEqual(done.done, { durationMin: 50, distanceM: undefined, avgHr: 160, rpe: 6, feel: 2 });
  assert.equal(done.planVsDone, 'FC media 160 ppm (plan 145–151 ppm: por encima) · RPE 6 (plan 3–4: por encima) · sensaciones 2/5 (mal)');
});

test('briefing: the week as the app shows it, with the week plan applied', async () => {
  const state = coachedState();
  const plain = await buildBriefingContext(fakeStore(state), { userId: USER, date: DATE, now: fixedNow() });
  assert.deepEqual([plain.phase.label, plain.phase.weekLabel], ['Base 1', 'Descarga']);
  state.weekPlans.push({ userId: USER, weekStart: '2026-10-19', kind: 'push', targetMinutes: null, note: 'Vacaciones', source: 'manual', updatedAt: '2026-10-19T08:00:00Z' });
  const adjusted = await buildBriefingContext(fakeStore(state), { userId: USER, date: DATE, now: fixedNow() });
  assert.equal(adjusted.phase.weekLabel, 'Más volumen');
  assert.match(adjusted.phase.focus, /más volumen.*Vacaciones/i);
  assert.deepEqual(promptPayload(adjusted).phase, adjusted.phase);
});

test('briefing prompt: one target, one sensation and the success criterion; spoken units; device-neutral', () => {
  assert.match(BRIEFING_SYSTEM_PROMPT, /UNA cifra concreta/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /UNA sensación/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /coaching\.success/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /planVsDone/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /coaching\.planB/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /di "tu reloj", nunca la marca/);
  assert.match(BRIEFING_SYSTEM_PROMPT, /Nunca "Z2", "km", "min", "h", "ppm", "lpm", "RPE", "W"/);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(BRIEFING_SYSTEM_PROMPT), 'static prompt: no dates');
});
