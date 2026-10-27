/**
 * Public runtime configuration. Expo inlines `EXPO_PUBLIC_*` variables at
 * build time, so each one must be read with its literal name.
 */
export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  /** Supabase publishable key (sb_publishable_…) or legacy anon key. Safe to ship. */
  supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '',
  /** Force the local demo backend even when Supabase is configured. */
  forceDemo: process.env.EXPO_PUBLIC_DEMO === '1',
  /**
   * In-app AI (Claude API through the `coach`, `briefing` and `meal` edge functions). ON by default
   * since v2 (voice coach, meal photos, morning briefing); EXPO_PUBLIC_AI_COACH=0 turns it off and
   * every AI path falls back to the offline rules engine / local templates. The server also needs
   * ANTHROPIC_API_KEY, and each user's consent (`profiles.ai_consent_at`, asked in onboarding).
   */
  aiCoachEnabled: process.env.EXPO_PUBLIC_AI_COACH !== '0',
} as const;

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseKey) && !env.forceDemo;

/** Base URL of Supabase Edge Functions. */
export const functionsBaseUrl = env.supabaseUrl ? `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1` : '';
