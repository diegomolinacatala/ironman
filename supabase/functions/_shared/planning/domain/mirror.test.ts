import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore — plain ESM script shared with the CLI.
import { staleFiles } from '../../../../../scripts/sync-domain-mirror.mjs';
import { buildSeason } from './season.ts';
import { phaseFor } from './periodization.ts';
import type { Race } from './types.ts';
import { athleteZones, zoneTargets } from './zones.ts';

const race: Race = {
  id: 'a',
  name: 'Medio de Valencia',
  date: '2026-12-06',
  distance: 'half',
  priority: 'A',
  location: null,
  goal: null,
  notes: null,
  createdAt: '2026-11-09T10:00:00',
};

test('the server copy of the domain modules matches src/domain', () => {
  assert.deepEqual(staleFiles(), [], 'Run: node scripts/sync-domain-mirror.mjs');
});

test('the mirrored season overview gives the app numbers', () => {
  const season = buildSeason({ today: '2026-11-09', races: [race], weeklyHoursTarget: 8 });
  assert.equal(season.summary, 'Hasta Medio de Valencia: 2 semanas de carga, 1 de afinamiento y la de carrera.');
  assert.deepEqual(
    season.weeks.map((w) => w.kind),
    ['load', 'load', 'taper', 'race'],
  );
  assert.equal(phaseFor('2026-11-30', [race]).phase, 'race_week');
});

test('the mirrored zones give the app numbers', () => {
  assert.deepEqual(zoneTargets('run', 'endurance', { lthr: 170, runThresholdPaceSecPerKm: 270 }).hr, { min: 145, max: 151 });
  assert.deepEqual(zoneTargets('bike', 'endurance', { ftpW: 250 }).power, { min: 140, max: 185 });
  assert.deepEqual(athleteZones({}).missing, ['FC umbral o FC máxima', 'ritmo umbral de carrera', 'FTP', 'CSS de natación']);
});
