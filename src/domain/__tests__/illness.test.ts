import { describe, expect, test } from '@jest/globals';

import { addDays } from '../dates';
import { ILLNESS_SIGNAL, illnessOutcome, illnessQuestion, illnessSignal, POSSIBLE_ILLNESS_MESSAGE, type NightMetrics } from '../illness';

const TODAY = '2026-11-26';

/** `nights` nights before TODAY with a steady baseline (small night-to-night noise). */
function history(nights = 20, overrides: Partial<NightMetrics> = {}): NightMetrics[] {
  return Array.from({ length: nights }, (_, i) => ({
    date: addDays(TODAY, -(i + 1)),
    source: 'garmin',
    sleepRespiration: 14.5 + (i % 3) * 0.1,
    sleepAvgHr: 52 + (i % 2),
    restingHr: 48 + (i % 2),
    hrvMs: 60 + (i % 3),
    ...overrides,
  }));
}

const tonight = (values: Partial<NightMetrics>): NightMetrics => ({ date: TODAY, source: 'garmin', sleepRespiration: 14.6, sleepAvgHr: 52, restingHr: 48, hrvMs: 61, ...values });

describe('illnessSignal', () => {
  test('a usual night is no signal', () => {
    expect(illnessSignal([...history(), tonight({})], TODAY)).toMatchObject({ level: 'none', reasons: [] });
  });

  test('breathing up about one breath per minute is something to watch', () => {
    const signal = illnessSignal([...history(), tonight({ sleepRespiration: 15.9 })], TODAY);
    expect(signal).toMatchObject({ level: 'watch', breathingUp: true, pulseUp: false, respirationDelta: 1.3 });
    expect(signal.reasons).toEqual(['Respiración durante el sueño 15,9 resp/min, +1,3 sobre tu media (14,6)']);
  });

  test('breathing and pulse up together is likely', () => {
    const signal = illnessSignal([...history(), tonight({ sleepRespiration: 15.8, sleepAvgHr: 59 })], TODAY);
    expect(signal).toMatchObject({ level: 'likely', breathingUp: true, pulseUp: true, sleepHrDelta: 6.5 });
    // The shown difference matches the shown numbers (59 − 53), not the raw 6,5.
    expect(signal.reasons).toEqual([
      'Respiración durante el sueño 15,8 resp/min, +1,2 sobre tu media (14,6)',
      'Pulso durante el sueño 59 ppm, +6 sobre tu media (53)',
    ]);
  });

  test('one primary signal with the HRV drop as supporting evidence is likely', () => {
    const signal = illnessSignal([...history(), tonight({ restingHr: 55, hrvMs: 45 })], TODAY);
    expect(signal).toMatchObject({ level: 'likely', pulseUp: true, breathingUp: false });
    expect(signal.hrvDropPct).toBeGreaterThanOrEqual(ILLNESS_SIGNAL.hrvDropPct);
    expect(signal.reasons.at(-1)).toMatch(/^VFC 45 ms, un \d+ % por debajo de tu media$/);
  });

  test('an HRV drop alone is not an illness signal (it also follows hard training)', () => {
    expect(illnessSignal([...history(), tonight({ hrvMs: 40 })], TODAY).level).toBe('none');
  });

  test('just under the thresholds stays quiet', () => {
    const signal = illnessSignal([...history(), tonight({ sleepRespiration: 15.5, sleepAvgHr: 56, restingHr: 52 })], TODAY);
    expect(signal.level).toBe('none');
  });

  test('needs 14 nights of baseline and last night itself', () => {
    expect(illnessSignal([...history(13), tonight({ sleepRespiration: 17 })], TODAY).level).toBe('none');
    expect(illnessSignal([...history(14), tonight({ sleepRespiration: 17 })], TODAY).level).toBe('watch');
    // Yesterday's high night does not raise today's question.
    const yesterdayHigh = [...history(20).slice(1), { ...history(1)[0]!, sleepRespiration: 17, sleepAvgHr: 62 }];
    expect(illnessSignal(yesterdayHigh, TODAY).level).toBe('none');
  });

  test('the baseline is a median of up to 28 nights: one past cold barely moves it', () => {
    const withCold = history(28).map((m, i) => (i === 3 ? { ...m, sleepRespiration: 19, sleepAvgHr: 66 } : m));
    expect(illnessSignal([...withCold, tonight({ sleepRespiration: 15.7 })], TODAY).level).toBe('watch');
    const old = { ...history(1)[0]!, date: addDays(TODAY, -40), sleepRespiration: 30 };
    expect(illnessSignal([...history(13), old, tonight({ sleepRespiration: 17 })], TODAY).level).toBe('none');
  });

  test('merges sources per field (Garmin first) and ignores impossible readings', () => {
    const healthkit = { ...tonight({ sleepRespiration: 19 }), source: 'healthkit' };
    expect(illnessSignal([...history(), tonight({ sleepRespiration: 14.6 }), healthkit], TODAY).level).toBe('none');
    const onlyHealth = illnessSignal([...history(), { date: TODAY, source: 'healthkit', sleepRespiration: 16 }], TODAY);
    expect(onlyHealth.level).toBe('watch');
    expect(illnessSignal([...history(), tonight({ sleepRespiration: 90, sleepAvgHr: 300 })], TODAY).level).toBe('none');
  });
});

describe('illnessQuestion', () => {
  test('names what is up', () => {
    expect(illnessQuestion({ breathingUp: true, pulseUp: true })).toBe('Tu respiración y tu pulso de esta noche están más altos de lo normal. ¿Cómo te encuentras?');
    expect(illnessQuestion({ breathingUp: true, pulseUp: false })).toBe('Tu respiración de esta noche está más alta de lo normal. ¿Cómo te encuentras?');
    expect(illnessQuestion({ breathingUp: false, pulseUp: true })).toBe('Tu pulso de esta noche está más alto de lo normal. ¿Cómo te encuentras?');
  });
});

describe('illnessOutcome', () => {
  const likely = illnessSignal([...history(), tonight({ sleepRespiration: 15.8, sleepAvgHr: 59 })], TODAY);
  const none = illnessSignal([...history(), tonight({})], TODAY);

  test('symptoms: possible illness, said with tact', () => {
    expect(illnessOutcome(likely, 'symptoms')).toMatchObject({
      kind: 'possible_illness',
      level: 'likely',
      message: POSSIBLE_ILLNESS_MESSAGE,
      factor: 'Respiración y pulso de esta noche altos y notas síntomas',
    });
    expect(POSSIBLE_ILLNESS_MESSAGE).toBe('Puede que estés empezando a ponerte malo: hoy mejor suave y vigila cómo evoluciona.');
    // How the athlete feels counts even when the numbers moved back to normal.
    expect(illnessOutcome(none, 'symptoms')).toMatchObject({ kind: 'possible_illness', factor: 'Notas síntomas: garganta, mocos o cansancio raro' });
  });

  test('alcohol, heat or stress explain it without any illness alarm', () => {
    expect(illnessOutcome(likely, 'alcohol')).toMatchObject({
      kind: 'explained',
      message: 'Tu respiración y tu pulso de esta noche están más altos de lo normal, seguramente por el alcohol o la cena tardía: no es para alarmarse.',
    });
    expect(illnessOutcome(likely, 'heat')?.factor).toBe('Respiración y pulso de esta noche altos, seguramente por el calor o el mal descanso');
    expect(illnessOutcome(likely, 'stress')?.message).not.toMatch(/malo|enferm/);
  });

  test('fine keeps the plan; no answer yet is a gentle heads-up; nothing to say without a signal', () => {
    expect(illnessOutcome(likely, 'fine')).toMatchObject({
      kind: 'fine',
      factor: 'Respiración y pulso de esta noche altos, pero te encuentras bien',
      message: 'Tu respiración y tu pulso de esta noche están más altos de lo normal, pero te encuentras bien: sigue el plan y fíjate en si mañana sigue igual.',
    });
    expect(illnessOutcome(likely, null)).toMatchObject({
      kind: 'unanswered',
      message: 'Tu respiración y tu pulso de esta noche están más altos de lo normal: si notas algo raro, hoy mejor suave.',
    });
    expect(illnessOutcome(none, null)).toBeNull();
    expect(illnessOutcome(none, 'fine')).toBeNull();
    expect(illnessOutcome(none, 'alcohol')).toBeNull();
  });
});
