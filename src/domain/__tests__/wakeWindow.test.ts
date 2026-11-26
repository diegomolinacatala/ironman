import {
  ASLEEP_HOLD_MIN,
  DEFAULT_WAKE_DELAY,
  LATE_LIMIT_MIN,
  WAKE_DELAYS,
  clockMinutes,
  clockText,
  decideWake,
  defaultWindow,
  fallbackMinutes,
  fixedMinutesOf,
  isMorningWake,
  learnWakeWindows,
  morningModeOf,
  overrideWindow,
  wakeDelayOf,
  wakeWindowFor,
  type LocalWake,
  type WakeCheck,
} from '../wakeWindow';

const TODAY = '2026-11-26'; // Thursday

/** One wake-up per day from 5 to 25 Nov: weekdays at `weekday`, weekends at `weekend` ('HH:mm'). */
function wakes(weekday: string, weekend: string, from = 5): LocalWake[] {
  const out: LocalWake[] = [];
  for (let day = from; day <= 25; day += 1) {
    const date = `2026-11-${String(day).padStart(2, '0')}`;
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    out.push({ date, minutes: clockMinutes(dow === 0 || dow === 6 ? weekend : weekday) ?? 0 });
  }
  return out;
}

describe('learnWakeWindows', () => {
  it('learns separate weekday and weekend windows: earliest − 30 min to latest + 60 min', () => {
    const later = clockMinutes('07:00') ?? 0;
    const history = [...wakes('06:40', '08:30'), { date: '2026-11-17', minutes: later }, { date: '2026-11-24', minutes: later }];
    const learned = learnWakeWindows(history, TODAY);
    // 15 weekday nights: the latest of each date counts; one 07:00 survives the trimming below.
    expect(learned.weekday).toEqual({ from: clockMinutes('06:10'), to: clockMinutes('08:00') });
    expect(learned.weekend).toEqual({ from: clockMinutes('08:00'), to: clockMinutes('09:30') });
    expect(learned.nights).toBe(21);
  });

  it('drops the earliest and latest night when there are enough (a race day, a late party)', () => {
    const raceDay = { date: '2026-11-05', minutes: clockMinutes('04:30') ?? 0 };
    const learned = learnWakeWindows([...wakes('07:00', '08:00', 6), raceDay], TODAY);
    expect(learned.weekday).toEqual({ from: clockMinutes('06:30'), to: clockMinutes('08:00') });
  });

  it('uses the all-days window when the weekend has too few nights, and nothing with under four nights', () => {
    const weekdaysOnly = wakes('06:30', '06:30').filter((w) => ![0, 6].includes(new Date(`${w.date}T12:00:00Z`).getUTCDay()));
    const learned = learnWakeWindows(weekdaysOnly, TODAY);
    expect(learned.weekend).toEqual(learned.weekday);
    expect(learnWakeWindows(weekdaysOnly.slice(0, 3), TODAY)).toEqual({ weekday: null, weekend: null, nights: 3 });
  });

  it('ignores today, nights older than three weeks and wake-ups outside 03:00–13:00', () => {
    const learned = learnWakeWindows(
      [
        { date: TODAY, minutes: 300 },
        { date: '2026-10-30', minutes: 420 },
        { date: '2026-11-20', minutes: 14 * 60 },
        { date: '2026-11-19', minutes: 60 },
      ],
      TODAY,
    );
    expect(learned.nights).toBe(0);
  });
});

describe('the window that applies', () => {
  const learned = learnWakeWindows(wakes('06:40', '08:30'), TODAY);

  it('your own window wins, then the learned one for that kind of day, then the default', () => {
    const override = overrideWindow({ from: '05:00', to: '06:00' });
    expect(wakeWindowFor(TODAY, { learned, override, fixedMinutes: 450 })).toEqual({ window: { from: 300, to: 360 }, source: 'override' });
    expect(wakeWindowFor('2026-11-28', { learned, override: null, fixedMinutes: 450 }).window).toEqual(learned.weekend);
    expect(wakeWindowFor(TODAY, { learned: { weekday: null, weekend: null, nights: 0 }, override: null, fixedMinutes: 450 })).toEqual({
      window: { from: 330, to: 450 },
      source: 'default',
    });
  });

  it('rejects an inverted or malformed window of your own', () => {
    expect(overrideWindow({ from: '08:00', to: '07:00' })).toBeNull();
    expect(overrideWindow({ from: '7:00', to: '08:00' })).toBeNull();
    expect(overrideWindow(null)).toBeNull();
  });

  it('falls back at the window end or the fixed time, whichever is later', () => {
    expect(fallbackMinutes({ from: 370, to: 480 }, 450)).toBe(480);
    expect(fallbackMinutes({ from: 300, to: 360 }, 450)).toBe(450);
    expect(defaultWindow(4 * 60)).toEqual({ from: 240, to: 270 });
  });
});

describe('prefs helpers', () => {
  it('defaults: fixed mode, 15 min, 07:30', () => {
    expect(WAKE_DELAYS).toEqual([5, 10, 15, 30]);
    expect(DEFAULT_WAKE_DELAY).toBe(15);
    expect(morningModeOf({})).toBe('fixed');
    expect(morningModeOf({ morningMode: 'wake' })).toBe('wake');
    expect(wakeDelayOf({ wakeDelayMin: 10 })).toBe(10);
    expect(wakeDelayOf({ wakeDelayMin: 7 })).toBe(15);
    expect(fixedMinutesOf({ morningTime: '06:45' })).toBe(405);
    expect(fixedMinutesOf({ morningTime: null })).toBe(450);
    expect(clockText(405)).toBe('06:45');
    expect(isMorningWake(179)).toBe(false);
    expect(isMorningWake(180)).toBe(true);
  });
});

describe('decideWake', () => {
  const base: WakeCheck = { nowMinutes: 400, window: { from: 370, to: 480 }, fallbackAt: 480, delayMin: 15, wake: null, stillAsleep: false };

  it('waits before the window and looks inside it', () => {
    expect(decideWake({ ...base, nowMinutes: 360 })).toEqual({ action: 'wait', reason: 'before_window' });
    expect(decideWake(base)).toEqual({ action: 'check' });
  });

  it('sends the delay after the wake-up — also a wake-up before the window, once known', () => {
    expect(decideWake({ ...base, wake: 395, nowMinutes: 405 })).toEqual({ action: 'wait', reason: 'due_later' });
    expect(decideWake({ ...base, wake: 395, nowMinutes: 410 })).toEqual({ action: 'send', reason: 'wake', dueMinutes: 410 });
    expect(decideWake({ ...base, wake: 300, nowMinutes: 372 })).toEqual({ action: 'send', reason: 'wake', dueMinutes: 315 });
  });

  it('falls back at the fallback time, holds while still asleep, never sends hours late', () => {
    expect(decideWake({ ...base, nowMinutes: 480 })).toEqual({ action: 'send', reason: 'fallback', dueMinutes: 480 });
    expect(decideWake({ ...base, nowMinutes: 500, stillAsleep: true })).toEqual({ action: 'wait', reason: 'asleep' });
    expect(decideWake({ ...base, nowMinutes: 480 + ASLEEP_HOLD_MIN, stillAsleep: true })).toEqual({ action: 'wait', reason: 'too_late' });
    expect(decideWake({ ...base, nowMinutes: 480 + LATE_LIMIT_MIN })).toEqual({ action: 'wait', reason: 'too_late' });
    expect(decideWake({ ...base, wake: 395, nowMinutes: 480 + LATE_LIMIT_MIN })).toEqual({ action: 'wait', reason: 'too_late' });
  });

  it('ignores a "wake-up" in the middle of the night', () => {
    expect(decideWake({ ...base, wake: 90, nowMinutes: 400 })).toEqual({ action: 'check' });
  });
});
