-- Road to Ironman — Supabase platform wiring (skipped by the PGlite tests).
--
-- Every block checks that what it needs exists; otherwise it only raises a NOTICE, so
-- `supabase db push` never fails on a project where an extension is not enabled yet.
--
-- ONE-TIME SETUP per project (SQL editor), needed for push notifications and cron jobs:
--
--   create extension if not exists pg_net with schema extensions;
--   create extension if not exists pg_cron;            -- or Dashboard > Database > Extensions
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<sb_secret_... (Settings > API keys > Secret key)>', 'secret_key');
--   select private.schedule_platform_jobs();          -- creates/updates the cron jobs
--
-- Check: select * from cron.job;  select * from net._http_response order by created desc limit 20;

-- ---------------------------------------------------------------------------
-- Realtime: tables the app listens to with postgres_changes (RLS applies per subscriber).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and not puballtables
  ) then
    raise notice 'Publication supabase_realtime not found (or FOR ALL TABLES): realtime setup skipped';
    return;
  end if;
  foreach t in array array[
    'workouts', 'notifications', 'plan_proposals', 'coach_jobs', 'joint_session_participants',
    'joint_sessions', 'races', 'life_events', 'daily_metrics', 'friendships'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calls an Edge Function with the project's secret key (Vault). No-op (returns null) when
-- pg_net / Vault / the secrets are missing; never raises (push must not block inserts).
-- ---------------------------------------------------------------------------
create or replace function private.invoke_edge_function(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_request bigint;
begin
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'secret_key' limit 1$q$ into v_key;
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    return null;
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 5000)$q$
    into v_request
    using rtrim(v_url, '/') || '/functions/v1/' || p_function,
          jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
          coalesce(p_body, '{}'::jsonb);
  return v_request;
exception when others then
  raise warning 'invoke_edge_function(%) failed: %', p_function, sqlerrm;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push: one push-dispatch call per INSERT statement on notifications.
-- Body: { "action": "dispatch", "notificationIds": [uuid, ...] }. The function also sweeps
-- every unsent notification of the last 24 h, so a lost call is recovered by the cron sweep.
-- ---------------------------------------------------------------------------
create or replace function private.dispatch_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids jsonb;
begin
  select jsonb_agg(n.id) into v_ids from new_rows n;
  if v_ids is not null then
    perform private.invoke_edge_function(
      'push-dispatch',
      jsonb_build_object('action', 'dispatch', 'notificationIds', v_ids)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  referencing new table as new_rows
  for each statement execute function private.dispatch_push();

-- ---------------------------------------------------------------------------
-- Cron (UTC): Garmin sync for everyone at 05:30 and 08:30 UTC (≈ 06:30 / 09:30 Madrid in
-- winter), push-dispatch sweep every 5 minutes. Re-runnable: cron.schedule upserts by name.
-- ---------------------------------------------------------------------------
create or replace function private.schedule_platform_jobs()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regnamespace('cron') is null then
    return 'pg_cron no está activado: actívalo y ejecuta de nuevo select private.schedule_platform_jobs();';
  end if;
  execute $q$select cron.schedule(
    'rti-garmin-sync',
    '30 5,8 * * *',
    $cmd$select private.invoke_edge_function('garmin', '{"action":"sync_all"}'::jsonb)$cmd$
  )$q$;
  execute $q$select cron.schedule(
    'rti-push-sweep',
    '*/5 * * * *',
    $cmd$select private.invoke_edge_function('push-dispatch', '{"action":"sweep"}'::jsonb)$cmd$
  )$q$;
  if to_regnamespace('net') is null then
    return 'Tareas programadas, pero pg_net no está activado: las llamadas no saldrán hasta activarlo.';
  end if;
  return 'ok';
end;
$$;

revoke all on function private.invoke_edge_function(text, jsonb) from public, anon, authenticated;
revoke all on function private.dispatch_push() from public, anon, authenticated;
revoke all on function private.schedule_platform_jobs() from public, anon, authenticated;

do $$
declare
  v_result text;
begin
  v_result := private.schedule_platform_jobs();
  raise notice 'schedule_platform_jobs: %', v_result;
exception when others then
  raise notice 'Cron jobs not scheduled (%). Run select private.schedule_platform_jobs(); later.', sqlerrm;
end;
$$;
