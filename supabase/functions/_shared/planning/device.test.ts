import assert from 'node:assert/strict';
import test from 'node:test';
import { workout } from '../testing/fakes.ts';
import type { WorkoutStep } from '../types.ts';
import { toNeutralWorkouts } from './device-neutral.ts';
import type { NeutralStep } from './device-neutral.ts';
import { deviceLegs, groupSteps } from './device-plan.ts';
import { toGarminWorkouts } from './device.ts';

const THRESHOLDS = { ftpW: 250, lthr: 170, maxHr: 190, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 100 };

const INTERVALS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15, intensity: 'recovery' },
  { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Solo palabras sueltas' },
  { kind: 'recovery', durationMin: 3, repeat: 3, intensity: 'recovery' },
  { kind: 'cooldown', durationMin: 7, intensity: 'recovery' },
];

type GarminStep = Record<string, unknown> & { steps?: Record<string, unknown>[] };
const garminSteps = (w: Record<string, unknown>): GarminStep[] => (w.segments as { steps: GarminStep[] }[])[0].steps;

test('interval sets become ONE repeat block (work + recovery sharing repeat); a new work after the recovery starts a new set', () => {
  const blocks = groupSteps(INTERVALS);
  assert.deepEqual(blocks.map((b) => (b.type === 'repeat' ? `${b.times}×[${b.steps.map((s) => s.kind).join(',')}]` : b.step.kind)), [
    'warmup',
    '3×[work,recovery]',
    'cooldown',
  ]);
  const two = groupSteps([
    { kind: 'work', durationMin: 4, repeat: 3, intensity: 'vo2' },
    { kind: 'recovery', durationMin: 2, repeat: 3 },
    { kind: 'work', durationMin: 1, repeat: 3, intensity: 'vo2' },
    { kind: 'recovery', durationMin: 1, repeat: 3 },
  ]);
  assert.equal(two.length, 2);
  assert.ok(two.every((b) => b.type === 'repeat' && b.steps.every((s) => s.repeat === undefined)));
});

test('Garmin JSON: one repeat step with work and recovery, explicit step targets first, zones otherwise', () => {
  const steps: WorkoutStep[] = [
    INTERVALS[0],
    { ...INTERVALS[1], target: { hr: { min: 160, max: 165 } } },
    INTERVALS[2],
    INTERVALS[3],
  ];
  const [run] = toGarminWorkouts(workout({ sport: 'run', intensity: 'threshold', durationMin: 55, steps }), THRESHOLDS);
  const top = garminSteps(run);
  assert.deepEqual(top.map((s) => s.type), ['WorkoutStep', 'WorkoutRepeatStep', 'WorkoutStep']);
  assert.equal(top[1].repeatValue, 3);
  const [work, recovery] = top[1].steps ?? [];
  assert.deepEqual([work.intensity, work.durationValue, work.targetType, work.targetValueLow, work.targetValueHigh], ['ACTIVE', 480, 'HEART_RATE', 160, 165]);
  assert.match(String(work.description), /4:27–4:44 \/km · RPE 7–8 · Solo palabras sueltas/);
  assert.deepEqual([recovery.intensity, recovery.durationValue, recovery.targetType], ['RECOVERY', 180, 'HEART_RATE']);
  assert.equal(run.estimatedDurationInSecs, (15 + 3 * 11 + 7) * 60);
});

test('brick legs follow the steps (leg) and get their own sport and targets', () => {
  const brick = workout({
    sport: 'brick',
    intensity: 'race',
    durationMin: 100,
    steps: [
      { kind: 'warmup', durationMin: 10, intensity: 'recovery', leg: 'bike' },
      { kind: 'work', durationMin: 60, intensity: 'race' },
      { kind: 'work', durationMin: 25, intensity: 'race', leg: 'run' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery' },
    ],
  });
  const legs = deviceLegs(brick);
  assert.deepEqual(legs.map((l) => [l.sport, l.durationMin, l.steps.length]), [['bike', 70, 2], ['run', 30, 2]]);
  const [bike, run] = toGarminWorkouts(brick, THRESHOLDS, { raceDistance: 'half' });
  assert.equal(bike.sport, 'CYCLING');
  assert.equal(garminSteps(bike)[1].targetType, 'POWER');
  assert.equal(run.sport, 'RUNNING');
  assert.equal(garminSteps(run)[0].targetType, 'HEART_RATE');
  assert.match(String(run.workoutName), / · carrera$/);
  assert.equal(deviceLegs(workout({ sport: 'brick', durationMin: 120 })).map((l) => l.durationMin).join('+'), '90+30', 'no legs: 75 % bike');
});

test('COROS steps: ppm and % of threshold HR, whole-second pace, watts, RPE; swim and strength by hand', () => {
  const [run] = toNeutralWorkouts(workout({ sport: 'run', intensity: 'threshold', durationMin: 55, steps: INTERVALS }), THRESHOLDS);
  assert.equal(run.coros, 'connector');
  const set = run.steps[1];
  assert.ok('times' in set && set.type === 'repeat');
  const work = set.steps[0];
  assert.deepEqual(work, {
    type: 'work',
    durationSec: 480,
    zone: 'Z4',
    hrBpm: [162, 168],
    hrPctLthr: [95, 99],
    paceSecPerKm: [267, 284],
    pace: '4:27–4:44 /km',
    rpe: [7, 8],
    cue: 'Solo palabras sueltas',
  } satisfies NeutralStep);
  const [bike] = toNeutralWorkouts(workout({ sport: 'bike', intensity: 'endurance', durationMin: 90 }), THRESHOLDS);
  assert.ok((bike.steps[1] as NeutralStep).powerW);
  const [swim] = toNeutralWorkouts(workout({ sport: 'swim', durationMin: 45, steps: [{ kind: 'work', distanceM: 100, repeat: 10, intensity: 'threshold' }] }), THRESHOLDS);
  assert.equal(swim.coros, 'manual');
  assert.match(swim.corosNote ?? '', /créalo a mano en COROS/);
  const swimSet = swim.steps[0];
  assert.ok(swimSet.type === 'repeat' && 'times' in swimSet);
  assert.deepEqual([swimSet.times, swimSet.steps[0].distanceM, swimSet.steps[0].paceSecPer100m, swimSet.steps[0].hrBpm], [10, 100, [99, 103], undefined]);
  assert.equal(toNeutralWorkouts(workout({ sport: 'strength', durationMin: 40 }), THRESHOLDS)[0].coros, 'manual');
  const noLthr = toNeutralWorkouts(workout({ sport: 'run', durationMin: 40 }), { maxHr: 190 })[0].steps[1] as NeutralStep;
  assert.ok(noLthr.hrPctMax && !noLthr.hrPctLthr, 'without LTHR, % of max HR');
});
