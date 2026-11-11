import { describe, expect, test } from '@jest/globals';

import type { IntegrationStatus, SleepSnapshot } from '@/domain/types';

import {
  briefingCardState,
  briefingSteps,
  connectWatchCopy,
  dataAttribution,
  formatSleepHours,
  garminState,
  hasSleepData,
  noSleepNote,
  watchState,
  headlineVariant,
  hrvTrend,
  listenLabel,
  playerMode,
  sleepFacts,
  sleepStages,
  sleepVerdictLabel,
  sleepWindow,
  spokenDuration,
  type BriefingCardInput,
} from '../briefingModel';

import { BRIEFING, SLEEP } from './fixtures';

function garmin(state: IntegrationStatus['state']): IntegrationStatus[] {
  return [{ provider: 'garmin_personal', state, expiresAt: null, lastSyncAt: null, lastError: null }];
}

describe('garminState', () => {
  test('maps the integration list to connected / expired / missing', () => {
    expect(garminState(garmin('connected'))).toBe('connected');
    expect(garminState(garmin('expired'))).toBe('expired');
    expect(garminState(garmin('error'))).toBe('expired');
    expect(garminState(garmin('disconnected'))).toBe('missing');
    expect(garminState([])).toBe('missing');
    expect(garminState(undefined)).toBe('missing');
  });

  test('COROS is connected once Apple Salud is on here, whatever the Garmin key says', () => {
    expect(watchState('coros', garmin('connected'), false)).toBe('missing');
    expect(watchState('coros', [], true)).toBe('connected');
    expect(watchState('garmin', garmin('expired'), true)).toBe('expired');
  });
});

describe('briefingCardState', () => {
  const base: BriefingCardInput = {
    briefing: null,
    briefingLoading: false,
    briefingError: null,
    generating: false,
    generateError: null,
    watch: 'connected',
    skipWatch: false,
  };

  test('an existing briefing always wins', () => {
    expect(briefingCardState({ ...base, briefing: BRIEFING, generating: true, watch: 'missing' })).toBe('ready');
  });

  test('generating, loading and error states', () => {
    expect(briefingCardState({ ...base, generating: true })).toBe('generating');
    expect(briefingCardState({ ...base, briefingLoading: true })).toBe('loading');
    expect(briefingCardState({ ...base, watch: 'loading' })).toBe('loading');
    expect(briefingCardState({ ...base, generateError: new Error('x') })).toBe('error');
    expect(briefingCardState({ ...base, briefingError: new Error('x') })).toBe('error');
  });

  test('asks to connect the watch first unless skipped', () => {
    expect(briefingCardState({ ...base, watch: 'missing' })).toBe('connect-watch');
    expect(briefingCardState({ ...base, watch: 'expired' })).toBe('connect-watch');
    expect(briefingCardState({ ...base, watch: 'missing', skipWatch: true })).toBe('empty');
    expect(briefingCardState(base)).toBe('empty');
  });
});

describe('briefingSteps', () => {
  test('mentions the watch only when connected', () => {
    expect(briefingSteps('garmin', true)[0]).toBe('Leyendo tu Garmin…');
    expect(briefingSteps('coros', true)[0]).toBe('Leyendo tu COROS…');
    expect(briefingSteps('coros', false)).toEqual(['Mirando tu plan de hoy…', 'Escribiendo tu informe…']);
  });
});

describe('watch copy', () => {
  test('connect card names the chosen watch; renewing is only for a Garmin key', () => {
    expect(connectWatchCopy('coros', false)).toEqual({
      title: 'Conecta tu COROS',
      message: 'Con tu COROS, cada mañana te cuento cómo has dormido y qué toca hoy.',
      connectLabel: 'Conectar COROS',
      skipLabel: 'Prepararlo sin COROS',
    });
    expect(connectWatchCopy('garmin', true)).toMatchObject({ title: 'Renueva tu Garmin', connectLabel: 'Renovar conexión' });
    expect(noSleepNote('coros')).toMatch(/^Conecta tu COROS en Tú/);
  });

  test('"Datos de Garmin" only for Garmin data: the best row of the day wins', () => {
    const fallback = { brand: 'garmin' as const, watchConnected: true, hasSleep: true };
    expect(dataAttribution([{ source: 'healthkit' }, { source: 'coros' }], fallback)).toBe('Datos de COROS');
    expect(dataAttribution([{ source: 'coros' }, { source: 'garmin' }], fallback)).toBe('Datos de Garmin');
    expect(dataAttribution([{ source: 'healthkit' }], fallback)).toBe('Datos de Apple Salud');
    expect(dataAttribution([{ source: 'manual' }], { ...fallback, hasSleep: false })).toBeNull();
    // No rows yet: a connected Garmin that brought last night's sleep is credited; COROS never by default.
    expect(dataAttribution([], fallback)).toBe('Datos de Garmin');
    expect(dataAttribution([], { ...fallback, brand: 'coros' })).toBeNull();
  });
});

describe('formatting', () => {
  test('sleep hours and spoken durations', () => {
    expect(formatSleepHours(7 + 20 / 60)).toBe("7h 20'");
    expect(formatSleepHours(8)).toBe('8h');
    expect(formatSleepHours(null)).toBeNull();
    expect(formatSleepHours(0)).toBeNull();
    expect(spokenDuration(440)).toBe('7 horas y 20 minutos');
    expect(spokenDuration(60)).toBe('1 hora');
    expect(spokenDuration(45)).toBe('45 minutos');
    expect(spokenDuration(61)).toBe('1 hora y 1 minuto');
  });

  test('verdict labels', () => {
    expect(sleepVerdictLabel('great')).toBe('Has dormido muy bien');
    expect(sleepVerdictLabel('unknown')).toBe('Sin datos de sueño');
  });

  test('headline size depends on its length', () => {
    expect(headlineVariant('Buena noche, rodaje suave')).toBe('display');
    expect(headlineVariant('Has dormido poco: hoy cambiamos las series por un rodaje muy suave')).toBe('title');
  });

  test('listening time and player mode', () => {
    expect(listenLabel('una dos tres')).toBe('1 min');
    expect(listenLabel(Array.from({ length: 300 }, () => 'palabra').join(' '))).toBe('2 min');
    expect(playerMode({ speaking: true, paused: false })).toBe('playing');
    expect(playerMode({ speaking: true, paused: true })).toBe('paused');
    expect(playerMode({ speaking: false, paused: false })).toBe('idle');
  });
});

describe('hrvTrend', () => {
  test('above, below and within the 7-night baseline', () => {
    const up = hrvTrend(52, 48);
    expect(up?.direction).toBe('up');
    expect(up?.deltaPct).toBe(8);
    expect(up?.text).toBe('Por encima de tu media');
    expect(up?.detail).toBe('8 % por encima de tu media de 7 noches (48 ms)');

    const down = hrvTrend(40, 50);
    expect(down?.direction).toBe('down');
    expect(down?.detail).toBe('20 % por debajo de tu media de 7 noches (50 ms)');

    expect(hrvTrend(49, 48)?.direction).toBe('flat');
    expect(hrvTrend(49, 48)?.text).toBe('En tu media');
  });

  test('null without both values', () => {
    expect(hrvTrend(null, 48)).toBeNull();
    expect(hrvTrend(50, null)).toBeNull();
    expect(hrvTrend(50, 0)).toBeNull();
  });
});

describe('sleepFacts', () => {
  test('four facts with icon, value and a spoken label', () => {
    const facts = sleepFacts(SLEEP);
    expect(facts.map((f) => f.key)).toEqual(['hours', 'score', 'hrv', 'battery']);
    expect(facts[0]).toMatchObject({ value: "7h 20'", a11y: 'Sueño: 7 horas y 20 minutos' });
    expect(facts[2]).toMatchObject({ value: '52 ms', label: 'Por encima de tu media', trend: 'up' });
    expect(facts[3]).toMatchObject({ value: '76', a11y: 'Body Battery: 76 de 100' });
  });

  test('skips what Garmin did not report', () => {
    const facts = sleepFacts({ ...SLEEP, score: null, hrvBaselineMs: null, bodyBattery: null });
    expect(facts.map((f) => f.key)).toEqual(['hours', 'hrv']);
    expect(facts[1]?.label).toBe('VFC');
    expect(sleepFacts(null)).toEqual([]);
  });
});

describe('sleepStages', () => {
  test('minutes and whole percentages that add up to 100', () => {
    const stages = sleepStages(SLEEP);
    expect(stages.map((s) => s.key)).toEqual(['deep', 'rem', 'light', 'awake']);
    expect(stages.map((s) => s.minutes)).toEqual([92, 96, 228, 24]);
    expect(stages.reduce((sum, s) => sum + s.pct, 0)).toBe(100);
    expect(stages[2]).toMatchObject({ label: 'Ligero', pct: 52 });
  });

  test('rounding keeps the total at 100', () => {
    const stages = sleepStages({ ...SLEEP, deepMin: 1, remMin: 1, lightMin: 1, awakeMin: null });
    expect(stages.map((s) => s.pct)).toEqual([34, 33, 33]);
  });

  test('empty without stage data', () => {
    expect(sleepStages({ ...SLEEP, deepMin: null, remMin: null, lightMin: 0, awakeMin: null })).toEqual([]);
    expect(sleepStages(null)).toEqual([]);
  });
});

describe('sleepWindow / hasSleepData', () => {
  test('bedtime and wake time in local 24 h', () => {
    expect(sleepWindow(SLEEP)).toEqual({ start: '23:40', end: '07:05' });
    expect(sleepWindow({ ...SLEEP, start: null })).toBeNull();
    expect(sleepWindow({ ...SLEEP, end: 'nope' })).toBeNull();
  });

  test('detects an empty snapshot', () => {
    expect(hasSleepData(SLEEP)).toBe(true);
    const empty: SleepSnapshot = {
      hours: null,
      score: null,
      deepMin: null,
      lightMin: null,
      remMin: null,
      awakeMin: null,
      start: null,
      end: null,
      hrvMs: null,
      hrvBaselineMs: null,
      restingHr: null,
      bodyBattery: null,
    };
    expect(hasSleepData(empty)).toBe(false);
    expect(hasSleepData(null)).toBe(false);
  });
});
