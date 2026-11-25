import { buildSession } from '../sessions';
import { toZwo, zwoFileName } from '../zwo';
import { makeWorkout } from './fixtures';

function bike(code: 'BK_THR' | 'BK_END', ftpW?: number) {
  const built = buildSession({ code, durationMin: 60, priority: 1 }, { thresholds: ftpW ? { ftpW } : {} });
  return makeWorkout({
    sport: 'bike',
    title: code === 'BK_THR' ? "Umbral 3×8' <rodillo> & más" : 'Rodaje Z2',
    intensity: code === 'BK_THR' ? 'threshold' : 'endurance',
    durationMin: 60,
    steps: built.steps,
    coaching: built.coaching,
  });
}

describe('toZwo', () => {
  test('a threshold session: warm-up ramp, intervals as IntervalsT, cool-down ramp, power as FTP fraction', () => {
    const xml = toZwo(bike('BK_THR', 250), { ftpW: 250 }) ?? '';
    expect(xml).toMatch(/^<workout_file>/);
    expect(xml).toContain('<sportType>bike</sportType>');
    expect(xml).toMatch(/<Warmup Duration="\d+" PowerLow="0\.\d\d" PowerHigh="0\.\d\d"\/>/);
    const interval = /<IntervalsT Repeat="(\d+)" OnDuration="(\d+)" OffDuration="(\d+)" OnPower="([\d.]+)" OffPower="([\d.]+)"\/>/.exec(xml);
    expect(interval).not.toBeNull();
    const onPower = Number(interval?.[4]);
    expect(onPower).toBeGreaterThanOrEqual(0.9);
    expect(onPower).toBeLessThanOrEqual(1.05);
    expect(Number(interval?.[5])).toBeLessThan(0.65);
    expect(xml).toMatch(/<Cooldown Duration="\d+"/);
    // Titles are escaped.
    expect(xml).toContain('<name>Umbral 3×8&apos; &lt;rodillo&gt; &amp; más</name>');
  });

  test('without FTP the zones still give fractions (same as with one)', () => {
    const withFtp = toZwo(bike('BK_THR'), { ftpW: 250 }) ?? '';
    const without = toZwo(bike('BK_THR'), null) ?? '';
    const on = (xml: string) => Number(/OnPower="([\d.]+)"/.exec(xml)?.[1]);
    expect(Math.abs(on(withFtp) - on(without))).toBeLessThanOrEqual(0.02);
  });

  test('total duration matches the plan', () => {
    const xml = toZwo(bike('BK_END', 250), { ftpW: 250 }) ?? '';
    const secs = [...xml.matchAll(/Duration="(\d+)"/g)].reduce((s, m) => s + Number(m[1]), 0);
    const intervals = [...xml.matchAll(/Repeat="(\d+)" OnDuration="(\d+)" OffDuration="(\d+)"/g)].reduce(
      (s, m) => s + Number(m[1]) * (Number(m[2]) + Number(m[3])) - Number(m[2]) - Number(m[3]),
      0,
    );
    expect(Math.round((secs + intervals) / 60)).toBe(60);
  });

  test('only bike sessions with timed steps', () => {
    expect(toZwo(makeWorkout({ sport: 'run', steps: [{ kind: 'work', durationMin: 30 }] }), null)).toBeNull();
    expect(toZwo(makeWorkout({ sport: 'bike', steps: [{ kind: 'work', distanceM: 20000 }] }), null)).toBeNull();
  });

  test('file names', () => {
    expect(zwoFileName("Series umbral 3×8'")).toBe('series-umbral-3x8.zwo');
    expect(zwoFileName('¡¡!!')).toBe('entreno.zwo');
  });
});
