-- Possible illness, confirmed in the morning check-in (src/domain/illness.ts).
-- Night vitals on daily_metrics (Garmin sleep DTO, Apple Salud, the athlete's
-- Claude via log_daily_metrics) and the answer to «¿Cómo te encuentras?» on
-- daily_checkins. All nullable: older rows and clients keep working.

alter table public.daily_metrics
  add column if not exists sleep_respiration numeric(4, 1)
    check (sleep_respiration is null or sleep_respiration between 4 and 40),
  add column if not exists sleep_avg_hr numeric(4, 1)
    check (sleep_avg_hr is null or sleep_avg_hr between 25 and 150);

comment on column public.daily_metrics.sleep_respiration is
  'Average breathing rate (breaths/min) during the night that ends on `date`.';
comment on column public.daily_metrics.sleep_avg_hr is
  'Average heart rate (bpm) during the night that ends on `date` (not resting HR).';

alter table public.daily_checkins
  add column if not exists illness_answer text
    check (illness_answer is null or illness_answer in ('fine', 'symptoms', 'alcohol', 'heat', 'stress'));

comment on column public.daily_checkins.illness_answer is
  'Answer to the extra morning question when last night''s breathing or pulse was up: '
  'fine | symptoms | alcohol | heat | stress (null = not asked).';
