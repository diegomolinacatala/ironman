/**
 * Row shapes returned by PostgREST for the tables in
 * `supabase/migrations/20261025000100_schema.sql` and the RPCs in
 * ARCHITECTURE §7. Columns are snake_case; jsonb columns are `unknown` and
 * narrowed by the mappers.
 *
 * Postgres `time` comes back as 'HH:MM:SS', `numeric` as number (or string
 * with some drivers), `date` as 'YYYY-MM-DD', `timestamptz` as ISO strings.
 */

export type NumericValue = number | string | null;

export interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  sports: string[] | null;
  level: string;
  thresholds: unknown;
  availability: unknown;
  visibility: string;
  notification_prefs: unknown;
  timezone: string;
  coach_notes: string | null;
  onboarded_at: string | null;
  ai_consent_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface WorkoutRow {
  id: string;
  user_id: string;
  date: string;
  start_time: string | null;
  sport: string;
  title: string;
  description: string | null;
  duration_min: number;
  distance_m: number | null;
  intensity: string;
  tss: NumericValue;
  steps: unknown;
  status: string;
  completed: unknown;
  source: string;
  is_key: boolean;
  joint_session_id: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RaceRow {
  id: string;
  user_id: string;
  name: string;
  date: string;
  distance: string;
  priority: string;
  location: string | null;
  goal: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
}

export interface LifeEventRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  duration_min: number | null;
  severity: number;
  body_area: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
}

export interface BusyBlockRow {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  source: string;
  title: string | null;
  external_id: string | null;
  created_at?: string;
}

export interface CheckinRow {
  user_id: string;
  date: string;
  sleep_quality: number;
  sleep_hours: NumericValue;
  fatigue: number;
  soreness: number;
  stress: number;
  motivation: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MetricsRow {
  user_id: string;
  date: string;
  source: string;
  hrv_ms: NumericValue;
  resting_hr: NumericValue;
  sleep_hours: NumericValue;
  sleep_score: NumericValue;
  body_battery: NumericValue;
  training_readiness: NumericValue;
  vo2max: NumericValue;
  steps: number | null;
  stress_avg: NumericValue;
  training_status: string | null;
  raw?: unknown;
  updated_at?: string;
}

export interface NutritionRow {
  id: string;
  user_id: string;
  date: string;
  meal: string;
  description: string;
  kcal: number | null;
  carbs_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  read_at: string | null;
  pushed_at?: string | null;
  push_error?: string | null;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  user_id: string;
  kind: string;
  source: string;
  week_start: string;
  summary: string;
  changes: unknown;
  status: string;
  model: string | null;
  created_at: string;
  updated_at?: string;
}

export interface CoachJobRow {
  id: string;
  user_id: string;
  status: string;
  reply: string | null;
  proposal_id: string | null;
  engine: string | null;
  error: string | null;
  created_at?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// RPC result rows
// ---------------------------------------------------------------------------

/** `list_friends()` */
export interface FriendRpcRow {
  friendship_id: string;
  status: string;
  direction: string;
  created_at: string;
  friend_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  sports: string[] | null;
  visibility?: string | null;
}

/** `search_profiles(p_query)` */
export interface PublicProfileRpcRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  sports: string[] | null;
}

/** `get_friend_week(p_friend, p_from, p_to)` */
export interface FriendWeekRpcRow {
  kind: string;
  id: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_min: number | null;
  sport: string | null;
  intensity: string | null;
  title: string | null;
  status: string | null;
  joint_session_id: string | null;
}

/** `list_feed(p_limit)` */
export interface FeedRpcRow {
  id: string;
  actor_id: string;
  actor_username: string;
  actor_display_name: string;
  actor_avatar_url: string | null;
  actor_sports: string[] | null;
  type: string;
  payload: unknown;
  created_at: string;
  kudos_count: number | string;
  has_kudoed: boolean;
}

/** `list_personal_tokens()` */
export interface TokenRpcRow {
  id: string;
  scope: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** `integration_status()` */
export interface IntegrationRpcRow {
  provider: string;
  state: string;
  key_expires_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}
