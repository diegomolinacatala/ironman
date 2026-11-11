-- Road to Ironman v4 — Supabase platform wiring (skipped by the PGlite tests).
--
-- Realtime: the app listens to `week_plans` (postgres_changes, RLS applies per subscriber) so
-- Plan → General follows the week plans that Claude (set_week_plans) or the coach save.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and not puballtables
  ) then
    raise notice 'Publication supabase_realtime not found (or FOR ALL TABLES): realtime setup skipped';
    return;
  end if;
  if to_regclass('public.week_plans') is null then
    raise notice 'public.week_plans not found: apply 20261109000100_coach_v4.sql first';
    return;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'week_plans'
  ) then
    alter publication supabase_realtime add table public.week_plans;
  end if;
end;
$$;
