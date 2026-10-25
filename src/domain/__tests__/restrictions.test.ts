import { addDays, daysInRange } from '../dates';
import { allowsSession, cardiacBlockEnd, classifyIllness, hasMedicalClearance, INJURY_RULES, NO_RESTRICTION, restrictionsForDates, triageInjury } from '../restrictions';
import { BODY_AREAS } from '../types';
import { makeEvent } from './fixtures';

const MON = '2026-10-26';
const week = daysInRange({ from: MON, to: addDays(MON, 13) });
const easyRun = { sport: 'run' as const, intensity: 'endurance' as const, durationMin: 40, isLong: false, isQuality: false };
const hardRun = { ...easyRun, intensity: 'threshold' as const, isQuality: true };

describe('triage', () => {
  test('injury severity and red-flag words', () => {
    expect(triageInjury(makeEvent({ kind: 'injury', severity: 1 }))).toBe('green');
    expect(triageInjury(makeEvent({ kind: 'injury', severity: 2 }))).toBe('amber');
    expect(triageInjury(makeEvent({ kind: 'injury', severity: 3 }))).toBe('red');
    expect(triageInjury(makeEvent({ kind: 'injury', severity: 1, notes: 'Noté un chasquido' }))).toBe('red');
  });

  test('illness neck check', () => {
    expect(classifyIllness(makeEvent({ kind: 'illness', severity: 1, title: 'Mocos' }))).toBe('above_neck');
    expect(classifyIllness(makeEvent({ kind: 'illness', severity: 1, notes: 'algo de fiebre' }))).toBe('systemic');
    expect(classifyIllness(makeEvent({ kind: 'illness', severity: 2 }))).toBe('systemic');
    expect(classifyIllness(makeEvent({ kind: 'illness', severity: 1, notes: 'diarrea' }))).toBe('gastro');
    expect(classifyIllness(makeEvent({ kind: 'illness', severity: 2, title: 'Gripe' }))).toBe('flu');
    expect(classifyIllness(makeEvent({ kind: 'illness', severity: 1, notes: 'palpitaciones' }))).toBe('cardiac');
  });

  test('every body area has a rule with an alarm sign', () => {
    for (const a of BODY_AREAS) expect(INJURY_RULES[a].alarm.length).toBeGreaterThan(5);
  });
});

describe('restrictionsForDates', () => {
  test('no events → no restrictions', () => {
    const r = restrictionsForDates(week, []);
    expect(r[MON]).toEqual(NO_RESTRICTION);
  });

  test('amber knee: run blocked 3+ days with swim substitute', () => {
    const r = restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 2, bodyArea: 'knee' })]);
    expect(r[MON]?.blockedSports).toContain('run');
    expect(r[MON]?.substitutes.run).toBe('swim');
    expect(r[addDays(MON, 2)]?.blockedSports).toContain('run');
    expect(r[addDays(MON, 3)]?.blockedSports).not.toContain('run');
    expect(allowsSession(r[MON] ?? NO_RESTRICTION, easyRun)).toBe(false);
  });

  test('green achilles: run easy only for a week, 70 % volume', () => {
    const r = restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 1, bodyArea: 'achilles' })]);
    const day = r[addDays(MON, 6)] ?? NO_RESTRICTION;
    expect(allowsSession(day, easyRun)).toBe(true);
    expect(allowsSession(day, hardRun)).toBe(false);
    expect(day.sportFactor.run).toBe(0.7);
    expect(r[addDays(MON, 7)]?.easyOnlySports).toEqual([]);
  });

  test('red injury and unspecified area', () => {
    expect(restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 3, bodyArea: 'calf' })])[MON]?.noTraining).toBe(true);
    const other = restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 1, bodyArea: null })])[MON];
    expect(other?.maxIntensity).toBe('endurance');
  });

  test('systemic illness: rest until 24 h after, then progressive return', () => {
    const r = restrictionsForDates(week, [makeEvent({ kind: 'illness', severity: 2, startDate: MON, endDate: addDays(MON, 1) })]);
    expect(r[MON]?.noTraining).toBe(true);
    expect(r[addDays(MON, 2)]?.noTraining).toBe(true);
    expect(r[addDays(MON, 3)]?.volumeFactor).toBe(0.5);
    expect(r[addDays(MON, 3)]?.maxIntensity).toBe('endurance');
    expect(r[addDays(MON, 4)]?.volumeFactor).toBe(0.75);
  });

  test('above-neck illness: easy and short; cardiac: everything blocked', () => {
    const neck = restrictionsForDates(week, [makeEvent({ kind: 'illness', severity: 1, title: 'Resfriado' })])[MON];
    expect(neck?.volumeFactor).toBe(0.55);
    expect(neck?.noQuality).toBe(true);
    const cardiac = restrictionsForDates(week, [makeEvent({ kind: 'illness', severity: 1, notes: 'dolor en el pecho' })]);
    expect(cardiac[addDays(MON, 10)]?.noTraining).toBe(true);
  });

  test('cardiac: blocked until the medical all-clear or 14 days after the last day, then an easy return', () => {
    const chest = makeEvent({ kind: 'illness', severity: 1, title: 'Palpitaciones', startDate: MON, endDate: addDays(MON, 1) });
    const long = daysInRange({ from: MON, to: addDays(MON, 30) });
    const r = restrictionsForDates(long, [chest]);
    expect(r[addDays(MON, 15)]?.noTraining).toBe(true);
    expect(r[addDays(MON, 16)]?.noTraining).toBe(false);
    expect(r[addDays(MON, 16)]?.codes).toContain('CARDIAC_RETURN');
    expect(r[addDays(MON, 16)]?.maxIntensity).toBe('endurance');
    expect(r[addDays(MON, 30)]).toEqual(NO_RESTRICTION);
    expect(cardiacBlockEnd(chest)).toBe(addDays(MON, 15));

    const cleared = { ...chest, notes: 'Me han dado el alta médica' };
    expect(hasMedicalClearance(cleared)).toBe(true);
    const rc = restrictionsForDates(long, [cleared]);
    expect(rc[addDays(MON, 1)]?.noTraining).toBe(true);
    expect(rc[addDays(MON, 2)]?.noTraining).toBe(false);
    expect(rc[addDays(MON, 2)]?.noQuality).toBe(true);
    expect(hasMedicalClearance({ ...chest, notes: 'Pendiente del cardiólogo, no apto todavía' })).toBe(false);
  });

  test('events that ended weeks ago leave no restriction', () => {
    const old = [
      makeEvent({ id: 'a', kind: 'illness', severity: 1, title: 'Mareo', startDate: addDays(MON, -40), endDate: addDays(MON, -39) }),
      makeEvent({ id: 'b', kind: 'illness', severity: 3, title: 'Fiebre', startDate: addDays(MON, -30), endDate: addDays(MON, -28) }),
      makeEvent({ id: 'c', kind: 'injury', severity: 2, bodyArea: 'calf', startDate: addDays(MON, -20) }),
    ];
    const r = restrictionsForDates(week, old);
    expect(week.every((d) => r[d] === NO_RESTRICTION || (r[d]?.codes.length ?? 0) === 0)).toBe(true);
  });

  test('football: no run next day, no run quality the day after', () => {
    const r = restrictionsForDates(week, [makeEvent({ kind: 'football' })]);
    expect(r[addDays(MON, 1)]?.blockedSports).toContain('run');
    expect(r[addDays(MON, 2)]?.easyOnlySports).toContain('run');
    expect(r[addDays(MON, 3)]?.easyOnlySports).toEqual([]);
    const padel = restrictionsForDates(week, [makeEvent({ kind: 'padel' })]);
    expect(padel[addDays(MON, 1)]?.easyOnlySports).toContain('run');
    expect(padel[addDays(MON, 2)]?.easyOnlySports).toEqual([]);
  });

  test('travel: short session on travel days, no bike/pool away unless noted', () => {
    const r = restrictionsForDates(week, [makeEvent({ kind: 'travel', startDate: MON, endDate: addDays(MON, 3), notes: 'hotel con piscina' })]);
    expect(r[MON]?.maxDurationMin).toBe(45);
    expect(r[addDays(MON, 1)]?.blockedSports).toEqual(['bike', 'brick']);
    expect(r[addDays(MON, 3)]?.maxDurationMin).toBe(45);
  });

  test('stress, exams, overload and social', () => {
    expect(restrictionsForDates(week, [makeEvent({ kind: 'stress' })])[MON]?.qualityCut).toBe(1);
    const exam = restrictionsForDates(week, [makeEvent({ kind: 'exam', severity: 3 })])[MON];
    expect(exam?.volumeFactor).toBe(0.6);
    expect(exam?.weekQualityCap).toBe(1);
    expect(restrictionsForDates(week, [makeEvent({ kind: 'overload', bodyArea: null })])[MON]?.noQuality).toBe(true);
    expect(restrictionsForDates(week, [makeEvent({ kind: 'overload', bodyArea: 'calf', severity: 3 })])[MON]?.blockedSports).toContain('run');
    expect(restrictionsForDates(week, [makeEvent({ kind: 'social', severity: 3 })])[addDays(MON, 1)]?.noQuality).toBe(true);
    expect(restrictionsForDates(week, [makeEvent({ kind: 'social', severity: 1 })])[addDays(MON, 1)]).toEqual(NO_RESTRICTION);
  });

  test('bricks follow the bike/run restrictions (injury, other sports)', () => {
    const brick = { sport: 'brick' as const, intensity: 'endurance' as const, durationMin: 75, isLong: false, isQuality: true };
    const amber = restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 2, bodyArea: 'knee' })])[MON] ?? NO_RESTRICTION;
    expect(amber.blockedSports).toContain('brick');
    expect(allowsSession(amber, brick)).toBe(false);
    const green = restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 1, bodyArea: 'knee' })])[MON] ?? NO_RESTRICTION;
    expect(allowsSession(green, brick)).toBe(false);
    // Green shoulder only limits swimming; amber also keeps its bike substitute easy (so no brick).
    const shoulder = restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 1, bodyArea: 'shoulder' })])[MON] ?? NO_RESTRICTION;
    expect(allowsSession(shoulder, brick)).toBe(true);
    const amberShoulder = restrictionsForDates(week, [makeEvent({ kind: 'injury', severity: 2, bodyArea: 'shoulder' })])[MON] ?? NO_RESTRICTION;
    expect(allowsSession(amberShoulder, brick)).toBe(false);
    // A restriction that only lists 'run' still blocks a brick.
    expect(allowsSession({ ...NO_RESTRICTION, blockedSports: ['run'] }, brick)).toBe(false);
    expect(allowsSession({ ...NO_RESTRICTION, easyOnlySports: ['bike'] }, brick)).toBe(false);
  });

  test('allowsSession caps', () => {
    const capped = { ...NO_RESTRICTION, maxDurationMin: 45, maxIntensity: 'endurance' as const };
    expect(allowsSession(capped, { ...easyRun, durationMin: 60 })).toBe(false);
    expect(allowsSession(capped, hardRun)).toBe(false);
    expect(allowsSession({ ...NO_RESTRICTION, noLong: true }, { ...easyRun, isLong: true })).toBe(false);
    expect(allowsSession(NO_RESTRICTION, hardRun)).toBe(true);
  });
});
