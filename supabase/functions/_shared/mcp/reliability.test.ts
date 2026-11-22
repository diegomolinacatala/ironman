/**
 * Claude flow reliability: busy calendar blocks and past dates are refused
 * with a reason Claude can act on, get_planning_context shows two weeks by
 * default, apply_now never leaves a "pending" proposal behind, and busy
 * blocks that began before the window still count.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { checkChanges } from '../planning/changes.ts';
import { emptyState, fakeStore, fixedNow, USER, workout } from '../testing/fakes.ts';
import type { FakeState } from '../testing/fakes.ts';
import type { ApplyChangesResult } from '../planning/store.ts';
import type { ToolResult } from './tool.ts';
import { createToolRegistry } from './tools/index.ts';

const registry = createToolRegistry();
const PLANNED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEXT_WEEK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function run(state: FakeState, name: string, args: unknown, applyResult?: ApplyChangesResult): Promise<ToolResult> {
  const tool = registry.get(name);
  assert.ok(tool, name);
  return tool.run(args, { userId: USER, store: fakeStore(state, applyResult), now: fixedNow, logger: silentLogger });
}

const text = (r: ToolResult): string => r.content[0].text;

/** Week of 2026-10-26 (fixedNow is Saturday 2026-10-24), a busy block on Wednesday 17:00–19:00 Madrid (UTC+1). */
function seeded(): FakeState {
  const state = emptyState();
  state.workouts.push(
    workout({ id: PLANNED_ID, date: '2026-10-27', sport: 'run', title: 'Series', durationMin: 60, startTime: '18:00' }),
    workout({ id: NEXT_WEEK_ID, date: '2026-11-03', sport: 'bike', title: 'Bici semana 2', durationMin: 90 }),
  );
  state.busy.push({ id: 'b1', userId: USER, start: '2026-10-28T16:00:00.000Z', end: '2026-10-28T18:00:00.000Z', title: 'Reunión' });
  return state;
}

test('defect 10: a move or add into a busy calendar block is refused with the clash explained', async () => {
  const state = seeded();
  const move = await run(state, 'propose_plan_changes', {
    week_start: '2026-10-26',
    summary: 'x',
    changes: [{ op: 'move', workoutId: PLANNED_ID, toDate: '2026-10-28', reason: 'r' }],
  });
  assert.equal(move.isError, true);
  assert.match(text(move), /franja ocupada del calendario \(17:00–19:00\)/);
  const add = await run(state, 'propose_plan_changes', {
    week_start: '2026-10-26',
    summary: 'x',
    changes: [{ op: 'add', workout: { date: '2026-10-28', startTime: '16:30', sport: 'run', title: 'Rodaje', durationMin: 45, intensity: 'endurance' }, reason: 'r' }],
  });
  assert.equal(add.isError, true);
  assert.equal(state.proposals.length, 0);
  // Free time, or no time at all, is fine.
  const ok = await run(state, 'propose_plan_changes', {
    week_start: '2026-10-26',
    summary: 'x',
    changes: [
      { op: 'move', workoutId: PLANNED_ID, toDate: '2026-10-28', toStartTime: '19:30', reason: 'r' },
      { op: 'add', workout: { date: '2026-10-28', sport: 'swim', title: 'Técnica', durationMin: 30, intensity: 'endurance' }, reason: 'r' },
    ],
  });
  assert.equal(ok.isError, undefined, text(ok));
});

test('defect 10: checkChanges refuses past dates (add, move, update) and busy overlaps of updates', () => {
  const workouts = seeded().workouts;
  const busy = [{ date: '2026-10-27', start: '18:30', end: '19:00' }];
  const { issues } = checkChanges(
    [
      { op: 'add', workout: { date: '2026-10-23', sport: 'run', title: 'Ayer', durationMin: 30, intensity: 'endurance' }, reason: 'r' },
      { op: 'move', workoutId: PLANNED_ID, toDate: '2026-10-22', reason: 'r' },
      { op: 'update', workoutId: PLANNED_ID, patch: { date: '2026-10-21' }, reason: 'r' },
      { op: 'update', workoutId: PLANNED_ID, patch: { durationMin: 45 }, reason: 'r' },
      { op: 'update', workoutId: PLANNED_ID, patch: { title: 'Solo el título' }, reason: 'r' },
    ],
    { weekStart: '2026-10-19', today: '2026-10-24', workouts, busy },
  );
  assert.deepEqual(issues.map((i) => i.index), [0, 1, 2, 3]);
  assert.match(issues[0]?.error ?? '', /ya ha pasado/);
  assert.match(issues[3]?.error ?? '', /franja ocupada/);
});

test('defect 9: get_planning_context includes next week by default', async () => {
  const state = seeded();
  const r = await run(state, 'get_planning_context', { week_start: '2026-10-26' });
  assert.equal(r.isError, undefined, text(r));
  const sc = r.structuredContent as { nextWeek?: { weekStart: string } };
  assert.equal(sc.nextWeek?.weekStart, '2026-11-02');
  assert.match(JSON.stringify(sc), new RegExp(NEXT_WEEK_ID));
  const only = await run(state, 'get_planning_context', { week_start: '2026-10-26', include_next_week: false });
  assert.equal((only.structuredContent as { nextWeek?: unknown }).nextWeek, undefined);
});

test('defect 11: apply_now stores the proposal as applied (no "pending" notification) and fixes the status after failures', async () => {
  const change = { op: 'update', workoutId: PLANNED_ID, patch: { durationMin: 40 }, reason: 'Fatiga' };
  const ok = seeded();
  await run(ok, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [change], apply_now: true });
  assert.equal(ok.proposals[0]?.status, 'applied');

  const pending = seeded();
  await run(pending, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [change] });
  assert.equal(pending.proposals[0]?.status, 'pending');

  const partial = seeded();
  const add = { op: 'add', workout: { date: '2026-10-29', sport: 'run', title: 'Nuevo', durationMin: 30, intensity: 'endurance' }, reason: 'r' };
  const r = await run(partial, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [change, add], apply_now: true }, {
    applied: 1,
    failed: [{ index: 1, error: 'La fecha ya ha pasado' }],
  });
  assert.equal(partial.proposals[0]?.status, 'partially_applied');
  const sc = r.structuredContent as { status: string; failed: { change: string | null }[]; message: string };
  assert.equal(sc.status, 'partially_applied');
  assert.match(sc.failed[0]?.change ?? '', /add 2026-10-29 Nuevo/);
  assert.match(sc.message, /reintentarlos/);

  const none = seeded();
  await run(none, 'propose_plan_changes', { week_start: '2026-10-26', summary: 'x', changes: [change], apply_now: true }, {
    applied: 0,
    failed: [{ index: 0, error: 'x' }],
  });
  assert.equal(none.proposals[0]?.status, 'discarded');
});

test('apply_now: when the apply RPC throws, the proposal is not left as applied', async () => {
  const change = { op: 'update', workoutId: PLANNED_ID, patch: { durationMin: 40 }, reason: 'Fatiga' };
  const state = seeded();
  const tool = registry.get('propose_plan_changes');
  assert.ok(tool);
  const store = fakeStore(state);
  const throwing = { ...store, applyPlanChanges: async () => Promise.reject(new Error('red caída')) };
  const result = await tool.run(
    { week_start: '2026-10-26', summary: 'x', changes: [change], apply_now: true },
    { userId: USER, store: throwing, now: fixedNow, logger: silentLogger },
  );
  assert.equal(result.isError, true);
  assert.equal(state.proposals[0]?.status, 'discarded');
});

test('defect 14: a busy block that started before the window still occupies it', async () => {
  const state = seeded();
  // Sunday 22:00 → Monday 09:00 (Madrid): starts before Monday's window.
  state.busy.push({ id: 'night', userId: USER, start: '2026-10-25T21:00:00.000Z', end: '2026-10-26T08:00:00.000Z', title: 'Guardia' });
  const store = fakeStore(state);
  const blocks = await store.listBusyBlocks(USER, '2026-10-25T23:00:00.000Z', '2026-10-26T23:00:00.000Z');
  assert.deepEqual(blocks.map((b) => b.id), ['night']);
});
