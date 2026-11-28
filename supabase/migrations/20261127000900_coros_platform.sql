-- Road to Ironman — COROS scheduled sync (Supabase-only: skipped by the PGlite tests).
--
-- Cron (UTC): COROS sync for every connected athlete at 05:35 and 08:35 UTC, five minutes
-- after the Garmin one (≈ 06:35 / 09:35 Madrid in winter). Re-runnable: cron.schedule upserts by name.
create or replace function private.schedule_coros_jobs()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regnamespace('cron') is null then
    return 'pg_cron no está activado: actívalo y ejecuta de nuevo select private.schedule_coros_jobs();';
  end if;
  execute $q$select cron.schedule(
    'rti-coros-sync',
    '35 5,8 * * *',
    $cmd$select private.invoke_edge_function('coros', '{"action":"sync_all"}'::jsonb)$cmd$
  )$q$;
  if to_regnamespace('net') is null then
    return 'Tarea programada, pero pg_net no está activado: las llamadas no saldrán hasta activarlo.';
  end if;
  return 'Sincronización de COROS programada (rti-coros-sync).';
end;
$$;

revoke all on function private.schedule_coros_jobs() from public, anon, authenticated;

do $$
declare
  v_result text;
begin
  v_result := private.schedule_coros_jobs();
  raise notice 'schedule_coros_jobs: %', v_result;
exception when others then
  raise notice 'COROS cron job not scheduled (%). Run select private.schedule_coros_jobs(); later.', sqlerrm;
end;
$$;
