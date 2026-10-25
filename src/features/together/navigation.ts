import { router } from 'expo-router';

import type { ISODate, UUID } from '@/domain/types';

import { jointNewParams } from './jointForm';
import type { JointPrefill } from './types';

export function openJointNew(prefill: JointPrefill = {}): void {
  router.push({ pathname: '/joint/new', params: jointNewParams(prefill) });
}

export function openFriendWeek(friendId: UUID, weekStart?: ISODate): void {
  router.push({ pathname: '/friends/[id]', params: weekStart ? { id: friendId, week: weekStart } : { id: friendId } });
}

export function openWorkout(workoutId: UUID): void {
  router.push(`/workout/${encodeURIComponent(workoutId)}`);
}
