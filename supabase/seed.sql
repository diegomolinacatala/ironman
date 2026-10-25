-- Rebufo — local development seed (`npx supabase db reset`). NEVER run on production.
--
-- Two flatmates, accepted friends, with races, two weeks of workouts, busy blocks (clases),
-- a pádel imprevisto, check-ins/metrics and a pending quedada invite from Álex to Diego.
-- Sign in locally with email OTP (codes appear in http://127.0.0.1:54324):
--   diego@rebufo.test · alex@rebufo.test
-- Dates are relative to the current week so the seed never goes stale.

-- ---------------------------------------------------------------------------
-- Auth users (the sign-up trigger creates their profiles)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'diego@rebufo.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Diego"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'alex@rebufo.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Álex"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
   '{"sub":"11111111-1111-4111-8111-111111111111","email":"diego@rebufo.test","email_verified":true}',
   'email', now(), now(), now()),
  ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
   '{"sub":"22222222-2222-4222-8222-222222222222","email":"alex@rebufo.test","email_verified":true}',
   'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
update public.profiles set
  username = 'diego',
  display_name = 'Diego',
  level = 'intermediate',
  thresholds = '{"ftpW": 235, "runThresholdPaceSecPerKm": 270, "swimCssSecPer100m": 105, "maxHr": 192, "lthr": 172, "restingHr": 50}',
  availability = '{"weeklyHoursTarget": 9, "restDay": 0, "longSessionDays": [5, 6], "poolDays": [1, 3],
    "windows": [{"weekday": 1, "start": "07:00", "end": "08:30"}, {"weekday": 2, "start": "18:30", "end": "20:30"},
                {"weekday": 3, "start": "07:00", "end": "08:30"}, {"weekday": 4, "start": "18:30", "end": "20:30"},
                {"weekday": 5, "start": "08:00", "end": "13:00"}, {"weekday": 6, "start": "08:00", "end": "13:00"}]}',
  visibility = 'full',
  coach_notes = 'Estudia por las mañanas. Rodilla derecha delicada si sube mucho el volumen de carrera.',
  onboarded_at = now()
where id = '11111111-1111-4111-8111-111111111111';

update public.profiles set
  username = 'alex',
  display_name = 'Álex',
  level = 'intermediate',
  thresholds = '{"ftpW": 250, "runThresholdPaceSecPerKm": 260, "swimCssSecPer100m": 112, "maxHr": 188}',
  availability = '{"weeklyHoursTarget": 8, "restDay": 4, "longSessionDays": [5, 6], "poolDays": [0, 2],
    "windows": [{"weekday": 0, "start": "19:00", "end": "21:00"}, {"weekday": 2, "start": "19:00", "end": "21:00"},
                {"weekday": 5, "start": "08:00", "end": "12:00"}, {"weekday": 6, "start": "08:00", "end": "12:00"}]}',
  visibility = 'full',
  onboarded_at = now()
where id = '22222222-2222-4222-8222-222222222222';

insert into public.friendships (requester_id, addressee_id, status, responded_at)
values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'accepted', now())
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Races
-- ---------------------------------------------------------------------------
insert into public.races (user_id, name, date, distance, priority, location, goal)
values
  ('11111111-1111-4111-8111-111111111111', 'Triatlón Media Distancia de Valencia',
   (current_date + 180), 'half', 'A', 'Valencia', 'Bajar de 5h 30'''),
  ('11111111-1111-4111-8111-111111111111', 'Triatlón Olímpico de Madrid',
   (current_date + 75), 'olympic', 'B', 'Madrid', 'Ritmo de carrera'),
  ('22222222-2222-4222-8222-222222222222', 'Triatlón Media Distancia de Valencia',
   (current_date + 180), 'half', 'A', 'Valencia', 'Terminar fuerte');

-- ---------------------------------------------------------------------------
-- Workouts: this week (Mon..Sun) + next week, for both
-- ---------------------------------------------------------------------------
with wk as (select date_trunc('week', current_date)::date as mon)
insert into public.workouts (user_id, date, start_time, sport, title, duration_min, distance_m, intensity, source, is_key)
select v.user_id::uuid, wk.mon + v.day_offset, v.start_time::time, v.sport, v.title, v.duration_min, v.distance_m, v.intensity, 'rules', v.is_key
from wk, (values
  ('11111111-1111-4111-8111-111111111111', 1, '07:00', 'swim', 'Técnica + 8×100', 50, 2500, 'endurance', false),
  ('11111111-1111-4111-8111-111111111111', 2, '18:45', 'run', 'Series 5×1000 en umbral', 60, 11000, 'threshold', true),
  ('11111111-1111-4111-8111-111111111111', 3, '07:00', 'swim', 'Fondo aeróbico', 45, 2200, 'endurance', false),
  ('11111111-1111-4111-8111-111111111111', 4, '18:45', 'bike', 'Rodillo tempo 3×12''', 75, null, 'tempo', false),
  ('11111111-1111-4111-8111-111111111111', 5, '08:30', 'bike', 'Tirada larga en Z2', 180, 85000, 'endurance', true),
  ('11111111-1111-4111-8111-111111111111', 6, '09:00', 'run', 'Carrera larga', 90, 16000, 'endurance', true),
  ('11111111-1111-4111-8111-111111111111', 8, '07:00', 'swim', 'Series 10×100', 50, 2600, 'tempo', false),
  ('11111111-1111-4111-8111-111111111111', 9, '18:45', 'run', 'Rodaje suave', 45, 8000, 'recovery', false),
  ('11111111-1111-4111-8111-111111111111', 12, '08:30', 'brick', 'Transición bici + carrera', 120, null, 'tempo', true),
  ('22222222-2222-4222-8222-222222222222', 0, '19:00', 'swim', 'Técnica de crol', 45, 2000, 'endurance', false),
  ('22222222-2222-4222-8222-222222222222', 2, '19:00', 'run', 'Fartlek', 50, 9000, 'tempo', true),
  ('22222222-2222-4222-8222-222222222222', 5, '08:30', 'bike', 'Grupeta Z2', 150, 70000, 'endurance', true),
  ('22222222-2222-4222-8222-222222222222', 6, '09:00', 'run', 'Carrera larga', 80, 14000, 'endurance', false),
  ('22222222-2222-4222-8222-222222222222', 7, '19:00', 'swim', 'Fondo 3000', 60, 3000, 'endurance', false),
  ('22222222-2222-4222-8222-222222222222', 12, '09:00', 'bike', 'Tirada larga', 180, 85000, 'endurance', true)
) as v(user_id, day_offset, start_time, sport, title, duration_min, distance_m, intensity, is_key);

-- Mark the sessions already in the past as completed (feeds the social feed through triggers).
update public.workouts set
  status = 'completed',
  completed = jsonb_build_object('durationMin', duration_min, 'distanceM', distance_m, 'rpe', 6, 'source', 'manual')
where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
  and date < current_date;

-- ---------------------------------------------------------------------------
-- Busy blocks (clases), pádel imprevisto
-- ---------------------------------------------------------------------------
with wk as (select date_trunc('week', current_date)::date as mon)
insert into public.busy_blocks (user_id, starts_at, ends_at, source, title)
select v.user_id::uuid,
       ((wk.mon + v.day_offset) + v.start_time::time) at time zone 'Europe/Madrid',
       ((wk.mon + v.day_offset) + v.end_time::time) at time zone 'Europe/Madrid',
       'manual', v.title
from wk, (values
  ('11111111-1111-4111-8111-111111111111', 0, '09:00', '14:00', 'Clases máster'),
  ('11111111-1111-4111-8111-111111111111', 1, '09:00', '14:00', 'Clases máster'),
  ('11111111-1111-4111-8111-111111111111', 2, '09:00', '14:00', 'Clases máster'),
  ('11111111-1111-4111-8111-111111111111', 3, '09:00', '14:00', 'Clases máster'),
  ('22222222-2222-4222-8222-222222222222', 0, '08:00', '17:00', 'Trabajo'),
  ('22222222-2222-4222-8222-222222222222', 1, '08:00', '17:00', 'Trabajo'),
  ('22222222-2222-4222-8222-222222222222', 2, '08:00', '17:00', 'Trabajo'),
  ('22222222-2222-4222-8222-222222222222', 3, '08:00', '17:00', 'Trabajo')
) as v(user_id, day_offset, start_time, end_time, title);

insert into public.life_events (user_id, kind, title, start_date, end_date, start_time, duration_min, severity)
values ('11111111-1111-4111-8111-111111111111', 'padel', 'Pádel con los del máster',
        date_trunc('week', current_date)::date + 3, date_trunc('week', current_date)::date + 3, '20:00', 90, 2);

-- ---------------------------------------------------------------------------
-- Check-ins + metrics (last 14 days)
-- ---------------------------------------------------------------------------
insert into public.daily_checkins (user_id, date, sleep_quality, sleep_hours, fatigue, soreness, stress, motivation)
select u.id, current_date - g.n, 3 + (g.n % 2), 7 + (g.n % 3) * 0.5, 2 + (g.n % 3), 2, 2 + (g.n % 2), 4
from (values ('11111111-1111-4111-8111-111111111111'::uuid), ('22222222-2222-4222-8222-222222222222'::uuid)) as u(id),
     generate_series(0, 13) as g(n)
on conflict do nothing;

insert into public.daily_metrics (user_id, date, source, hrv_ms, resting_hr, sleep_hours, sleep_score, body_battery, training_readiness, vo2max, stress_avg)
select u.id, current_date - g.n, 'garmin', u.hrv + (g.n % 5) - 2, u.rhr + (g.n % 3), 7.2 + (g.n % 3) * 0.3,
       72 + (g.n % 7), 60 + (g.n % 30), 55 + (g.n % 25), u.vo2, 25 + (g.n % 10)
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 62, 48, 54.0),
  ('22222222-2222-4222-8222-222222222222'::uuid, 70, 46, 56.5)
) as u(id, hrv, rhr, vo2),
generate_series(0, 13) as g(n)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Pending quedada: Álex invites Diego to Saturday's long ride (next week)
-- ---------------------------------------------------------------------------
insert into public.joint_sessions (id, organizer_id, sport, date, start_time, duration_min, intensity, title, location)
values ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'bike',
        date_trunc('week', current_date)::date + 12, '09:00', 180, 'endurance', 'Tirada larga juntos', 'Salida desde casa');

insert into public.joint_session_participants (session_id, user_id, status, responded_at)
values
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'accepted', now()),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'invited', null);

update public.workouts set joint_session_id = '33333333-3333-4333-8333-333333333333', source = 'joint'
where user_id = '22222222-2222-4222-8222-222222222222' and date = date_trunc('week', current_date)::date + 12;

update public.joint_session_participants p set workout_id = w.id
from public.workouts w
where p.session_id = '33333333-3333-4333-8333-333333333333'
  and p.user_id = '22222222-2222-4222-8222-222222222222'
  and w.joint_session_id = p.session_id and w.user_id = p.user_id;
