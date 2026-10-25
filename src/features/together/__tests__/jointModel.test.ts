import { describe, expect, test } from '@jest/globals';

import {
  isOrganizer,
  isPendingInviteForMe,
  myParticipant,
  otherParticipants,
  participantStatusCopy,
  sessionStatusCopy,
  sessionTimeLabel,
  splitSessions,
  withNames,
} from '../jointModel';

import { ALEX, jointSession, ME, participant } from './fixtures';

const TODAY = '2026-10-25';

describe('copy', () => {
  test('participant and session statuses always carry an icon', () => {
    expect(participantStatusCopy('invited')).toEqual({ label: 'Invitado', tone: 'info', icon: 'clock' });
    expect(participantStatusCopy('accepted').label).toBe('Acepta');
    expect(participantStatusCopy('declined').label).toBe('Rechaza');
    expect(sessionStatusCopy('confirmed').icon).toBe('checkCircle');
    expect(sessionStatusCopy('cancelled').label).toBe('Cancelada');
  });

  test('time label', () => {
    expect(sessionTimeLabel({ startTime: '09:00', durationMin: 90 })).toBe('09:00–10:30');
    expect(sessionTimeLabel({ startTime: null, durationMin: 90 })).toBe('Hora por decidir');
  });

  test('withNames joins names in Spanish', () => {
    expect(withNames([])).toBe('');
    expect(withNames([participant({ displayName: 'Álex' })])).toBe('Álex');
    expect(withNames([participant({ displayName: 'Álex' }), participant({ displayName: 'Marta' }), participant({ displayName: 'Iván' })])).toBe(
      'Álex, Marta y Iván',
    );
  });
});

describe('roles', () => {
  const session = jointSession();

  test('detects my participation and pending invite', () => {
    expect(myParticipant(session, ME)?.status).toBe('invited');
    expect(myParticipant(session, null)).toBeNull();
    expect(isOrganizer(session, ALEX)).toBe(true);
    expect(isPendingInviteForMe(session, ME)).toBe(true);
    expect(isPendingInviteForMe(session, ALEX)).toBe(false);
    expect(isPendingInviteForMe({ ...session, status: 'cancelled' }, ME)).toBe(false);
    expect(otherParticipants(session, ME).map((p) => p.userId)).toEqual([ALEX]);
  });
});

describe('splitSessions', () => {
  test('puts my invites first and hides past, cancelled and declined sessions', () => {
    const invite = jointSession({ id: 'invite', date: '2026-10-31' });
    const confirmed = jointSession({
      id: 'confirmed',
      date: '2026-10-27',
      status: 'confirmed',
      participants: [participant({ userId: ALEX }), participant({ userId: ME, status: 'accepted' })],
    });
    const later = jointSession({ id: 'later', date: '2026-10-27', startTime: null, organizerId: ME, participants: [participant({ userId: ME })] });
    const past = jointSession({ id: 'past', date: '2026-10-20' });
    const cancelled = jointSession({ id: 'cancelled', status: 'cancelled' });
    const declined = jointSession({ id: 'declined', participants: [participant({ userId: ALEX }), participant({ userId: ME, status: 'declined' })] });
    const { invites, upcoming } = splitSessions([later, invite, past, cancelled, declined, confirmed], ME, TODAY);
    expect(invites.map((s) => s.id)).toEqual(['invite']);
    expect(upcoming.map((s) => s.id)).toEqual(['confirmed', 'later']);
  });

  test('handles missing data', () => {
    expect(splitSessions(undefined, ME, TODAY)).toEqual({ invites: [], upcoming: [] });
  });
});
