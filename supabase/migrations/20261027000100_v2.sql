-- Road to Ironman v2 — "tu coach de bolsillo" (docs/V2.md §3):
-- sleep stages on daily_metrics, server-written morning briefings, coach job extras
-- (memory + logged imprevisto) and a one-time reset of the onboarding.

-- ---------------------------------------------------------------------------
-- Sleep stages + start/end of the night that ENDS on `date` (Garmin dailySleepDTO).
-- ---------------------------------------------------------------------------
alter table public.daily_metrics
  add column if not exists sleep_deep_min integer
    check (sleep_deep_min is null or sleep_deep_min between 0 and 1440),
  add column if not exists sleep_light_min integer
    check (sleep_light_min is null or sleep_light_min between 0 and 1440),
  add column if not exists sleep_rem_min integer
    check (sleep_rem_min is null or sleep_rem_min between 0 and 1440),
  add column if not exists sleep_awake_min integer
    check (sleep_awake_min is null or sleep_awake_min between 0 and 1440),
  add column if not exists sleep_start timestamptz,
  add column if not exists sleep_end timestamptz;

comment on column public.daily_metrics.sleep_deep_min is 'Deep sleep (minutes) of the night that ends on `date`.';
comment on column public.daily_metrics.sleep_start is 'When the night that ends on `date` started (instant).';
comment on column public.daily_metrics.sleep_end is 'When the night that ends on `date` ended (instant).';

-- ---------------------------------------------------------------------------
-- Morning briefing ("Informe de hoy"), one per user and day. Written only by the
-- `briefing` Edge Function (service role); the owner reads it. `sleep` is the camelCase
-- SleepSnapshot of src/domain/types.ts, stored verbatim.
-- ---------------------------------------------------------------------------
create table if not exists public.briefings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  headline text not null check (char_length(headline) between 1 and 120),
  sleep_verdict text not null default 'unknown'
    check (sleep_verdict in ('great', 'good', 'fair', 'poor', 'unknown')),
  sleep_summary text not null default '' check (char_length(sleep_summary) <= 500),
  script text not null check (char_length(script) between 1 and 4000),
  focus text not null default '' check (char_length(focus) <= 500),
  sleep jsonb check (sleep is null or jsonb_typeof(sleep) = 'object'),
  model text check (model is null or char_length(model) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

drop trigger if exists briefings_set_updated_at on public.briefings;
create trigger briefings_set_updated_at
  before update on public.briefings
  for each row execute function private.set_updated_at();

drop trigger if exists briefings_keep_owner on public.briefings;
create trigger briefings_keep_owner
  before update of user_id on public.briefings
  for each row execute function private.keep_owner();

-- Same model as coach_jobs / ai_usage: read own, no client writes (service role only).
alter table public.briefings enable row level security;
revoke all on public.briefings from anon, authenticated;
grant all on public.briefings to service_role;
grant select on public.briefings to authenticated;

drop policy if exists briefings_select_own on public.briefings;
create policy briefings_select_own on public.briefings
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Coach job extras: { "memory": string[], "lifeEventId": uuid | null }.
-- ---------------------------------------------------------------------------
alter table public.coach_jobs
  add column if not exists extras jsonb check (extras is null or jsonb_typeof(extras) = 'object');

comment on column public.coach_jobs.extras is
  'v2: { "memory": string[] (saved to profiles.coach_notes), "lifeEventId": uuid | null (imprevisto logged) }';

-- ---------------------------------------------------------------------------
-- Everyone sees the v2 onboarding once (Garmin + Claude + calendar + morning briefing), and the
-- AI consent is asked again because the AI provider changed (the old consent text named
-- Anthropic; v2 runs on Cloudflare Workers AI). Guarded by the release date so re-running this
-- migration never resets people who already went through the v2 onboarding.
-- ---------------------------------------------------------------------------
update public.profiles
set
  onboarded_at = case when onboarded_at < timestamptz '2026-10-28 00:00:00+00' then null else onboarded_at end,
  ai_consent_at = case when ai_consent_at < timestamptz '2026-10-28 00:00:00+00' then null else ai_consent_at end
where onboarded_at < timestamptz '2026-10-28 00:00:00+00'
   or ai_consent_at < timestamptz '2026-10-28 00:00:00+00';
