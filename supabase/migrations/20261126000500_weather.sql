-- Weather-aware training (docs/ARCHITECTURE.md §17):
--   * profiles.weather_place / weather_lat / weather_lon: the athlete's city for the forecast
--     (Tú › Entrenamiento › Tu ciudad para el tiempo), client-updatable, all three or none. A
--     geocoded city, never the device location;
--   * weather_forecasts: MET Norway Locationforecast cache, one row per coordinate pair rounded to
--     2 decimals (~1 km), honouring Expires / Last-Modified. Shared by every athlete of that city,
--     no user id. Service role only (the `weather`, `briefing` and `coach` functions);
--   * geocode_results: city searches (Nominatim / OpenStreetMap) cached 30 days. Service role only;
--   * provider_calls + svc_reserve_provider_call: global spacing between calls to a provider
--     (Nominatim: at most one request per second for the whole app).
-- Re-runnable: if not exists / drop … if exists, explicit privileges.

-- ---------------------------------------------------------------------------
-- 1. profiles: the athlete's city
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists weather_place text;
alter table public.profiles add column if not exists weather_lat double precision;
alter table public.profiles add column if not exists weather_lon double precision;

alter table public.profiles drop constraint if exists profiles_weather_place_check;
-- Explicit "is not null": a null inside the second branch would make the whole check unknown (= pass).
alter table public.profiles add constraint profiles_weather_place_check check (
  (weather_place is null and weather_lat is null and weather_lon is null)
  or (
    weather_place is not null and weather_lat is not null and weather_lon is not null
    and char_length(btrim(weather_place)) between 1 and 120
    and weather_lat between -90 and 90
    and weather_lon between -180 and 180
  )
);

comment on column public.profiles.weather_place is
  'City for the weather forecast (name shown in the app); null = none. Its coordinates go to MET Norway through the weather function.';

grant update (weather_place, weather_lat, weather_lon) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. weather_forecasts: forecast cache per rounded coordinates
-- ---------------------------------------------------------------------------
create table if not exists public.weather_forecasts (
  lat numeric(5, 2) not null check (lat between -90 and 90),
  lon numeric(6, 2) not null check (lon between -180 and 180),
  points jsonb not null default '[]'::jsonb check (jsonb_typeof(points) = 'array' and pg_column_size(points) <= 200000),
  issued_at timestamptz,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_modified text check (last_modified is null or char_length(last_modified) <= 64),
  primary key (lat, lon)
);

comment on table public.weather_forecasts is
  'MET Norway forecast cache (compact steps, UTC) per coordinates rounded to 2 decimals; never refreshed before expires_at.';

alter table public.weather_forecasts enable row level security;
revoke all on public.weather_forecasts from public, anon, authenticated;
grant all on public.weather_forecasts to service_role;

-- ---------------------------------------------------------------------------
-- 3. geocode_results: city search cache
-- ---------------------------------------------------------------------------
create table if not exists public.geocode_results (
  query text primary key check (char_length(query) between 2 and 80),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array' and pg_column_size(results) <= 20000),
  fetched_at timestamptz not null default now()
);

comment on table public.geocode_results is
  'Nominatim (OpenStreetMap) city searches, normalized query → places; reused for 30 days. No user id.';

alter table public.geocode_results enable row level security;
revoke all on public.geocode_results from public, anon, authenticated;
grant all on public.geocode_results to service_role;

-- ---------------------------------------------------------------------------
-- 4. provider_calls: global spacing between requests to an external provider
-- ---------------------------------------------------------------------------
create table if not exists public.provider_calls (
  provider text primary key check (provider in ('nominatim', 'met_norway')),
  last_call_at timestamptz not null default '-infinity'
);

alter table public.provider_calls enable row level security;
revoke all on public.provider_calls from public, anon, authenticated;
grant all on public.provider_calls to service_role;

-- True (and stamps the call) when the last call to p_provider is at least p_min_interval_ms old;
-- false otherwise. The row lock serialises concurrent callers: two edge instances never both win.
create or replace function public.svc_reserve_provider_call(p_provider text, p_min_interval_ms integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserved boolean;
begin
  if p_provider is null or p_provider not in ('nominatim', 'met_norway') then
    raise exception 'Proveedor desconocido' using errcode = '22023', hint = 'validation';
  end if;
  insert into public.provider_calls (provider) values (p_provider) on conflict (provider) do nothing;
  update public.provider_calls
    set last_call_at = clock_timestamp()
    where provider = p_provider
      and last_call_at <= clock_timestamp() - make_interval(secs => greatest(coalesce(p_min_interval_ms, 0), 0) / 1000.0)
    returning true into v_reserved;
  return coalesce(v_reserved, false);
end;
$$;

revoke all on function public.svc_reserve_provider_call(text, integer) from public, anon, authenticated;
grant execute on function public.svc_reserve_provider_call(text, integer) to service_role;
