-- Rebufo — core schema (tables only).
-- RLS policies, RPCs and triggers live in later migrations.
-- Conventions: snake_case columns, text + CHECK instead of enums (easier to evolve),
-- every user-owned row has user_id → profiles(id) ON DELETE CASCADE.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users, created by trigger on sign-up)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  sports text[] not null default '{swim,bike,run}'
    check (sports <@ array['swim', 'bike', 'run', 'strength', 'mobility']),
  level text not null default 'intermediate' check (level in ('beginner', 'intermediate', 'advanced')),
  thresholds jsonb not null default '{}'::jsonb check (jsonb_typeof(thresholds) = 'object'),
  availability jsonb not null default '{
    "weeklyHoursTarget": 8,
    "restDay": 0,
    "longSessionDays": [5, 6],
    "windows": [],
    "poolDays": []
  }'::jsonb check (jsonb_typeof(availability) = 'object'),
  visibility text not null default 'full' check (visibility in ('full', 'summary', 'busy')),
  notification_prefs jsonb not null default '{
    "workoutReminders": true,
    "reminderMinutesBefore": 30,
    "morningSummary": true,
    "morningTime": "07:30",
    "eveningCheckin": true,
    "eveningTime": "21:30",
    "weeklyPlanReminder": true,
    "social": true
  }'::jsonb check (jsonb_typeof(notification_prefs) = 'object'),
  timezone text not null default 'Europe/Madrid' check (char_length(timezone) <= 64),
  coach_notes text check (coach_notes is null or char_length(coach_notes) <= 4000),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Joint sessions ("entrenar juntos") — created before workouts (FK target)
-- ---------------------------------------------------------------------------
create table public.joint_sessions (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  sport text not null check (sport in ('swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other', 'rest')),
  date date not null,
  start_time time,
  duration_min integer not null check (duration_min between 5 and 720),
  intensity text not null default 'endurance'
    check (intensity in ('recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race')),
  title text not null check (char_length(title) between 1 and 120),
  location text check (location is null or char_length(location) <= 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index joint_sessions_organizer_date_idx on public.joint_sessions (organizer_id, date);

-- ---------------------------------------------------------------------------
-- Workouts (planned + completed)
-- ---------------------------------------------------------------------------
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  start_time time,
  sport text not null check (sport in ('swim', 'bike', 'run', 'brick', 'strength', 'mobility', 'other', 'rest')),
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 4000),
  duration_min integer not null check (duration_min between 0 and 720),
  distance_m integer check (distance_m is null or distance_m between 0 and 1000000),
  intensity text not null check (intensity in ('recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'race')),
  tss numeric(6, 1) check (tss is null or tss between 0 and 2000),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  status text not null default 'planned' check (status in ('planned', 'completed', 'skipped')),
  completed jsonb check (completed is null or jsonb_typeof(completed) = 'object'),
  source text not null default 'manual'
    check (source in ('manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin')),
  is_key boolean not null default false,
  joint_session_id uuid references public.joint_sessions (id) on delete set null,
  -- Imported activity id (e.g. 'garmin:123', 'healthkit:<uuid>'): dedupe key for unplanned workouts.
  external_id text check (external_id is null or char_length(external_id) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workouts_user_date_idx on public.workouts (user_id, date);
create unique index workouts_user_external_uidx on public.workouts (user_id, external_id)
  where external_id is not null;
create index workouts_joint_idx on public.workouts (joint_session_id) where joint_session_id is not null;

create table public.joint_session_participants (
  session_id uuid not null references public.joint_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  workout_id uuid references public.workouts (id) on delete set null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index joint_participants_user_idx on public.joint_session_participants (user_id);

-- ---------------------------------------------------------------------------
-- Races
-- ---------------------------------------------------------------------------
create table public.races (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  date date not null,
  distance text not null check (distance in (
    'sprint', 'olympic', 'half', 'full', 'run_5k', 'run_10k', 'run_half', 'run_marathon', 'other'
  )),
  priority text not null default 'A' check (priority in ('A', 'B', 'C')),
  location text check (location is null or char_length(location) <= 200),
  goal text check (goal is null or char_length(goal) <= 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index races_user_date_idx on public.races (user_id, date);

-- ---------------------------------------------------------------------------
-- Life events ("imprevistos": pádel, fútbol, lesión, trabajo, estrés…)
-- ---------------------------------------------------------------------------
create table public.life_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in (
    'padel', 'football', 'other_sport', 'injury', 'illness', 'overload',
    'work', 'stress', 'travel', 'social', 'exam', 'other'
  )),
  title text not null check (char_length(title) between 1 and 120),
  start_date date not null,
  end_date date not null,
  start_time time,
  duration_min integer check (duration_min is null or duration_min between 0 and 1440),
  severity smallint not null default 2 check (severity between 1 and 3),
  body_area text check (body_area is null or body_area in (
    'foot', 'ankle', 'achilles', 'calf', 'shin', 'knee', 'hamstring', 'quad',
    'hip', 'back', 'shoulder', 'neck', 'other'
  )),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 120)
);
create index life_events_user_dates_idx on public.life_events (user_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- Busy blocks (classes, work… imported from the device calendar or manual)
-- ---------------------------------------------------------------------------
create table public.busy_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default 'manual' check (source in ('device_calendar', 'manual')),
  title text check (title is null or char_length(title) <= 200),
  external_id text check (external_id is null or char_length(external_id) <= 200),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours')
);
create index busy_blocks_user_start_idx on public.busy_blocks (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- Wellness: daily check-in (subjective) + daily metrics (HealthKit / Garmin)
-- ---------------------------------------------------------------------------
create table public.daily_checkins (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  sleep_quality smallint not null check (sleep_quality between 1 and 5),
  sleep_hours numeric(3, 1) check (sleep_hours is null or sleep_hours between 0 and 16),
  fatigue smallint not null check (fatigue between 1 and 5),
  soreness smallint not null check (soreness between 1 and 5),
  stress smallint not null check (stress between 1 and 5),
  motivation smallint not null check (motivation between 1 and 5),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table public.daily_metrics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  source text not null check (source in ('healthkit', 'garmin', 'manual')),
  hrv_ms numeric(6, 1),
  resting_hr numeric(5, 1),
  sleep_hours numeric(4, 2),
  sleep_score numeric(5, 1),
  body_battery numeric(5, 1),
  training_readiness numeric(5, 1),
  vo2max numeric(5, 1),
  steps integer,
  stress_avg numeric(5, 1),
  training_status text check (training_status is null or char_length(training_status) <= 60),
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, date, source)
);

-- ---------------------------------------------------------------------------
-- Nutrition log (free text + optional macros; feeds the coach)
-- ---------------------------------------------------------------------------
create table public.nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'pre', 'during', 'post')),
  description text not null check (char_length(description) between 1 and 1000),
  kcal integer check (kcal is null or kcal between 0 and 10000),
  carbs_g integer check (carbs_g is null or carbs_g between 0 and 2000),
  protein_g integer check (protein_g is null or protein_g between 0 and 1000),
  fat_g integer check (fat_g is null or fat_g between 0 and 1000),
  created_at timestamptz not null default now()
);
create index nutrition_user_date_idx on public.nutrition_logs (user_id, date);

-- ---------------------------------------------------------------------------
-- Social graph
-- ---------------------------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
-- One row per unordered pair.
create unique index friendships_pair_uidx on public.friendships (
  least(requester_id, addressee_id), greatest(requester_id, addressee_id)
);
create index friendships_addressee_idx on public.friendships (addressee_id);

-- Social feed events (inserted by triggers) + kudos.
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('workout_completed', 'race_added', 'joint_confirmed', 'plan_updated')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_actor_created_idx on public.activity_events (actor_id, created_at desc);

create table public.kudos (
  event_id uuid not null references public.activity_events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ---------------------------------------------------------------------------
-- In-app notifications (outbox for push too)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'friend_request', 'friend_accepted', 'joint_invite', 'joint_response',
    'joint_cancelled', 'plan_updated', 'friend_completed', 'kudos'
  )),
  title text not null check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 500),
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  pushed_at timestamptz,
  push_error text,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

create table public.push_tokens (
  token text primary key check (char_length(token) <= 300),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Plan proposals (rules engine, AI coach, Claude connector)
-- ---------------------------------------------------------------------------
create table public.plan_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('generate_week', 'replan', 'chat')),
  source text not null check (source in ('rules', 'ai_coach', 'claude')),
  week_start date not null,
  summary text not null default '' check (char_length(summary) <= 4000),
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  status text not null default 'pending' check (status in ('pending', 'applied', 'partially_applied', 'discarded')),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plan_proposals_user_created_idx on public.plan_proposals (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Personal tokens: Claude connector (MCP) & ICS calendar feed.
-- Only the SHA-256 hash of the secret is stored.
-- ---------------------------------------------------------------------------
create table public.personal_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope in ('mcp', 'ics')),
  label text not null default '' check (char_length(label) <= 60),
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index personal_tokens_user_idx on public.personal_tokens (user_id);

-- ---------------------------------------------------------------------------
-- AI usage ledger (rate limiting + cost visibility)
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  function_name text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Async AI coach jobs (edge function answers 202, finishes in background)
-- ---------------------------------------------------------------------------
create table public.coach_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request jsonb not null,
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  reply text,
  proposal_id uuid references public.plan_proposals (id) on delete set null,
  engine text check (engine is null or engine in ('ai', 'rules')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_jobs_user_created_idx on public.coach_jobs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- External integration credentials (Garmin Personal API key, AES-GCM encrypted
-- by the edge function). NO client access: only the service role reads/writes;
-- clients see status through the integration_status() RPC.
-- ---------------------------------------------------------------------------
create table public.integration_credentials (
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('garmin_personal')),
  secret_ciphertext text not null,
  key_expires_at date,
  state text not null default 'connected' check (state in ('connected', 'error', 'expired', 'disconnected')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
