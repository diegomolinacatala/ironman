-- Road to Ironman — how a B or C race is prepared (26-11-2026).
--
-- Each athlete sees a B race differently, so the race says how to get ready for it:
--   'training' (Como entreno): no taper, at most an easy day before (the old C behaviour);
--   'taper'    (Solo afinar): mini-taper of 3-5 days in its week and easy days after (the old B
--               behaviour);
--   'specific' (Preparación específica): in the 2 weeks before its race week 1, then 2 race-pace
--               sessions target that race's distance and pace (the A race still drives phases,
--               volume and long sessions), then the mini-taper and easy days after.
-- null = the priority's default (B → taper, C → training). A races ignore it.
--
-- The column is covered by the table-level grants and the own-rows policies of public.races.
-- Deploy this migration before the app and the edge functions that read races.prep.

alter table public.races
  add column if not exists prep text
  check (prep is null or prep in ('training', 'taper', 'specific'));

comment on column public.races.prep is
  'B/C race preparation: training (como entreno), taper (mini-taper, default for B), specific (race-pace sessions for it in the 2 weeks before its race week, then the mini-taper). null = priority default (B taper, C training); ignored for A.';
