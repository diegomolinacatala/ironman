/**
 * In-app AI coach switch (`EXPO_PUBLIC_AI_COACH=1`, off by default).
 *
 * Off: the coach is the offline rules engine, there is no consent sheet and no
 * Anthropic copy. "Conecta tu Claude" (the user's own connector) stays available.
 * Read at call time, never cached, so tests can flip it.
 */
import { env } from '@/lib/env';

export function isAiCoachEnabled(): boolean {
  return env.aiCoachEnabled;
}

/** Button name of the in-app coach: "Coach IA" with the AI on, "Coach" otherwise. */
export function coachButtonLabel(aiEnabled: boolean = isAiCoachEnabled()): string {
  return aiEnabled ? 'Coach IA' : 'Coach';
}
