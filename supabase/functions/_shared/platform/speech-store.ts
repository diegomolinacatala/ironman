/** Speech budget over supabase-js (service role): AI consent + `svc_reserve_speech`. */
import type { SpeechBudgetStore } from '../speech/ports.ts';
import { DbError, unwrap } from './db.ts';
import type { Db } from './db.ts';
import { createAiUsageStore } from './service-stores.ts';

export function createSpeechBudgetStore(db: Db): SpeechBudgetStore {
  const usage = createAiUsageStore(db);
  return {
    getAiConsentAt: (userId) => usage.getAiConsentAt(userId),
    async reserveSpeech(userId, chars, limits) {
      const data = unwrap(
        await db.rpc('svc_reserve_speech', {
          p_user: userId,
          p_chars: chars,
          p_user_daily_chars: limits.userDailyChars,
          p_user_premium_chars: limits.userPremiumDailyChars,
          p_premium_budget: limits.premiumDailyChars,
          p_basic_budget: limits.basicDailyChars,
        }),
        'svc_reserve_speech',
      );
      if (data === null || data === undefined) return null;
      if (data === 'premium' || data === 'basic') return data;
      throw new DbError('svc_reserve_speech', 'unexpected tier', null);
    },
  };
}
