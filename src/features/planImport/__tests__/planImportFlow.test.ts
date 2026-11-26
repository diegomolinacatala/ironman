import { readTable } from '@/domain/planImportTable';
import { parsePlanText } from '@/domain/planImportText';

import { appliedMessage, INITIAL_STATE, mappingReady, planImportReducer, type PlanImportState } from '../planImportFlow';

const TODAY = '2026-11-26'; // Thursday
const plan = parsePlanText("Semana 1\nLunes: rodaje 40' Z2\nJueves: bici 1h Z3\nSemana 2\nMartes: natación 2000 m");

function run(state: PlanImportState, ...actions: Parameters<typeof planImportReducer>[1][]): PlanImportState {
  return actions.reduce(planImportReducer, state);
}

describe('plan import flow', () => {
  test('text → reading → failed keeps what was typed', () => {
    const s = run(INITIAL_STATE, { type: 'text' }, { type: 'setText', text: 'Lunes: algo' }, { type: 'reading', label: 'Leyendo' }, { type: 'failed', error: 'Sin IA' });
    expect(s).toEqual({ step: 'text', text: 'Lunes: algo', error: 'Sin IA' });
  });

  test('review: start defaults to next Monday from Thursday, never before this week, edits and removals', () => {
    let s = run(INITIAL_STATE, { type: 'plan', plan, today: TODAY });
    expect(s).toMatchObject({ step: 'review', start: '2026-11-30', replace: true });
    s = run(s, { type: 'shiftStart', weeks: -1, today: TODAY });
    expect(s).toMatchObject({ start: '2026-11-23' });
    s = run(s, { type: 'shiftStart', weeks: -1, today: TODAY });
    expect(s).toMatchObject({ start: '2026-11-23' });
    s = run(s, { type: 'toggleReplace' }, { type: 'setTitle', title: 'Plan de Marta' });
    expect(s).toMatchObject({ replace: false, plan: { title: 'Plan de Marta' } });
    if (s.step !== 'review') throw new Error('review expected');
    const key = s.plan.sessions[0]!.key;
    s = run(s, { type: 'edit', key }, { type: 'updateSession', key, patch: { durationMin: 50, day: 2 } });
    if (s.step !== 'review') throw new Error('review expected');
    expect(s.plan.sessions.find((x) => x.key === key)).toMatchObject({ durationMin: 50, day: 2 });
    s = run(s, { type: 'removeSession', key });
    if (s.step !== 'review') throw new Error('review expected');
    expect(s.plan.sessions).toHaveLength(2);
    expect(s.editing).toBeNull();
  });

  test('column mapping becomes ready once day/date and content are mapped', () => {
    const table = readTable([
      ['Cuándo', 'Qué'],
      ['Lunes', 'Rodaje'],
    ]);
    let s = run(INITIAL_STATE, { type: 'mapping', table, source: 'csv', title: 'Hoja' });
    expect(mappingReady(s)).toBe(false);
    s = run(s, { type: 'setColumn', index: 0, column: 'day' }, { type: 'setColumn', index: 1, column: 'description' });
    expect(mappingReady(s)).toBe(true);
  });

  test('applied message', () => {
    expect(appliedMessage(12, 3, 1)).toMatch(/12 sesiones añadidas.*3 sesiones que había planificado.*1 sesión quedaba/);
    expect(appliedMessage(1, 0, 0)).toMatch(/^1 sesión añadida a tu plan\. A partir de ahora/);
  });
});
