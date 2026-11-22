-- Road to Ironman — automatic availability (the default).
--
-- The athlete no longer fills in weekly hours, a rest day or training windows: the planner uses
-- the calendar's busy blocks and the waking day, aims for an ambitious-but-sensible volume for the
-- level, race distance and phase (domain/season.ts `autoWeeklyHours`) with the ramp cap, and has
-- no fixed rest day. `availability.mode = 'manual'` (Tú › Disponibilidad › Ajustes avanzados)
-- keeps the old behaviour with the athlete's own hours, rest day and windows.
--
-- Existing rows are left untouched: a row without `mode` is read as automatic by the app and the
-- edge functions (src/data/supabase/parsers.ts, _shared/db/rows.ts), so nothing is rewritten.
-- Only the default for new profiles changes.

alter table public.profiles
  alter column availability set default '{
    "mode": "auto",
    "weeklyHoursTarget": 8,
    "restDay": null,
    "longSessionDays": [5, 6],
    "windows": [],
    "poolDays": []
  }'::jsonb;

comment on column public.profiles.availability is
  'mode auto (default; absent = auto): the planner follows the calendar. mode manual: weeklyHoursTarget, restDay, longSessionDays, windows, poolDays set by the athlete.';
