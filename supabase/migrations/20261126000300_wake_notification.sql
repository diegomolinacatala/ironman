-- Road to Ironman — "Tu informe de hoy" when you wake up (optional; the fixed time stays the default).
--
-- * profiles.notification_prefs (client-writable jsonb, no column change) gains:
--   morningMode 'fixed' | 'wake' (absent = 'fixed'), wakeDelayMin 5 | 10 | 15 | 30 (absent = 15)
--   and wakeWindow {from, to} ('HH:mm'; absent or null = learned from the watch's sleep).
-- * briefing_notices: one row per user and LOCAL day (profile time zone) once the wake-up sweep
--   looked for the wake-up (light Garmin pulls, throttled) or the day was settled:
--   'push' (the server sent the notification), 'device' (the app read the wake-up from Apple
--   Salud and scheduled its own local notification), 'skipped' (too late, nothing sent).
--   Whoever leaves 'watching' first is the only one that notifies: never twice a day.
-- * notifications.type + 'morning_briefing' ("Tu informe de hoy" → /briefing?play=1). Inserted
--   already read: it is pushed (push-dispatch) but does not add an unread badge every morning.
-- * RPCs: svc_wake_candidates, svc_record_wake_check, svc_send_morning_briefing and
--   svc_skip_morning_briefing (service role: the `morning` edge function) and
--   claim_wake_briefing (the app, before scheduling its local notification).
-- The cron job is in 20261126000301_wake_notification_platform.sql.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'friend_request', 'friend_accepted', 'joint_invite', 'joint_response',
  'joint_cancelled', 'plan_updated', 'friend_completed', 'kudos',
  'joint_updated', 'joint_comment', 'joint_open', 'morning_briefing'
));

create table if not exists public.briefing_notices (
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  status text not null default 'watching' check (status in ('watching', 'push', 'device', 'skipped')),
  reason text check (reason is null or reason in ('wake', 'fallback')),
  sleep_end timestamptz,
  due_at timestamptz,
  done_at timestamptz,
  checks integer not null default 0 check (checks >= 0),
  last_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date),
  check ((status = 'watching') = (done_at is null))
);
comment on table public.briefing_notices is
  'Morning briefing in wake mode: one row per user and local day (watching → push | device | skipped).';

alter table public.briefing_notices enable row level security;
revoke all on public.briefing_notices from public, anon, authenticated;
grant select on public.briefing_notices to authenticated;
grant all on public.briefing_notices to service_role;

drop policy if exists briefing_notices_select_own on public.briefing_notices;
create policy briefing_notices_select_own on public.briefing_notices
  for select to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists briefing_notices_set_updated_at on public.briefing_notices;
create trigger briefing_notices_set_updated_at
  before update on public.briefing_notices
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The profile wants the briefing when the watch says it woke up (and the briefing at all).
create or replace function private.wants_wake_briefing(p_prefs jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce($1 ->> 'morningMode', 'fixed') = 'wake'
     and coalesce($1 ->> 'morningSummary', 'true') <> 'false';
$$;

-- ---------------------------------------------------------------------------
-- 3. Service role (the `morning` function, every 5 minutes)
-- ---------------------------------------------------------------------------
-- Athletes in wake mode whose local day has not been settled yet, from 03:00 local, with what the
-- sweep needs: local date and minutes now, prefs, Garmin connection, last light pull and the
-- nights of the last 3 weeks (any source; the sweep picks garmin > coros > healthkit > manual).
create or replace function public.svc_wake_candidates(p_now timestamptz default now())
returns table (
  user_id uuid,
  timezone text,
  local_date date,
  local_minutes integer,
  prefs jsonb,
  garmin boolean,
  last_check_at timestamptz,
  nights jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with wake_users as (
    select p.id, private.safe_tz(p.timezone) as tz, p.notification_prefs as prefs
    from public.profiles p
    where private.wants_wake_briefing(p.notification_prefs)
  ), local_now as (
    select w.id, w.tz, w.prefs, (coalesce(p_now, now()) at time zone w.tz) as local_ts
    from wake_users w
  )
  select
    l.id,
    l.tz,
    l.local_ts::date,
    (extract(hour from l.local_ts) * 60 + extract(minute from l.local_ts))::integer,
    l.prefs,
    exists (
      select 1 from public.integration_credentials c
      where c.user_id = l.id and c.provider = 'garmin_personal' and c.state in ('connected', 'error')
    ),
    n.last_check_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('date', m.date, 'source', m.source, 'start', m.sleep_start, 'end', m.sleep_end)
        order by m.date, m.source
      )
      from public.daily_metrics m
      where m.user_id = l.id
        and m.date >= l.local_ts::date - 22
        and (m.sleep_end is not null or m.sleep_start is not null)
    ), '[]'::jsonb)
  from local_now l
  left join public.briefing_notices n on n.user_id = l.id and n.date = l.local_ts::date
  where coalesce(n.status, 'watching') = 'watching'
    and extract(hour from l.local_ts) >= 3
  order by l.id;
$$;

-- One light Garmin pull for this user and local day (the sweep pulls at most every 10 minutes).
create or replace function public.svc_record_wake_check(p_user uuid, p_date date)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.briefing_notices as b (user_id, date, checks, last_check_at)
  values (p_user, p_date, 1, now())
  on conflict (user_id, date) do update
    set checks = b.checks + 1, last_check_at = now();
$$;

-- "Tu informe de hoy" for this user and local day, unless the day is already settled (sent by an
-- earlier sweep, claimed by the app or skipped). True when this call sent it. The notifications
-- insert trigger (platform migration) calls push-dispatch at once.
create or replace function public.svc_send_morning_briefing(
  p_user uuid, p_date date, p_reason text, p_sleep_end timestamptz, p_due_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent boolean;
begin
  if p_user is null or p_date is null or p_reason is null or p_reason not in ('wake', 'fallback') then
    perform private.raise_error('validation', 'Aviso del informe no válido');
  end if;
  insert into public.briefing_notices as b (user_id, date, status, reason, sleep_end, due_at, done_at)
  values (p_user, p_date, 'push', p_reason, p_sleep_end, p_due_at, now())
  on conflict (user_id, date) do update
    set status = 'push', reason = excluded.reason, sleep_end = excluded.sleep_end,
        due_at = excluded.due_at, done_at = now()
    where b.status = 'watching'
  returning true into v_sent;
  if not coalesce(v_sent, false) then
    return false;
  end if;
  insert into public.notifications (user_id, type, title, body, data, read_at)
  values (
    p_user,
    'morning_briefing',
    'Tu informe de hoy',
    'Toca para escuchar cómo has dormido y qué te toca hoy',
    jsonb_build_object('url', '/briefing?play=1', 'date', p_date, 'reason', p_reason),
    now()
  );
  return true;
end;
$$;

-- Too late for a briefing notification today: settle the day without sending anything.
create or replace function public.svc_skip_morning_briefing(p_user uuid, p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_skipped boolean;
begin
  insert into public.briefing_notices as b (user_id, date, status, done_at)
  values (p_user, p_date, 'skipped', now())
  on conflict (user_id, date) do update
    set status = 'skipped', done_at = now()
    where b.status = 'watching'
  returning true into v_skipped;
  return coalesce(v_skipped, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The app (Apple Salud path)
-- ---------------------------------------------------------------------------
-- The app read today's wake-up from Apple Salud and is about to schedule its own local
-- notification at p_due_at: it takes today's briefing so the server never pushes a second one.
-- False when the athlete is not in wake mode or the day is already settled (then the app does
-- not schedule anything).
create or replace function public.claim_wake_briefing(p_date date, p_sleep_end timestamptz, p_due_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_uid();
  v_tz text;
  v_prefs jsonb;
  v_claimed boolean;
begin
  select private.safe_tz(p.timezone), p.notification_prefs into v_tz, v_prefs
  from public.profiles p where p.id = v_me;
  if not private.wants_wake_briefing(coalesce(v_prefs, '{}'::jsonb)) then
    return false;
  end if;
  if p_date is null or p_date <> (now() at time zone v_tz)::date then
    perform private.raise_error('validation', 'El aviso solo puede ser de hoy');
  end if;
  if p_sleep_end is null or p_sleep_end > now() + interval '5 minutes' or p_sleep_end < now() - interval '18 hours' then
    perform private.raise_error('validation', 'Hora de despertar no válida');
  end if;
  if p_due_at is null or p_due_at < p_sleep_end or p_due_at > p_sleep_end + interval '1 hour' then
    perform private.raise_error('validation', 'Hora del aviso no válida');
  end if;
  insert into public.briefing_notices as b (user_id, date, status, reason, sleep_end, due_at, done_at)
  values (v_me, p_date, 'device', 'wake', p_sleep_end, p_due_at, now())
  on conflict (user_id, date) do update
    set status = 'device', reason = 'wake', sleep_end = excluded.sleep_end,
        due_at = excluded.due_at, done_at = now()
    where b.status = 'watching'
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
revoke all on function private.wants_wake_briefing(jsonb) from public, anon, authenticated;
revoke all on function public.svc_wake_candidates(timestamptz) from public, anon, authenticated;
revoke all on function public.svc_record_wake_check(uuid, date) from public, anon, authenticated;
revoke all on function public.svc_send_morning_briefing(uuid, date, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.svc_skip_morning_briefing(uuid, date) from public, anon, authenticated;
revoke all on function public.claim_wake_briefing(date, timestamptz, timestamptz) from public, anon;
grant execute on function public.svc_wake_candidates(timestamptz) to service_role;
grant execute on function public.svc_record_wake_check(uuid, date) to service_role;
grant execute on function public.svc_send_morning_briefing(uuid, date, text, timestamptz, timestamptz) to service_role;
grant execute on function public.svc_skip_morning_briefing(uuid, date) to service_role;
grant execute on function public.claim_wake_briefing(date, timestamptz, timestamptz) to authenticated, service_role;
