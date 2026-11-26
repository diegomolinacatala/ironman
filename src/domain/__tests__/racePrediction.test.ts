import { CDA_BY_LEVEL, bikeModelFor, flatSpeedKmh, flatSpeedMs, powerAtSpeed } from '../bikeSpeed';
import {
  centralLegMinutes,
  formatFinishRange,
  formatLegRange,
  predictRace,
  rideSpeedAtRaceHr,
  type PredictionOutcome,
  type RacePrediction,
  type RidePoint,
} from '../racePrediction';
import type { Thresholds } from '../types';

const FULL: Thresholds = { ftpW: 250, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 105, lthr: 170, maxHr: 190 };

function ok(outcome: PredictionOutcome | null): RacePrediction {
  if (!outcome?.ok) throw new Error('expected a prediction');
  return outcome.prediction;
}

describe('flat-course bike model', () => {
  const model = bikeModelFor('intermediate');

  it('documents the typical age-group assumptions', () => {
    expect(model).toEqual({ cdA: 0.32, crr: 0.005, massKg: 80, rho: 1.2, efficiency: 0.975 });
    expect(CDA_BY_LEVEL).toEqual({ beginner: 0.36, intermediate: 0.32, advanced: 0.28 });
    expect(bikeModelFor(null).cdA).toBe(0.32);
  });

  it('inverts the power equation', () => {
    for (const watts of [120, 200, 300]) {
      expect(powerAtSpeed(flatSpeedMs(watts, model), model)).toBeCloseTo(watts, 3);
    }
  });

  it('gives realistic flat speeds (≈ 33.7 km/h at 200 W with clip-ons)', () => {
    expect(flatSpeedKmh(200, model)).toBeCloseTo(33.75, 1);
    expect(flatSpeedKmh(200, bikeModelFor('advanced'))).toBeGreaterThan(flatSpeedKmh(200, model));
    expect(flatSpeedKmh(200, bikeModelFor('beginner'))).toBeLessThan(flatSpeedKmh(200, model));
    expect(flatSpeedKmh(0, model)).toBe(0);
  });
});

describe('predictRace — Media distancia with every threshold', () => {
  const p = ok(predictRace({ distance: 'half', thresholds: FULL, level: 'intermediate' }));

  it('swims at the plan effort plus open water', () => {
    // CSS 1:45 → effort 1:47–1:49 /100 m; +3–6 s and a 3 % longer course.
    expect(p.swim).toEqual({ min: 34.8, max: 37.5 });
    expect(p.swimEstimated).toBe(false);
  });

  it('rides the plan power band through the flat model, plus 4 % on the slow end', () => {
    expect(p.bikeSource).toBe('power');
    expect(p.bike?.min).toBeCloseTo(158.5, 0);
    expect(p.bike?.max).toBeCloseTo(169.7, 0);
  });

  it('runs the plan pace band, with a tough-day fade on the slow end', () => {
    expect(p.run).toEqual({ min: 102.7, max: 111.5 });
  });

  it('adds typical transitions and sums the legs', () => {
    expect(p.t1).toEqual({ min: 3, max: 6 });
    expect(p.t2).toEqual({ min: 2, max: 4 });
    expect(p.total.min).toBeCloseTo(301, 0);
    expect(p.total.max).toBeCloseTo(328.7, 0);
    expect(formatFinishRange(p.total)).toBe('5:01–5:29');
    expect(p.note).toBe('Supone recorrido llano, sin viento, y que sigues el plan.');
  });

  it('gives the middle of each leg to time the fueling', () => {
    expect(centralLegMinutes(p)).toEqual({ swim: 36, bike: 164, run: 107 });
  });

  it('fades more for a beginner', () => {
    const beginner = ok(predictRace({ distance: 'half', thresholds: FULL, level: 'beginner' }));
    expect(beginner.run.max).toBeGreaterThan(p.run.max);
    expect(beginner.bike?.min).toBeGreaterThan(p.bike?.min ?? 0);
  });
});

describe('predictRace — missing data', () => {
  const rides: RidePoint[] = [
    { date: '2026-11-01', durationMin: 90, distanceM: 48_000, avgHr: 145 },
    { date: '2026-11-08', durationMin: 120, distanceM: 62_000, avgHr: 148 },
    { date: '2026-11-15', durationMin: 60, distanceM: 30_000, avgHr: 142 },
    { date: '2026-11-16', durationMin: 60, distanceM: 40_000, avgHr: 170 },
    { date: '2026-11-17', durationMin: 30, distanceM: 15_000, avgHr: 145 },
  ];

  it('hides the prediction without FTP or threshold pace, saying what to add', () => {
    expect(predictRace({ distance: 'olympic', thresholds: {} })).toEqual({
      ok: false,
      missing: ['tu FTP', 'tu ritmo umbral'],
      hint: 'Para ver tu previsión, añade tu FTP y tu ritmo umbral en Tú › Perfil.',
    });
    expect(predictRace({ distance: 'half', thresholds: { runThresholdPaceSecPerKm: 270, lthr: 170 } })).toEqual({
      ok: false,
      missing: ['tu FTP'],
      hint: 'Para ver tu previsión, añade tu FTP en Tú › Perfil.',
    });
  });

  it('uses recent rides at a race-like heart rate when there is no FTP', () => {
    // Race bike HR for LTHR 170: 140–152 ppm → rides between 130 and 157 ppm, 45'+ and 15 km+ count.
    expect(rideSpeedAtRaceHr(rides, { min: 140, max: 152 })).toBe(31);
    const p = ok(predictRace({ distance: 'half', thresholds: { runThresholdPaceSecPerKm: 270, lthr: 170 }, recentRides: rides }));
    expect(p.bikeSource).toBe('rides');
    expect(p.bike).toEqual({ min: 174.2, max: 185.3 });
    expect(p.swimEstimated).toBe(true);
    expect(p.swim).toEqual({ min: 39.6, max: 44 });
    expect(p.note).toBe('Supone recorrido llano, sin viento, y que sigues el plan. Natación estimada sin CSS. Bici según tus salidas recientes.');
  });

  it('needs three rides at that heart rate', () => {
    expect(rideSpeedAtRaceHr(rides.slice(0, 2), { min: 140, max: 152 })).toBeNull();
  });

  it('has no prediction for a distance without known legs', () => {
    expect(predictRace({ distance: 'other', thresholds: FULL })).toBeNull();
  });
});

describe('predictRace — running races', () => {
  it('predicts a marathon from the threshold pace only', () => {
    const p = ok(predictRace({ distance: 'run_marathon', thresholds: { runThresholdPaceSecPerKm: 270 } }));
    expect(p.swim).toBeNull();
    expect(p.bike).toBeNull();
    expect(p.total).toEqual(p.run);
    expect(formatFinishRange(p.total)).toBe('3:21–3:45');
    expect(p.note).toBe('Supone recorrido llano y que sigues el plan.');
  });
});

describe('time formats', () => {
  it('formats the finish as h:mm, or m:ss under an hour', () => {
    expect(formatFinishRange({ min: 301, max: 328.7 })).toBe('5:01–5:29');
    expect(formatFinishRange({ min: 23.5, max: 24.9 })).toBe('23:30–24:54');
  });

  it('formats legs in minutes or h:mm', () => {
    expect(formatLegRange({ min: 34.8, max: 37.5 })).toBe("35–38'");
    expect(formatLegRange({ min: 158.4, max: 169.7 })).toBe('2:38–2:50');
    expect(formatLegRange({ min: 55, max: 64 })).toBe("55'–1:04");
    expect(formatLegRange({ min: 1.5, max: 3 })).toBe("2–3'");
    expect(formatLegRange({ min: 3, max: 3 })).toBe("3'");
  });
});
