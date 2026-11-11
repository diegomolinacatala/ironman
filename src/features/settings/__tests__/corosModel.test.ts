import { describe, expect, test } from '@jest/globals';

import { emptyHealthResult, type HealthSyncResult } from '@/integrations/health/result';

import { COROS_CLAUDE_PROMPTS, COROS_HEALTH_STEPS, COROS_MCP_EU_URL, COROS_MCP_URL, COROS_PERMISSIONS } from '../corosContent';
import {
  corosImportView,
  corosStatusView,
  corosStepPhase,
  hasCorosSource,
  importedLine,
  isCorosStepDone,
  type CorosHealthLike,
  type CorosStepInput,
} from '../corosModel';
import { CLAUDE_PROMPTS, claudePrompts } from '../PromptList';
import { watchBrandHint, watchBrandOf, watchName } from '../watchBrand';

function result(patch: Partial<HealthSyncResult> = {}): HealthSyncResult {
  return { ...emptyHealthResult(), ...patch };
}

const NOW = new Date('2026-11-10T09:00:00Z');

describe('watch brand', () => {
  test('null, absent or unknown is Garmin (where the app started); COROS always in capitals', () => {
    expect(watchBrandOf(undefined)).toBe('garmin');
    expect(watchBrandOf({ watchBrand: null })).toBe('garmin');
    expect(watchBrandOf({ watchBrand: 'coros' })).toBe('coros');
    expect(watchName('coros')).toBe('COROS');
    expect(watchName('garmin')).toBe('Garmin');
    expect(watchBrandHint('coros')).toMatch(/Apple Salud y tu Claude/);
  });

  test('example prompts follow the watch', () => {
    expect(claudePrompts('garmin')).toBe(CLAUDE_PROMPTS);
    const coros = claudePrompts('coros');
    expect(coros.join(' ')).not.toMatch(/Garmin/);
    expect(coros).toEqual(expect.arrayContaining([...COROS_CLAUDE_PROMPTS]));
    expect(coros).toContain('Pasa a mi calendario de COROS los entrenos de carrera y bici de esta semana de Road to Ironman');
  });
});

describe('COROS guide content', () => {
  test('the three steps in the COROS app and the official connector URLs', () => {
    expect(COROS_HEALTH_STEPS.map((s) => s.text)).toEqual([
      'En la app COROS: Perfil › Ajustes › Apps de terceros › Sincronización de datos › Apple Health',
      'Sincroniza tu reloj',
      'Vuelve y pulsa «Conectar Apple Salud»',
    ]);
    expect(COROS_MCP_URL).toBe('https://mcp.coros.com/mcp');
    expect(COROS_MCP_EU_URL).toBe('https://mcpeu.coros.com/mcp');
    expect(COROS_PERMISSIONS.map((p) => p.value)).toEqual(['Permitir siempre', 'Necesita aprobación', 'Bloqueado']);
  });
});

describe('what came from COROS', () => {
  test('a source named like COROS, whatever the case', () => {
    expect(hasCorosSource(['Salud', 'COROS'])).toBe(true);
    expect(hasCorosSource(['coros app'])).toBe(true);
    expect(hasCorosSource(['Connect', 'Salud'])).toBe(false);
    expect(hasCorosSource(undefined)).toBe(false);
  });

  test('"12 entrenos y 26 noches de sueño", singular forms, nothing → null', () => {
    expect(importedLine({ activitiesFound: 12, sleepNights: 26 })).toBe('12 entrenos y 26 noches de sueño');
    expect(importedLine({ activitiesFound: 1, sleepNights: 1 })).toBe('1 entreno y 1 noche de sueño');
    expect(importedLine({ activitiesFound: 0, sleepNights: 3 })).toBe('3 noches de sueño');
    expect(importedLine({ activitiesFound: 0, sleepNights: 0 })).toBeNull();
  });

  test('seen: «COROS conectado» with what came; waiting: «Aún no vemos datos de COROS»', () => {
    const seen = corosImportView(result({ activitiesFound: 12, sleepNights: 26, sources: ['COROS'] }));
    expect(seen).toEqual({ kind: 'seen', title: 'COROS conectado', message: '12 entrenos y 26 noches de sueño de tus últimas 4 semanas.' });
    // Seen in an earlier sync on this device: still connected, even if this read brought nothing new.
    expect(corosImportView(result(), ['COROS']).kind).toBe('seen');
    const waiting = corosImportView(result({ sleepNights: 2, sources: ['Salud'] }));
    expect(waiting).toMatchObject({ kind: 'waiting', title: 'Aún no vemos datos de COROS' });
    expect(waiting.message).toBe('De momento hemos traído 2 noches de sueño de Apple Salud, pero nada de COROS.');
    expect(corosImportView(null).message).toMatch(/COROS solo pasa a Salud lo nuevo/);
  });
});

describe('COROS status (Conexiones)', () => {
  const on: CorosHealthLike = { available: true, loaded: true, enabled: true, lastSync: '2026-11-10T08:00:00Z', sources: ['COROS'] };

  test('no Apple Salud here, checking, off, waiting and connected', () => {
    expect(corosStatusView({ ...on, available: false }, NOW)).toMatchObject({ state: 'unavailable', label: 'Solo en iPhone' });
    expect(corosStatusView({ ...on, loaded: false }, NOW).state).toBe('checking');
    expect(corosStatusView({ ...on, enabled: false }, NOW)).toMatchObject({ state: 'off', tone: 'muted', label: 'Sin conectar' });
    expect(corosStatusView({ ...on, sources: ['Salud'] }, NOW)).toMatchObject({ state: 'waiting', tone: 'warning', label: 'Esperando datos' });
    const connected = corosStatusView(on, NOW);
    expect(connected).toMatchObject({ state: 'connected', tone: 'success', label: 'Conectado' });
    expect(connected.detail).toMatch(/^Última lectura .+ · por Apple Salud$/);
  });
});

describe('onboarding "Tu reloj" › COROS', () => {
  const base: CorosStepInput = {
    available: true,
    isDemo: false,
    loaded: true,
    enabled: false,
    working: false,
    simulated: false,
    result: null,
    attempted: false,
    known: [],
  };

  test('phases: checking → intro → connecting → seen / waiting', () => {
    expect(corosStepPhase({ ...base, loaded: false })).toBe('checking');
    expect(corosStepPhase(base)).toBe('intro');
    expect(corosStepPhase({ ...base, working: true })).toBe('connecting');
    // On, but not read yet in this visit: the first read is about to start.
    expect(corosStepPhase({ ...base, enabled: true })).toBe('connecting');
    expect(corosStepPhase({ ...base, enabled: true, attempted: true, result: result({ sources: ['COROS'] }) })).toBe('seen');
    expect(corosStepPhase({ ...base, enabled: true, attempted: true, result: result() })).toBe('waiting');
    // The read failed (no result): waiting, never stuck on "connecting".
    expect(corosStepPhase({ ...base, enabled: true, attempted: true })).toBe('waiting');
  });

  test('without Apple Salud: the demo simulates, a signed-in account is told it is iPhone only', () => {
    expect(corosStepPhase({ ...base, available: false })).toBe('unavailable');
    expect(corosStepPhase({ ...base, available: false, isDemo: true })).toBe('intro');
    expect(corosStepPhase({ ...base, available: false, isDemo: true, simulated: true })).toBe('simulated');
  });

  test('done once Apple Salud is on (or simulated)', () => {
    expect(['seen', 'waiting', 'simulated'].every((p) => isCorosStepDone(p as never))).toBe(true);
    expect(['checking', 'unavailable', 'intro', 'connecting'].some((p) => isCorosStepDone(p as never))).toBe(false);
  });
});
