/** Test fixtures for the Juntos / social features (not a test file). */
import type {
  AppNotification,
  BusyBlock,
  FeedItem,
  Friend,
  FriendWeekItem,
  JointParticipant,
  JointSession,
  Workout,
} from '@/domain/types';

export const ME = 'user-me';
export const ALEX = 'user-alex';

export function workout(patch: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    userId: ME,
    date: '2026-10-27',
    startTime: '18:00',
    sport: 'run',
    title: 'Rodaje Z2',
    description: null,
    durationMin: 60,
    distanceM: null,
    intensity: 'endurance',
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'manual',
    isKey: false,
    jointSessionId: null,
    externalId: null,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T10:00:00Z',
    ...patch,
  };
}

export function friendItem(patch: Partial<FriendWeekItem> = {}): FriendWeekItem {
  return {
    kind: 'workout',
    id: 'fi1',
    date: '2026-10-27',
    startTime: '07:00',
    endTime: null,
    durationMin: 45,
    sport: 'swim',
    intensity: 'endurance',
    title: 'Técnica',
    status: 'planned',
    jointSessionId: null,
    ...patch,
  };
}

export function busyBlock(patch: Partial<BusyBlock> = {}): BusyBlock {
  return {
    id: 'b1',
    userId: ME,
    start: '2026-10-27T09:00:00',
    end: '2026-10-27T14:00:00',
    source: 'manual',
    title: 'Clase',
    externalId: null,
    ...patch,
  };
}

export function friend(patch: Partial<Friend> = {}, profile: Partial<Friend['profile']> = {}): Friend {
  return {
    friendshipId: 'fs1',
    status: 'accepted',
    direction: 'mutual',
    visibility: 'full',
    createdAt: '2026-10-01T10:00:00Z',
    ...patch,
    profile: { id: ALEX, username: 'alex', displayName: 'Álex García', avatarUrl: null, sports: ['run'], ...profile },
  };
}

export function notification(patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    userId: ME,
    type: 'joint_invite',
    title: 'Álex te invita',
    body: 'Rodaje largo sáb 9:00',
    data: {},
    readAt: null,
    createdAt: '2026-10-25T09:00:00',
    ...patch,
  };
}

export function feedItem(patch: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'f1',
    actor: { id: ALEX, username: 'alex', displayName: 'Álex', avatarUrl: null, sports: ['run'] },
    type: 'workout_completed',
    payload: { sport: 'run', title: 'Rodaje Z2', durationMin: 70, distanceM: 12500 },
    createdAt: '2026-10-25T08:00:00Z',
    kudosCount: 1,
    hasKudoed: false,
    ...patch,
  };
}

export function participant(patch: Partial<JointParticipant> = {}): JointParticipant {
  return { userId: ME, displayName: 'Diego', avatarUrl: null, status: 'accepted', workoutId: null, ...patch };
}

export function jointSession(patch: Partial<JointSession> = {}): JointSession {
  return {
    id: 'j1',
    organizerId: ALEX,
    sport: 'run',
    date: '2026-10-31',
    startTime: '09:00',
    durationMin: 90,
    intensity: 'endurance',
    title: 'Rodaje largo',
    location: null,
    notes: null,
    status: 'proposed',
    participants: [
      participant({ userId: ALEX, displayName: 'Álex', status: 'accepted' }),
      participant({ userId: ME, displayName: 'Diego', status: 'invited' }),
    ],
    createdAt: '2026-10-24T10:00:00Z',
    ...patch,
  };
}
