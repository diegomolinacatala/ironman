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
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
} as const;

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseKey) && !env.forceDemo;

/** Base URL of Supabase Edge Functions. */
export const functionsBaseUrl = env.supabaseUrl ? `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1` : '';
