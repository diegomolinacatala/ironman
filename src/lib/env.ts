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
   * In-app AI coach (Claude API through the `coach` edge function). OFF by default: the coach uses
   * the offline rules engine and nothing is sent to Anthropic. Turn on with EXPO_PUBLIC_AI_COACH=1
   * (also needs ANTHROPIC_API_KEY in Supabase and the consent texts re-enabled).
   */
  aiCoachEnabled: process.env.EXPO_PUBLIC_AI_COACH === '1',
} as const;

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseKey) && !env.forceDemo;

/** Base URL of Supabase Edge Functions. */
export const functionsBaseUrl = env.supabaseUrl ? `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1` : '';
