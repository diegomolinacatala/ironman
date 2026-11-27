-- Road to Ironman — COROS connected directly through the official COROS MCP (OAuth).
--
-- 1. integration_credentials.provider + 'coros_mcp': secret_ciphertext holds the encrypted
--    token bundle (endpoints, dynamically registered client, access + refresh token);
--    key_expires_at stays null. The `coros` edge function is the only writer (service role).
-- 2. workouts.source + 'coros': activities imported by that function (external_id 'coros:<labelId>',
--    the same key the Claude connector's log_completed_activity writes, so nothing is imported twice).

alter table public.integration_credentials drop constraint if exists integration_credentials_provider_check;
alter table public.integration_credentials add constraint integration_credentials_provider_check
  check (provider in ('garmin_personal', 'coros_mcp'));

alter table public.workouts drop constraint if exists workouts_source_check;
alter table public.workouts add constraint workouts_source_check
  check (source in ('manual', 'rules', 'ai_coach', 'claude', 'joint', 'healthkit', 'garmin', 'coros'));
