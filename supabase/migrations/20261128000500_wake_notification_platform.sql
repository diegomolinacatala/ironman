-- Road to Ironman — wake-up briefing: the cron job (Supabase only; skipped by the PGlite
-- migration run, and a no-op where pg_cron / pg_net / Vault are missing).
--
-- Every 5 minutes, private.morning_wake_tick() calls the `morning` edge function with the secret
-- key ({"action":"sweep"}) — but only while some athlete in wake mode is in their morning (03:00
-- local or later) and their day is not settled yet, so there are no calls at night or once
-- everyone has had today's briefing.
--
-- After `supabase db push`, run once (SQL editor) to (re)create the cron jobs:
--   select private.schedule_platform_jobs();
-- Check: select jobname, schedule from cron.job;  select * from net._http_response order by created desc limit 20;

create or replace function private.morning_wake_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.briefing_notices') is null then
    return null;
  end if;
  if not exists (
    select 1
    from public.profiles p
    left join public.briefing_notices n
      on n.user_id = p.id and n.date = (now() at time zone private.safe_tz(p.timezone))::date
    where private.wants_wake_briefing(p.notification_prefs)
      and extract(hour from now() at time zone private.safe_tz(p.timezone)) >= 3
      and coalesce(n.status, 'watching') = 'watching'
  ) then
    return null;
  end if;
  return private.invoke_edge_function('morning', '{"action":"sweep"}'::jsonb);
end;
$$;

revoke all on function private.morning_wake_tick() from public, anon, authenticated;

-- Same jobs as 20261025000900_realtime_push_cron_platform.sql plus the wake-up sweep.
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
  execute $q$select cron.schedule(
    'rti-morning-wake',
    '*/5 * * * *',
    $cmd$select private.morning_wake_tick()$cmd$
  )$q$;
  if to_regnamespace('net') is null then
    return 'Tareas programadas, pero pg_net no está activado: las llamadas no saldrán hasta activarlo.';
  end if;
  return 'ok';
end;
$$;

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
