-- Road to Ironman v2 — Supabase platform wiring (skipped by the PGlite tests).
--
-- Realtime: the app listens to `briefings` (postgres_changes, RLS applies per subscriber) so the
-- "Informe de hoy" hero and the widget update as soon as the `briefing` function writes the row.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and not puballtables
  ) then
    raise notice 'Publication supabase_realtime not found (or FOR ALL TABLES): realtime setup skipped';
    return;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'briefings'
  ) then
    alter publication supabase_realtime add table public.briefings;
  end if;
end;
$$;
