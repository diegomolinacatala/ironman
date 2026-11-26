import { fuelingSchedule, intakeSchedule } from '../fueling';
import { BIKE_FTP_PCT, bikePowerRange, raceFamily, runPaceRange, typicalLegMinutes } from '../raceDay';
import { buildRacePlan, racePlanHint, type RacePlan } from '../racePlan';
import type { Thresholds } from '../types';

/** FTP 250 W, threshold pace 4:30 /km, CSS 1:45 /100 m, LTHR 170, max HR 190. */
const FULL: Thresholds = { ftpW: 250, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 105, lthr: 170, maxHr: 190 };

function plan(input: Parameters<typeof buildRacePlan>[0]): RacePlan {
  const result = buildRacePlan(input);
  if (!result) throw new Error('expected a plan');
  return result;
}

describe('race-day tables', () => {
  it('documents the bike power bands per distance (× FTP)', () => {
    expect(BIKE_FTP_PCT).toEqual({ sprint: [0.9, 0.95], olympic: [0.85, 0.9], half: [0.75, 0.82], full: [0.65, 0.75] });
    expect(bikePowerRange('half', 250)).toEqual({ min: 190, max: 205 });
    expect(bikePowerRange('full', 300)).toEqual({ min: 195, max: 225 });
  });

  it('slows the run pace off the bike more the longer the race', () => {
    expect(runPaceRange('sprint', 270)).toEqual({ min: 270, max: 281 });
    expect(runPaceRange('half', 270)).toEqual({ min: 292, max: 305 });
    expect(runPaceRange('full', 270)).toEqual({ min: 311, max: 335 });
    // Run-only races use the race row of zones.ts (no bike before).
    expect(runPaceRange('run_marathon', 270)).toEqual({ min: 286, max: 302 });
  });

  it('has no plan for a distance without known legs', () => {
    expect(raceFamily('other')).toBeNull();
    expect(buildRacePlan({ distance: 'other', thresholds: FULL })).toBeNull();
  });

  it('scales typical leg minutes with the level', () => {
    expect(typicalLegMinutes('half', 'intermediate')).toEqual({ swim: 40, bike: 170, run: 120 });
    expect(typicalLegMinutes('half', 'beginner').bike).toBeGreaterThan(170);
    expect(typicalLegMinutes('half', 'advanced').bike).toBeLessThan(170);
  });
});

describe('buildRacePlan — Media distancia with every threshold', () => {
  const p = plan({ distance: 'half', thresholds: FULL, level: 'intermediate' });

  it('gives the swim effort per 100 m and the feel', () => {
    expect(p.swim?.distance).toBe('1.900 m');
    expect(p.swim?.pace).toEqual({ min: 107, max: 109 });
    expect(p.swim?.targets).toEqual(['1:47–1:49 /100 m', 'RPE 6–7']);
    expect(p.swim?.feel).toMatch(/sostenible/);
    expect(p.swim?.steps.map((s) => s.label)).toEqual(['Salida', 'Orientación', 'Últimos 200 m']);
  });

  it('gives watts as % FTP, an HR ceiling and three bike blocks', () => {
    expect(p.bike?.power).toEqual({ min: 190, max: 205 });
    expect(p.bike?.ftpPct).toEqual({ min: 75, max: 82 });
    expect(p.bike?.hrCap).toBe(152);
    expect(p.bike?.targets).toEqual(['190–205 W · 75–82 % FTP', 'FC hasta 152 ppm', 'RPE 6–7']);
    expect(p.bike?.steps).toEqual([
      { label: "Primeros 20'", target: '170–180 W', text: expect.stringMatching(/por debajo/) },
      { label: 'Bloque central', target: '190–205 W', text: expect.stringContaining('225 W') },
      { label: "Últimos 20'", target: '180–195 W', text: expect.stringMatching(/cadencia/) },
    ]);
  });

  it('splits the run in a controlled start, the target and the end, with HR guidance', () => {
    expect(p.run.pace).toEqual({ min: 292, max: 305 });
    expect(p.run.hr).toEqual({ min: 156, max: 163 });
    expect(p.run.targets).toEqual(['4:52–5:05 /km', 'FC 156–163 ppm', 'RPE 6–7']);
    expect(p.run.hrNote).toBe('FC 156–163 ppm: si se dispara en los primeros kilómetros, frena.');
    expect(p.run.steps.map((s) => [s.label, s.target])).toEqual([
      ['Primeros 5 km', '5:05–5:15 /km'],
      ['Km 5–16', '4:52–5:05 /km'],
      ['Últimos 5 km', '4:52–5:05 /km'],
    ]);
  });

  it('times the fueling by minute with 25 g gels', () => {
    expect(p.fuel.carbsPerHour).toEqual({ min: 60, max: 90 });
    expect(p.fuel.targetCarbsPerHour).toBe(70);
    expect(p.fuel.sodiumMgPerHour).toEqual({ min: 300, max: 600 });
    expect(p.fuel.bike).toEqual({ minutes: [20, 40, 60, 80, 95, 115, 135, 155], gramsPerServing: 25, totalCarbsG: 198, drinkCarbsG: 0, fluidMl: 1800 });
    expect(p.fuel.run?.minutes).toEqual([30, 55, 80, 105]);
    expect(p.fuel.before).toMatch(/3 h antes/);
  });

  it('lists the transitions and needs nothing else', () => {
    expect(p.transitions?.t1[1]).toMatch(/Casco abrochado/);
    expect(p.transitions?.t2).toHaveLength(3);
    expect(p.missing).toEqual([]);
    expect(racePlanHint(p)).toBeNull();
  });

  it('sums it up in one line', () => {
    expect(p.summary).toBe('Bici 190–205 W · carrera 4:52–5:05 /km · 70 g/h');
  });

  it('times the fueling with the predicted leg minutes when given', () => {
    const faster = plan({ distance: 'half', thresholds: FULL, legMinutes: { bike: 150, run: 100 } });
    expect(faster.fuel.bike?.totalCarbsG).toBe(175);
    expect(faster.fuel.run?.totalCarbsG).toBe(83);
  });
});

describe('buildRacePlan — missing thresholds', () => {
  it('falls back to an HR cap on the bike without FTP', () => {
    const p = plan({ distance: 'half', thresholds: { maxHr: 190 } });
    expect(p.bike?.power).toBeNull();
    expect(p.bike?.hrCap).toBe(152);
    expect(p.bike?.steps[0]?.target).toBe('por debajo de 140 ppm');
    expect(p.bike?.steps[1]?.text).toMatch(/Sin pasar de 152 ppm/);
    expect(p.summary).toBe('Bici hasta 152 ppm · carrera 156–163 ppm · 70 g/h');
    expect(p.missing).toEqual(['tu FTP', 'tu ritmo umbral', 'tu CSS']);
    expect(racePlanHint(p)).toBe('Añade tu FTP, tu ritmo umbral y tu CSS en Tú › Perfil para tener números en cada sector.');
  });

  it('guides by RPE and sensations with no thresholds at all', () => {
    const p = plan({ distance: 'olympic', thresholds: null });
    expect(p.swim?.targets).toEqual(['RPE 7–8']);
    expect(p.bike?.targets).toEqual(['RPE 7–8']);
    expect(p.bike?.steps[0]?.target).toBe('RPE 6–7');
    expect(p.run.targets).toEqual(['RPE 7–8']);
    expect(p.run.hrNote).toBeNull();
    expect(p.run.feel.length).toBeGreaterThan(10);
    expect(p.summary).toBe('Bici RPE 7–8 · carrera RPE 7–8 · 45 g/h');
    expect(p.missing).toEqual(['tu FTP', 'tu ritmo umbral', 'tu CSS', 'tu FC umbral o máxima']);
  });
});

describe('buildRacePlan — per distance', () => {
  it('sprint: water only, 5-minute bike edges and a hard last kilometre', () => {
    const p = plan({ distance: 'sprint', thresholds: FULL });
    expect(p.fuel.targetCarbsPerHour).toBe(0);
    expect(p.fuel.bike).toBeNull();
    expect(p.fuel.run).toBeNull();
    expect(p.bike?.steps.map((s) => s.label)).toEqual(["Primeros 5'", 'Bloque central', "Últimos 5'"]);
    expect(p.run.steps.map((s) => s.label)).toEqual(['Primer km', 'Km 1–4', 'Último km']);
    expect(p.run.steps[2]?.target).toBe('4:25–4:30 /km');
    expect(p.summary).toMatch(/· agua$/);
  });

  it('full: more carbs, walking the aid stations and a note for beginners', () => {
    const p = plan({ distance: 'full', thresholds: FULL, level: 'beginner' });
    expect(p.fuel.targetCarbsPerHour).toBe(80);
    expect(p.run.steps[1]?.text).toMatch(/avituallamiento/);
    expect(p.fuel.notes.some((n) => /60 g\/h/.test(n))).toBe(true);
    expect(p.bike?.steps[1]?.text).toContain('215 W');
  });

  it('a marathon has only the run and its fueling', () => {
    const p = plan({ distance: 'run_marathon', thresholds: FULL });
    expect(p.triathlon).toBe(false);
    expect(p.swim).toBeNull();
    expect(p.bike).toBeNull();
    expect(p.transitions).toBeNull();
    expect(p.missing).toEqual([]);
    expect(p.run.distance).toBe('42,2 km');
    expect(p.summary).toBe('Ritmo 4:46–5:02 /km · 50 g/h');
  });
});

describe('fueling intake schedule', () => {
  it('fuelingSchedule keeps its band-based behaviour on top of intakeSchedule', () => {
    const session = { sport: 'bike' as const, durationMin: 180, intensity: 'endurance' as const };
    expect(fuelingSchedule(session)).toEqual(intakeSchedule('bike', 180, { carbsPerHour: 75 }));
  });

  it('intakeSchedule needs carbs and a moving sport', () => {
    expect(intakeSchedule('bike', 120, { carbsPerHour: 0 })).toBeNull();
    expect(intakeSchedule('strength', 120, { carbsPerHour: 60 })).toBeNull();
    expect(intakeSchedule('run', 60, { carbsPerHour: 30, fluidMlPerHour: 600 })?.fluidMl).toBe(600);
  });
});
