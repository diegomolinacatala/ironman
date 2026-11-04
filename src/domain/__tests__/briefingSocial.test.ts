import { composeBriefing, type BriefingInput } from '../briefing';
import { NO_TOGETHER, togetherOf } from '../briefingSocial';
import { wordCount } from '../briefingSpeech';
import { addDays } from '../dates';
import type { JointParticipant } from '../types';
import { makeJoint, makeMetrics, makeWorkout } from './fixtures';

/** Tuesday. */
const TODAY = '2026-10-27';
const NOW = new Date(2026, 9, 27, 7, 0, 0);

const person = (userId: string, displayName: string, status: JointParticipant['status']): JointParticipant => ({
  userId,
  displayName,
  avatarUrl: null,
  status,
  workoutId: null,
});

const todayJoint = makeJoint({
  id: 'j-today',
  organizerId: 'david',
  date: TODAY,
  startTime: '07:30',
  title: 'Rodaje en el Retiro',
  location: 'Casa de Campo',
  participants: [person('david', 'David García', 'accepted'), person('me', 'Diego', 'accepted')],
});

const saturdayInvite = makeJoint({
  id: 'j-sat',
  organizerId: 'david',
  date: '2026-10-31',
  title: 'Tirada larga',
  status: 'proposed',
  participants: [person('david', 'David', 'accepted'), person('me', 'Diego', 'invited')],
});

function input(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    date: TODAY,
    name: 'Diego',
    metrics: [makeMetrics(TODAY, { sleepHours: 7.5, sleepScore: 82 })],
    todayWorkouts: [makeWorkout({ date: TODAY, title: 'Rodaje suave', durationMin: 50, startTime: '07:30', intensity: 'endurance' })],
    tomorrowWorkouts: [makeWorkout({ date: addDays(TODAY, 1), sport: 'swim', title: 'Técnica', durationMin: 45 })],
    race: null,
    now: NOW,
    ...overrides,
  };
}

describe('togetherOf', () => {
  it("keeps today's accepted quedadas with the partners' first names and unanswered invitations", () => {
    const t = togetherOf([saturdayInvite, todayJoint], 'me', TODAY);
    expect(t.today).toEqual([{ title: 'Rodaje en el Retiro', sport: 'run', startTime: '07:30', location: 'Casa de Campo', partners: ['David'] }]);
    expect(t.invitations).toEqual([{ date: '2026-10-31', title: 'Tirada larga', sport: 'run', from: 'David' }]);
    expect(t.invitationCount).toBe(1);
  });

  it('ignores cancelled, declined, past and far-away sessions', () => {
    const t = togetherOf(
      [
        makeJoint({ ...todayJoint, id: 'c', status: 'cancelled' }),
        makeJoint({ ...todayJoint, id: 'd', participants: [person('david', 'David', 'accepted'), person('me', 'Diego', 'declined')] }),
        makeJoint({ ...saturdayInvite, id: 'p', date: '2026-10-26' }),
        makeJoint({ ...saturdayInvite, id: 'f', date: '2026-11-20' }),
      ],
      'me',
      TODAY,
    );
    expect(t).toEqual(NO_TOGETHER);
  });
});

describe('composeBriefing with quedadas', () => {
  it('says nothing social without quedadas', () => {
    const script = composeBriefing(input({ social: { me: 'me', jointSessions: [] } })).script;
    expect(script).not.toMatch(/quedada|invitación|entrenas con/);
    expect(script).toBe(composeBriefing(input()).script);
  });

  it("speaks today's quedada (who, time, place) and a pending invitation in one sentence each", () => {
    const { script } = composeBriefing(input({ social: { me: 'me', jointSessions: [todayJoint, saturdayInvite] } }));
    expect(script).toContain('Hoy a las siete y media de la mañana entrenas con David: rodaje en el Retiro, en Casa de Campo.');
    expect(script).toContain('Tienes una invitación de David para el sábado: tirada larga.');
    expect(script).not.toContain('García');
    expect(script).not.toMatch(/\d/);
    expect(wordCount(script)).toBeLessThanOrEqual(200);
  });

  it('summarises several invitations and flags a quedada nobody has confirmed', () => {
    const mine = makeJoint({
      id: 'mine',
      organizerId: 'me',
      date: TODAY,
      startTime: null,
      title: 'Series 6x1000',
      sport: 'run',
      participants: [person('me', 'Diego', 'accepted'), person('david', 'David', 'invited')],
    });
    const tomorrow = makeJoint({ ...saturdayInvite, id: 'tm', date: addDays(TODAY, 1), organizerId: 'alex', title: 'Grupeta', participants: [person('alex', 'Álex', 'accepted'), person('me', 'Diego', 'invited')] });
    const { script } = composeBriefing(input({ social: { me: 'me', jointSessions: [mine, saturdayInvite, tomorrow] } }));
    expect(script).toContain('Hoy tienes una quedada: sesión de carrera, aunque aún no te la ha confirmado nadie.');
    expect(script).toContain('Tienes dos invitaciones a quedadas sin responder; la primera, de Álex para mañana: grupeta.');
  });

  it('dates invitations beyond this week in full', () => {
    const later = makeJoint({ ...saturdayInvite, id: 'l', date: '2026-11-07' });
    const { script } = composeBriefing(input({ social: { me: 'me', jointSessions: [later] } }));
    expect(script).toContain('Tienes una invitación de David para el sábado siete de noviembre: tirada larga.');
  });
});
