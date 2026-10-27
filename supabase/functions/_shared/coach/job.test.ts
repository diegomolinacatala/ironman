import assert from 'node:assert/strict';
import test from 'node:test';
import { silentLogger } from '../log.ts';
import { fakeStore, fixedNow, USER } from '../testing/fakes.ts';
import { claudeReturning, coachJob as job, runningRecorder, stateWithWeek } from '../testing/coach-fakes.ts';
import { COACH_DEADLINE_MS, isAbortLike, TIMEOUT_MESSAGE, withDeadline } from './deadline.ts';
import { runCoachJob } from './job.ts';
import { CoachAiError, messageText } from './ports.ts';
import type { ClaudePort, ClaudeRequest, ClaudeResponse } from './ports.ts';
import { billedTokens } from './usage.ts';

const emptyOutput = JSON.stringify({ reply: 'Ok', summary: '', changes: [] });

test('the AI context never includes busy-block titles (only start/end)', async () => {
  const state = stateWithWeek();
  state.busy.push({ id: 'b1', userId: USER, start: '2026-10-27T08:00:00.000Z', end: '2026-10-27T09:00:00.000Z', title: 'Psicólogo' });
  const rec = runningRecorder();
  const seen: ClaudeRequest[] = [];
  await runCoachJob(
    { reader: fakeStore(state), store: rec.store, claude: claudeReturning({ text: emptyOutput }, seen), now: fixedNow, logger: silentLogger },
    job({ mode: 'plan_week' }),
  );
  const sent = seen[0].messages.map(messageText).join('\n');
  assert.ok(sent.includes('"busy":[{"date":"2026-10-27","start":"09:00","end":"10:00"}]'));
  assert.ok(!sent.includes('Psicólogo'));
});

test('runCoachJob aborts a hanging Claude call at the deadline and marks the job as failed', async () => {
  const rec = runningRecorder();
  let signal: AbortSignal | undefined;
  const hanging: ClaudePort = {
    generate: (req) => {
      signal = req.signal;
      return new Promise<ClaudeResponse>(() => undefined);
    },
  };
  await runCoachJob({ reader: fakeStore(stateWithWeek()), store: rec.store, claude: hanging, now: fixedNow, logger: silentLogger, deadlineMs: 20 }, job());
  assert.equal(rec.jobs[0].status, 'error');
  assert.equal(rec.jobs[0].error, TIMEOUT_MESSAGE);
  assert.equal(signal?.aborted, true, 'the stream is aborted, not left running');
  assert.equal(rec.proposals.length, 0);
  assert.equal(rec.usage.length, 0);
  assert.ok(COACH_DEADLINE_MS <= 120_000, 'well below the 150 s Edge wall clock');
});

test('an abort error from the port ends the job with the timeout message', async () => {
  const rec = runningRecorder();
  const aborting: ClaudePort = { generate: async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) };
  await runCoachJob({ reader: fakeStore(stateWithWeek()), store: rec.store, claude: aborting, now: fixedNow, logger: silentLogger }, job());
  assert.equal(rec.jobs[0].error, TIMEOUT_MESSAGE);
  assert.equal(isAbortLike({ name: 'APIUserAbortError' }), true);
  assert.equal(isAbortLike({ name: 'TimeoutError' }), true);
  assert.equal(isAbortLike(new Error('x')), false);
  assert.equal(isAbortLike(null), false);
});

test('a job already closed elsewhere is not overwritten (finish/fail only while running)', async () => {
  const rec = runningRecorder();
  rec.jobs = [{ id: 'job-1', status: 'error', error: 'cerrado al apagar el worker' }];
  await runCoachJob({ reader: fakeStore(stateWithWeek()), store: rec.store, claude: claudeReturning({ text: emptyOutput }), now: fixedNow, logger: silentLogger }, job({ mode: 'chat' }));
  assert.deepEqual(rec.jobs, [{ id: 'job-1', status: 'error', error: 'cerrado al apagar el worker' }]);
});

test('withDeadline rejects as soon as the signal aborts and passes values through otherwise', async () => {
  const controller = new AbortController();
  const pending = withDeadline(new Promise(() => undefined), controller.signal);
  controller.abort();
  await assert.rejects(pending, (e: unknown) => e instanceof CoachAiError && e.code === 'timeout');
  await assert.rejects(withDeadline(Promise.resolve(1), controller.signal), (e: unknown) => e instanceof CoachAiError && e.code === 'timeout');
  assert.equal(await withDeadline(Promise.resolve(7), new AbortController().signal), 7);
  await assert.rejects(withDeadline(Promise.reject(new Error('boom')), new AbortController().signal), /boom/);
});

test('billedTokens sums every attempt when a fallback served the response', () => {
  const withFallback = billedTokens({
    input_tokens: 900,
    output_tokens: 150,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 100,
    iterations: [
      { type: 'message', input_tokens: 1000, output_tokens: 3000, cache_creation_input_tokens: 200, cache_read_input_tokens: 0 },
      { type: 'compaction', input_tokens: 5000, output_tokens: 500 },
      { type: 'fallback_message', input_tokens: 900, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 },
    ],
  });
  assert.deepEqual(withFallback, { inputTokens: 2200, outputTokens: 3150, fallbackUsed: true });
});

test('billedTokens falls back to the top-level usage without iterations', () => {
  const plain = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 };
  assert.deepEqual(billedTokens({ ...plain, iterations: null }), { inputTokens: 15, outputTokens: 5, fallbackUsed: false });
  assert.deepEqual(billedTokens({ ...plain, iterations: [{ type: 'compaction', input_tokens: 1, output_tokens: 1 }] }), { inputTokens: 15, outputTokens: 5, fallbackUsed: false });
  assert.deepEqual(billedTokens({ input_tokens: 4, output_tokens: 1 }), { inputTokens: 4, outputTokens: 1, fallbackUsed: false });
});
