/**
 * The forecast inside the AI paths: the morning briefing gets a `weather` block only when one of
 * today's outdoor sessions falls in the rain; the coach gets the coming week (and the prompt says
 * how to use it). Both work exactly as before without a city or when the provider fails.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBriefingContext, promptPayload } from '../briefing/context.ts';
import { generateBriefing } from '../briefing/service.ts';
import { runCoachJob } from '../coach/job.ts';
import { buildCoachMessages } from '../coach/messages.ts';
import { messageText } from '../coach/ports.ts';
import type { ClaudeRequest } from '../coach/ports.ts';
import { COACH_SYSTEM_PROMPT } from '../coach/prompt.ts';
import { buildPlanningContext } from '../planning/context.ts';
import { BRIEFING_SYSTEM_PROMPT } from '../briefing/prompt.ts';
import { silentLogger } from '../log.ts';
import type { WeatherForecast } from '../planning/domain/weather.ts';
import { briefingRecorder, usageRecorder } from '../testing/ai-fakes.ts';
import { claudeReturning, coachJob, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { emptyState, fakeStore, fixedNow, USER, workout } from '../testing/fakes.ts';
import type { WeatherReader } from './service.ts';

const DATE = '2026-10-24';

function forecastWith(rain: Record<string, (h: number) => number>): WeatherForecast {
  const hours = Object.entries(rain).flatMap(([date, mm]) =>
    Array.from({ length: 24 }, (_, hour) => ({ date, hour, tempC: 14, windKmh: 12, precipMm: mm(hour), precipProb: null, symbol: mm(hour) > 0 ? 'rain' : 'fair_day', coarse: false })),
  );
  return { place: 'Valencia', source: 'met_norway', updatedAt: '2026-10-24T06:00:00Z', hours };
}

const evening = (h: number) => (h >= 17 && h < 21 ? 1.5 : 0);
const reader = (forecast: WeatherForecast | null): WeatherReader => ({ forecastFor: async () => forecast });

function stateWithRun(startTime = '18:00') {
  const state = emptyState();
  state.workouts.push(workout({ date: DATE, startTime, title: 'Rodaje suave', durationMin: 50 }));
  return state;
}

test('briefing context: weather only when today’s outdoor session falls in the rain, after the hours gone', async () => {
  const forecast = forecastWith({ [DATE]: evening });
  const ctx = await buildBriefingContext(fakeStore(stateWithRun()), { userId: USER, date: DATE, now: fixedNow(), forecast });
  // 10:00Z is 12:00 in Madrid: the dry stretch starts now, not at 07:00.
  assert.deepEqual(promptPayload(ctx).weather, {
    place: 'Valencia',
    source: 'MET Norway',
    sessions: [{ title: 'Rodaje suave', startTime: '18:00', rain: 'a las 18', dryGap: 'entre las 12 y las 17', advice: 'Sal a correr entre las 12 y las 17: no llueve' }],
  });
  const dry = await buildBriefingContext(fakeStore(stateWithRun('13:00')), { userId: USER, date: DATE, now: fixedNow(), forecast });
  assert.equal('weather' in promptPayload(dry), false);
  const noCity = await buildBriefingContext(fakeStore(stateWithRun()), { userId: USER, date: DATE, now: fixedNow() });
  assert.equal('weather' in promptPayload(noCity), false);
});

test('generateBriefing sends the weather to the model and still works when the reader fails', async () => {
  const seen: ClaudeRequest[] = [];
  const script = [
    'Buenos días, Diego. Hoy toca un rodaje suave de cincuenta minutos a las seis de la tarde para sumar fondo sin cansarte.',
    'Ojo, a las seis de la tarde llueve: sal a correr entre las doce y las cinco, que no llueve.',
    'Rueda cómodo, pudiendo hablar, y bebe agua al terminar. ¡Vamos a por ello!',
  ].join(' ');
  const output = { headline: 'Hoy rodaje suave 50', sleep_verdict: 'unknown', sleep_summary: 'Sin datos de sueño.', script, focus: 'Rueda suave y en seco.' };
  const deps = {
    reader: fakeStore(stateWithRun()),
    briefings: briefingRecorder().store,
    usage: usageRecorder().store,
    claude: claudeReturning({ text: JSON.stringify(output) }, seen),
    garmin: null,
    now: fixedNow,
    logger: silentLogger,
    weather: reader(forecastWith({ [DATE]: evening })),
  };
  await generateBriefing(deps, USER, DATE, 1);
  assert.match(messageText(seen[0].messages[0]), /"weather":\{"place":"Valencia".*"advice":"Sal a correr entre las 12 y las 17: no llueve"/);
  const failing = { ...deps, weather: { forecastFor: async () => Promise.reject(new Error('MET down')) } };
  await generateBriefing(failing, USER, DATE, 2);
  assert.equal(messageText(seen[1].messages[0]).includes('"weather"'), false);
  assert.match(BRIEFING_SYSTEM_PROMPT, /Si no hay weather, no hables del tiempo/);
});

test('coach messages carry the coming week of weather; the job reads it through the reader', async () => {
  const context = await buildPlanningContext(fakeStore(stateWithWeek()), { userId: USER, weekStart: '2026-10-26', now: fixedNow(), detail: 'concise' });
  const weather = { place: 'Valencia', source: 'MET Norway', days: [{ date: '2026-10-27', summary: 'lluvia casi todo el día', dryGaps: [] }] };
  const [withWeather] = buildCoachMessages(coachJob({ mode: 'chat', message: '¿Cuándo salgo a correr esta semana?' }).request, context, { weather });
  assert.match(messageText(withWeather), /El tiempo en su ciudad \(MET Norway;.*"summary":"lluvia casi todo el día"/s);
  const [without] = buildCoachMessages(coachJob().request, context, {});
  assert.equal(messageText(without).includes('El tiempo en su ciudad'), false);
  assert.match(COACH_SYSTEM_PROMPT, /dryGaps/);

  const seen: ClaudeRequest[] = [];
  const emptyOutput = JSON.stringify({ reply: 'Ok', summary: '', changes: [] });
  const forecast = forecastWith({ '2026-10-24': () => 0, '2026-10-25': evening });
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: runningRecorder().store, claude: claudeReturning({ text: emptyOutput }, seen), now: fixedNow, logger: silentLogger, weather: reader(forecast) },
    coachJob({ mode: 'chat', message: '¿Cuándo salgo a correr?' }),
  );
  const sent = seen[0].messages.map(messageText).join('\n');
  assert.match(sent, /"weekday":"domingo","summary":"lluvia entre las 17 y las 21; seco entre las 7 y las 17"/);

  const quiet: ClaudeRequest[] = [];
  await runCoachJob(
    { reader: fakeStore(stateWithWeek()), store: runningRecorder().store, claude: claudeReturning({ text: emptyOutput }, quiet), now: fixedNow, logger: silentLogger, weather: reader(null) },
    coachJob({ mode: 'chat', message: 'Hola' }),
  );
  assert.equal(quiet[0].messages.map(messageText).join('\n').includes('El tiempo en su ciudad'), false);
});
