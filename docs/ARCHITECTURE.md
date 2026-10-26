# Road to Ironman — Architecture & build contract

> Formerly "Rebufo" (renamed 2026-10-26; see §13).
> iOS app (Expo SDK 58 / React Native 0.88 / React 19.3, Expo Router) + Supabase backend.
> UI language: **Spanish (Spain)**. Code, comments, identifiers: English.

This document is the contract every builder follows. Research backing the decisions lives in
`docs/research/01..05`. If something here conflicts with your instinct, follow this document and
mention the concern in your final report.

---

## 1. Product in one screen

Two flatmates (and later a few friends) training for triathlon:

1. **Plan the week** — weekly calendar (Mon–Sun), planned vs completed sessions, compliance colours,
   weekly totals, race countdown and training phase.
2. **Imprevistos** — log surprises (pádel, fútbol, injury, illness, overload, work, stress, travel…)
   and get a **re-plan proposal** (diff) to accept/reject change by change.
3. **Coach** — deterministic rules engine (always available, offline) + AI coach (Claude via our
   edge function) + **"Conecta tu Claude"**: a personal MCP connector URL the user adds in claude.ai,
   so *their own* Claude (which already reads Garmin) can read the app context and write proposals.
4. **Juntos** — friends, masked calendar sharing (full / summary / busy), **Huecos** (common free
   slots), **Oportunidades** (same sport same day), **Quedadas** (joint sessions with invite/accept,
   linked in both calendars, treated as fixed constraints by re-planners), light feed with kudos.
5. **Data in** — Garmin Personal API (official per-user read-only key, server-side sync), Apple Health
   (HealthKit, on device), device calendar busy blocks (EventKit), daily check-in, nutrition log,
   and the Claude bridge (Claude writes Garmin metrics through MCP).
6. **Data out** — local notifications (reminders, morning summary, evening check-in, Sunday planning),
   push (invites, proposals ready, friend accepted…), iOS widgets (expo-widgets), ICS calendar feed.

Feature names in UI: **Quedadas** (joint sessions), **Huecos** (common free slots), **Imprevistos**
(life events). Race distances: "Distancia completa", "Media distancia" (never "70.3"); "Ironman" only
in the app name.

---

## 2. Repository layout & ownership

```
app.config.ts, eas.json, package.json, tsconfig.json, jest.config.js   (orchestrator — do not edit)
src/
  app/                      Expo Router routes (see §6). _layout.tsx, (tabs)/_layout.tsx, index.tsx are orchestrator-owned.
  domain/                   PURE TS (no RN/Expo imports). types.ts + changes.ts are contracts (orchestrator).
  data/                     repository.ts, context.ts, queries.ts, RepositoryProvider.tsx are contracts (orchestrator).
    createRepository.ts     data agent
    supabase/**             data agent
    demo/**                 data agent
  integrations/**           integrations agent (HealthKit, calendar, notifications, widgets, AppEffects)
  features/<area>/**        UI agents (components used by their screens)
  ui/**                     design system (orchestrator) — use it, don't fork it
  lib/                      env.ts, logger.ts, storage.ts (orchestrator)
supabase/
  migrations/20261025000100_schema.sql   tables (orchestrator contract)
  migrations/202610250002xx_*.sql        db agent (helpers, RLS, RPCs, triggers)
  migrations/202610250009xx_*_platform.sql  db agent; Supabase-only bits (realtime publication, pg_net, cron). Skipped by PGlite tests.
  config.toml, seed.sql, tests/**        db agent
  functions/**                           functions agent
docs/                                     research + this file; SETUP.md (orchestrator)
```

**Rules for all builders**
- Only create/edit files you own. Never edit contract files; if a contract is wrong or missing
  something, work around it locally and list the needed change in your final report.
- Do **not** run `npm install` / `npx expo install` (shared `node_modules`). Everything needed is
  installed (see package.json). If you truly need a package, report it.
- No `console.log` — use `logger` from `@/lib/logger`. Handle errors explicitly; show Spanish
  user-facing messages (`errorMessage()` helper).
- Immutability: never mutate props/query data; return new objects.
- Files < 800 lines, functions < 50 lines where reasonable. Many small files.
- Path alias `@/` → `src/`. In `src/**` import without file extensions.
- Typecheck with `npx tsc --noEmit` (whole project; ignore errors in files owned by others while
  the parallel build is in progress, but leave zero errors in yours).

---

## 3. Contracts (read these files first)

| File | What |
|---|---|
| `src/domain/types.ts` | All domain types (Workout, Race, LifeEvent, PlanChange, CoachRequest…). |
| `src/domain/changes.ts` | `applyPlanChanges(workouts, changes, ctx)` pure/immutable + `describeChange`. |
| `src/data/repository.ts` | `Repository` + `AuthApi` interfaces, `RepositoryError`, `ChangeTopic`. |
| `src/data/queries.ts` | TanStack Query hooks — the ONLY way screens read/write data. |
| `src/data/context.ts` | `useRepository()`, `useAuth()` (session, isLoading, auth api, mode). |
| `src/ui/*` | Design system: `Screen, Text, Button, IconButton, Card, Chip, Tag, SportBadge, Icon, TextField, Segmented, Stepper, ScorePicker, Row, Stack, SectionHeader, Divider, EmptyState, Loading, ErrorNotice, ListRow, Avatar, ProgressBar, ProgressRing, haptics, useTheme, space, radius, type, fonts, sportColor, intensityColor, complianceColor`. |
| `src/lib/env.ts` | `env`, `isBackendConfigured`, `functionsBaseUrl`. |
| `src/lib/storage.ts` | `readJson/writeJson/removeKey`, `StorageKeys`. |
| `supabase/migrations/20261025000100_schema.sql` | All tables & columns. |

Repository selection (`createRepository()`): Supabase when `isBackendConfigured`, otherwise the
**demo repository** (AsyncStorage, seeded). The demo must make every screen fully usable (web preview,
TestFlight before backend setup).

---

## 4. Domain API (`src/domain/**`, domain agent)

Pure functions, explicit types, Spanish labels, unit-tested (jest, `src/domain/__tests__/*.test.ts`,
≥80% lines). Backed by `docs/research/02-reglas-entrenamiento.md`. Exact exports other agents rely on:

### `dates.ts`
```ts
todayISO(now?: Date): ISODate
toISODate(d: Date): ISODate                    // local calendar date
parseISODate(s: ISODate): Date                 // local midday, safe for DST
addDays(date: ISODate, n: number): ISODate
diffDays(a: ISODate, b: ISODate): number       // a - b in days
startOfWeek(date: ISODate): ISODate            // Monday
weekRange(weekStart: ISODate): DateRange       // Mon..Sun
daysInRange(range: DateRange): ISODate[]
weekdayOf(date: ISODate): Weekday              // 0 = Monday
isoWeekNumber(date: ISODate): number
timeToMinutes(t: ISOTime): number
minutesToTime(min: number): ISOTime
formatDayShort(date: ISODate): string          // "lun 27"
formatDayLong(date: ISODate): string           // "lunes 27 de octubre"
formatDayLabel(date: ISODate, today?: ISODate): string // "Hoy", "Mañana", "Ayer" or "lun 27 oct"
formatDuration(min: number): string            // 45 → "45'", 75 → "1h 15'", 120 → "2h"
formatDistance(m: number, sport: Sport): string // swim "2.500 m", others "42,2 km"
formatTime(t: ISOTime | null): string          // "18:30" or ""
formatWeekRange(weekStart: ISODate): string    // "27 oct – 2 nov"
```

### `labels.ts`
`sportLabel(s)`, `intensityLabel(i)` ("Recuperación", "Fondo Z2", "Tempo Z3", "Umbral Z4", "VO2 Z5",
"Ritmo carrera"), `intensityZone(i)` ("Z1".."Z5","RC"), `difficultyLabel(i)` (Fácil/Moderada/Dura/Muy
dura/Máxima), `raceDistanceLabel(d)` + `raceDistanceDetail(d)` ("1,9 · 90 · 21,1 km"),
`lifeEventLabel(k)`, `bodyAreaLabel(a)`, `severityLabel(kind, s)`, `mealLabel(m)`,
`visibilityLabel(v)` + `visibilityHelp(v)`, `levelLabel(l)`, `statusLabel(st)`, `weekdayLabel(w)`,
`weekdayShort(w)`, `phaseLabel(p)`.

### `load.ts`
```ts
INTENSITY_IF: Record<Intensity, number>
estimateTss(w: { sport: Sport; durationMin: number; intensity: Intensity }): number
workoutLoad(w: Workout): number               // completed tss → rpe-based (sRPE) → planned estimate; 0 for skipped/rest
lifeEventLoad(e: LifeEvent): number           // sRPE-style for padel/football/other_sport, 0 otherwise
dailyLoads(workouts: Workout[], events: LifeEvent[], range: DateRange, opts?: { includePlanned?: boolean }): Record<ISODate, number>
computePmc(loads: Record<ISODate, number>, range: DateRange, seed?: { ctl: number; atl: number }): PmcPoint[]
// PmcPoint = { date, load, ctl, atl, tsb }   (CTL 42d, ATL 7d EWMA, TSB = CTL(yesterday) − ATL(yesterday))
type Compliance = 'done' | 'partial' | 'off' | 'missed' | 'unplanned' | 'adjusted' | 'pending'
complianceOf(w: Workout, today: ISODate): Compliance   // TrainingPeaks bands on TSS→duration→distance
weekSummary(workouts: Workout[], weekStart: ISODate, today: ISODate): WeekSummary
// WeekSummary = { plannedMin, completedMin, plannedTss, completedTss, sessions, completedSessions,
//   compliancePct (0..1 | null), bySport: Partial<Record<Sport, { plannedMin; completedMin; count }>> }
```

### `periodization.ts`
```ts
type Phase = 'prep' | 'base' | 'build' | 'peak' | 'taper' | 'race_week' | 'recovery' | 'transition'
phaseFor(date: ISODate, races: Race[]): PhaseInfo
// PhaseInfo = { phase, targetRace: Race | null, weeksToRace: number | null, daysToRace: number | null,
//   isRecoveryWeek: boolean, volumeFactor: number, focus: string /* Spanish one-liner */ }
nextRace(races: Race[], today: ISODate): Race | null   // next A, else next any
```

### `readiness.ts`
```ts
computeReadiness(input: { today: ISODate; checkin: DailyCheckin | null; metrics: DailyMetrics[] /* last ~28 days */ }): Readiness
// Readiness = { score: number | null /* 0-100 */, level: 'green' | 'amber' | 'red' | 'unknown',
//   factors: string[] /* Spanish, e.g. "VFC 12% bajo tu media" */, recommendation: string }
```

### `planner.ts` (rules engine — must work fully offline)
```ts
generateWeek(input: PlannerInput): { changes: PlanChange[]; summary: string }
// PlannerInput = { weekStart; profile: Profile; races: Race[]; existing: Workout[] /* that week */;
//   lifeEvents: LifeEvent[]; busyBlocks: BusyBlock[]; jointSessions: JointSession[];
//   readiness?: Readiness | null; recentWeeklyMinutes?: number[] /* last 4 weeks completed */ }
// Only 'add' changes on days/slots not already used; never deletes user workouts.
// Respects availability (hours target × phase volumeFactor, rest day, long days, pool days, windows),
// busy blocks (pick start times inside windows not overlapping busy), joint sessions (already present),
// 80/20 intensity, no back-to-back hard days, long ride/run on long days, brick in build/peak, taper.
```

Additive inputs (implemented): `PlannerInput.today?` (first plannable day) and `history?` (completed
workouts of the last ~30 days: run cap 1.10×, long-ride +15 % cap, form guard). In race weeks the
planner adds a key 'Carrera: <nombre>' workout on the race date. `PhaseInfo` also has `subphase`,
`cadence` ('3:1' | '2:1'), `raceInWeek`, `warnings`; `phaseFor(date, races, opts?)`.
WorkoutStep convention: consecutive steps sharing the same `repeat` form one interval set
(work 8' ×4 + recovery 3' ×4 = (8' + 3') × 4); swim sets use `distanceM`.

### `replanner.ts`
```ts
replanForEvent(input: ReplanInput & { event: LifeEvent }): { changes: PlanChange[]; summary: string }
replanForReadiness(input: ReplanInput & { readiness: Readiness }): { changes: PlanChange[]; summary: string }
replanMissed(input: ReplanInput & { missed: Workout[] }): { changes: PlanChange[]; summary: string }
// ReplanInput = { today: ISODate; weekWorkouts: Workout[]; profile: Profile; busyBlocks?: BusyBlock[]; lifeEvents?: LifeEvent[] }
// Never touches completed workouts. Joint sessions (jointSessionId) and isKey are protected:
// prefer adjusting others; if unavoidable, propose with an explicit reason mentioning the partner.
// Every change has a Spanish one-sentence `reason`. Injury rules include "consulta a un profesional".
// Optional inputs: jointSessions (partner names in reasons), races (warn when an A race is ≤7 days away).
// The editable window is today..today+6; callers re-planning a future week pass today = its Monday.
```

### `together.ts`
```ts
interface Interval { start: ISODateTime; end: ISODateTime }
freeSlots(input: { date: ISODate; busy: Interval[]; windows: TrainingWindow[]; minMinutes: number; dayStart?: ISOTime; dayEnd?: ISOTime }): Slot[]
// Slot = { date; start: ISOTime; end: ISOTime; minutes }
commonSlots(input: { range: DateRange; mine: { busy: Interval[]; windows: TrainingWindow[] }; theirs: { busy: Interval[]; windows: TrainingWindow[] }; minMinutes: number; travelBufferMin?: number }): Slot[]
friendBusyIntervals(items: FriendWeekItem[]): Interval[]    // busy + timed workouts of the friend
findOpportunities(input: { range: DateRange; myWorkouts: Workout[]; friendItems: FriendWeekItem[]; slots: Slot[] }): Opportunity[]
// Opportunity = { id: string; date; sport: Sport; kind: 'same_session' | 'same_sport' | 'free_slot';
//   myWorkoutId: UUID | null; friendItemId: UUID | null; start: ISOTime | null; durationMin: number;
//   score: number /* 0..1 */; title: string; reason: string /* Spanish */ }
```

### `fueling.ts`
`fuelingHint(w: { sport; durationMin; intensity }): { before: string; during: string | null; after: string; carbsPerHour: number | null }` (general guidance, not medical advice).

### `matching.ts`
`matchActivity(activity: { date; sport; durationMin; startTime?: ISOTime | null }, planned: Workout[]): Workout | null`
— same day, compatible sport (brick ↔ bike/run), duration within 50–150 %, closest start time.

### `validation.ts` (zod 4)
`workoutDraftSchema`, `raceDraftSchema`, `lifeEventDraftSchema`, `checkinDraftSchema`,
`nutritionDraftSchema`, `profilePatchSchema`, `usernameSchema` — and `firstError(result)` → Spanish message.

---

## 5. Data layer (data agent)

- `createRepository.ts`: `export function createRepository(): Repository`.
- `supabase/client.ts`: supabase-js client with AsyncStorage session storage, `autoRefreshToken`,
  `persistSession`, `detectSessionInUrl: false`, AppState-based start/stop auto refresh (native only).
  Key = `env.supabaseKey` (publishable). Edge functions called with `supabase.functions.invoke`.
- `supabase/mappers.ts`: snake_case rows ↔ domain types (pure, unit-tested).
- `SupabaseRepository` implements every method using tables (RLS) and the RPCs in §7.
  `requestCoach` (only when `env.aiCoachEnabled`, otherwise straight to the rules engine — §13): invoke `coach` → `{ jobId }` (HTTP 202) → poll `coach_jobs` row every 2 s
  (max 170 s) → load proposal → `CoachResponse`. If the function answers 503 `ai_unavailable`
  (no API key) or fails, fall back to the domain rules engine locally, store the proposal with
  `createProposal({ source: 'rules' })` and return `engine: 'rules'`.
  Auth: email OTP (`signInWithOtp` + `verifyOtp({ type: 'email' })`); Apple via
  `expo-apple-authentication` + `signInWithIdToken({ provider: 'apple', token, nonce })` using a
  SHA-256 hashed nonce (`expo-crypto`). `deleteAccount` → RPC `delete_my_account`.
  Realtime: one channel with `postgres_changes` filtered by `user_id=eq.<me>` on workouts,
  notifications, plan_proposals, coach_jobs, joint_session_participants, races, life_events,
  daily_metrics; friendships (two filters requester/addressee) → `ChangeTopic`.
  Tokens: URL for MCP = `${functionsBaseUrl}/mcp/u/${secret}`; ICS = `${functionsBaseUrl}/ics/${secret}.ics`.
- `demo/DemoRepository`: in-memory state persisted to AsyncStorage (`StorageKeys.demoDb`), seeded on
  first run with: me (`Diego`, @diego), friend `Álex` (@alex, accepted friendship, visibility 'full'),
  an A race (Media distancia ~6 months out) + a B race, this week + next week of realistic workouts
  for both (some completed with RPE), a padel life event, busy blocks (clases), check-ins and metrics
  for 28 days, one pending joint session invite from Álex, two feed items, notifications.
  Demo auth: any email/code works; Apple sign-in also simulated. Friend side is simulated
  (Álex auto-accepts quedadas after ~2 s). `requestCoach` uses the rules engine (`engine: 'rules'`).
  Tokens: returns a fake URL and explains it needs the backend.
- Tests: `src/data/__tests__/*.test.ts` (mappers, demo repo flows: create/complete workout, apply
  proposal, propose/respond joint session, friend week masking).

---

## 6. Routes (Expo Router, `src/app/`)

Root Stack (orchestrator) already declares titles/presentation for each route below. Screens inside
a native header or modal render `<Screen inSheet>`; tab screens render `<Screen title=… overline=…>`.
Navigate with `router.push('/workout/123')`, params via `useLocalSearchParams<{…}>()`.

| Route | Owner | Purpose / params |
|---|---|---|
| `index` | orch | auth/onboarding gate |
| `sign-in`, `verify` (`?email`) | ui-account | email OTP + Apple; demo hint |
| `onboarding` | ui-account | multi-step profile setup, sets `onboardedAt` |
| `(tabs)/today` | ui-plan | Hoy |
| `(tabs)/week` (`?week=YYYY-MM-DD`) | ui-plan | Semana |
| `(tabs)/together` | ui-together | Juntos |
| `(tabs)/progress` | ui-coach | Progreso |
| `(tabs)/me` | ui-account | Yo |
| `workout/[id]` | ui-plan | detail + complete/skip/move/edit/delete/invite |
| `workout/edit` (`?id` or `?date&sport`) | ui-plan | create/edit (modal) |
| `event/edit` (`?id` or `?date&kind`) | ui-plan | imprevisto (modal) → offers re-plan |
| `checkin` (`?date`) | ui-plan | daily check-in (modal) |
| `coach` (`?mode&weekStart&lifeEventId&message`) | ui-coach | AI/rules coach chat + quick actions |
| `proposal/[id]` | ui-coach | diff review, apply selected / all / discard (modal) |
| `races/index`, `races/edit` (`?id`) | ui-coach | races list / form |
| `nutrition` (`?date`) | ui-coach | nutrition log + fueling tips |
| `friends/add` | ui-together | search username, share invite (modal) |
| `friends/[id]` (`?week`) | ui-together | full week compare + huecos + oportunidades |
| `joint/new` (`?friendId&date&sport&startTime&durationMin&fromWorkoutId&title`) | ui-together | propose quedada (modal) |
| `joint/[id]` | ui-together | quedada detail, accept/decline/cancel |
| `notifications` | ui-together | inbox; tap → `data.url` |
| `settings/profile` | ui-account | name, username, level, sports, thresholds, coach notes |
| `settings/availability` | ui-account | weekly hours, rest/long/pool days, windows |
| `settings/notifications` | ui-account | prefs (stored in profile) |
| `settings/integrations` | ui-account | Garmin Personal API, Apple Salud, Calendario |
| `settings/claude` | ui-account | "Conecta tu Claude" (MCP URL generator + guide) |
| `settings/calendar-feed` | ui-account | ICS subscription URL (webcal) |

Shared feature components (owned by **ui-plan**, importable by others — implement exactly):
```ts
// src/features/workouts/WorkoutCard.tsx
export function WorkoutCard(props: { workout: Workout; compact?: boolean; today?: ISODate;
  partnerName?: string | null; onPress?: () => void; onLongPress?: () => void }): JSX.Element
// src/features/workouts/ComplianceDot.tsx
export function ComplianceDot(props: { state: Compliance; size?: number }): JSX.Element
// src/features/workouts/IntensityTag.tsx
export function IntensityTag(props: { intensity: Intensity }): JSX.Element
```

---

## 7. Database (db agent) — `supabase/migrations`

Tables: see schema migration. RLS enabled on **every** public table. Use `(select auth.uid())` in
policies, helpers `security definer` in schema `private` with `set search_path = ''`.

**Helpers** (`private`): `are_friends(a uuid, b uuid) boolean`, `is_session_participant(session uuid, u uuid) boolean`,
`set_updated_at()` trigger fn, `handle_new_user()` (trigger on `auth.users` insert → profile with
username `u` + 8 hex chars and display_name from email local part / `raw_user_meta_data.full_name`).

**Policies**
- Own-rows CRUD (`user_id = (select auth.uid())`): workouts, races, life_events, busy_blocks,
  daily_checkins, daily_metrics, nutrition_logs, plan_proposals. Prevent changing `user_id`.
  A trigger must reject setting `workouts.joint_session_id` to a session the user does not participate in.
- profiles: select/update own; no insert/delete from clients.
- friendships: select if party; delete if party; insert/update only through RPCs.
- joint_sessions / joint_session_participants: select if participant/organizer; writes via RPCs.
- activity_events: select own or friends'; kudos: select if event visible, insert/delete own (via RPC).
- notifications: select/update(read_at)/delete own. push_tokens: select/delete own; upsert via RPC.
- coach_jobs, ai_usage: select own; writes service role only.
- personal_tokens: select own **without** `token_hash` (column grants or RPC), update own `revoked_at`, insert via RPC.
- integration_credentials: RLS on, **no policies** (service role only).

**RPCs callable by `authenticated`** (all `security definer`, validate inputs, use `auth.uid()`):
| Function | Returns | Semantics |
|---|---|---|
| `apply_plan_changes(p_changes jsonb, p_proposal_id uuid default null)` | `jsonb {applied int, failed [{index,error}]}` | Same semantics as `src/domain/changes.ts` (camelCase JSON as in `PlanChange`), only own planned workouts; marks proposal applied/partially_applied. |
| `send_friend_request(p_username text)` | `uuid` | Creates pending; if reverse pending exists → accept it. Errors: not found, self, already friends. |
| `respond_friend_request(p_friendship_id uuid, p_accept boolean)` | `void` | Addressee only. |
| `list_friends()` | `table(friendship_id, status, direction, created_at, friend_id, username, display_name, avatar_url, sports)` | |
| `search_profiles(p_query text)` | `table(id, username, display_name, avatar_url, sports)` | ≥2 chars, ilike on username/display_name, excludes self, limit 20. |
| `get_friend_week(p_friend uuid, p_from date, p_to date)` | `table(kind, id, date, start_time, end_time, duration_min, sport, intensity, title, status, joint_session_id)` | Must be accepted friends; max 31 days; masked by friend's `visibility` (full: all; summary: no title; busy: only busy intervals). Busy blocks + timed workouts split per day in the friend's timezone, titles of busy blocks NEVER exposed. Life events: only padel/football/other_sport/travel/social, never health ones. |
| `propose_joint_session(p_session jsonb, p_invitees uuid[], p_from_workout uuid default null)` | `uuid` | Invitees must be accepted friends; creates session, participants (organizer accepted), organizer workout (link existing or create, source 'joint'). |
| `respond_joint_session(p_session_id uuid, p_accept boolean)` | `void` | On accept creates the invitee's linked workout; session → confirmed when ≥1 invitee accepted. |
| `cancel_joint_session(p_session_id uuid)` | `void` | Organizer only; status cancelled; deletes linked *planned* workouts of others, unlinks the organizer's. |
| `list_joint_sessions(p_from date, p_to date)` | `jsonb` (array of `JointSession` camelCase objects) | Sessions where caller participates. |
| `list_feed(p_limit int default 30)` | `table(id, actor_id, actor_username, actor_display_name, actor_avatar_url, actor_sports, type, payload, created_at, kudos_count, has_kudoed)` | Own + friends' events. |
| `toggle_kudos(p_event_id uuid)` | `boolean` (now kudoed?) | Event must be visible. |
| `register_push_token(p_token text, p_platform text)` | `void` | Upsert, reassign token to caller. |
| `mark_notifications_read(p_ids uuid[] default null)` | `void` | null = all. |
| `create_personal_token(p_scope text, p_label text)` | `jsonb {id, secret, prefix}` | secret = `'rb_' \|\| 64 hex chars` from two `gen_random_uuid()`; stores `encode(sha256(convert_to(secret,'UTF8')),'hex')`; prefix = first 10 chars; max 5 active per scope. |
| `list_personal_tokens()` | `table(id, scope, label, prefix, created_at, last_used_at, revoked_at)` | |
| `revoke_personal_token(p_id uuid)` | `void` | |
| `integration_status()` | `table(provider, state, key_expires_at, last_sync_at, last_error)` | |
| `delete_my_account()` | `void` | Deletes `auth.users` row of caller (cascades). |
| `is_username_available(p_username text)` | `boolean` | Own username counts as available. |
| `get_joint_session(p_session_id uuid)` | `jsonb` (camelCase `JointSession` or null) | Participants' names are not readable via RLS. |

`list_friends` / `svc_list_friends` also return `visibility` (the friend's sharing level, only for accepted friendships).

**Added after review:** `profiles.ai_consent_at` (client-updatable); `svc_reserve_coach_job(p_user, p_request, p_limit)`
(service role, atomic daily limit); `unregister_push_token(p_token)` (called before sign-out/deletion);
`activity_events` is not selectable by clients (feed only via `list_feed`); friend_request notifications link to `/together`.

**RPC error contract:** `message` = Spanish user-facing text, `hint` = `RepositoryErrorCode`
(`not_authenticated | forbidden | not_found | validation | conflict | rate_limited`); SQLSTATE 42501
(auth/forbidden), P0002 (not found), 22023 (validation), 23505 (conflict). Profiles are created by the
sign-up trigger: clients `update` (never insert). `personal_tokens.token_hash` is not granted: use
`list_personal_tokens()`. `apply_plan_changes` returns `{applied, failed}` only (re-fetch workouts);
proposal → `applied` when nothing failed and every change of the proposal was applied, else
`partially_applied`.

**RPCs for the service role only** (`revoke execute … from public, anon, authenticated; grant … to service_role`):
`svc_resolve_token(p_token_hash text, p_scope text) returns uuid` (null if missing/revoked; updates
`last_used_at`), `svc_apply_plan_changes(p_user uuid, p_changes jsonb, p_proposal_id uuid)`,
`svc_get_friend_week(p_viewer uuid, p_friend uuid, p_from date, p_to date)`,
`svc_list_friends(p_user uuid)`. Public wrappers call these with `auth.uid()`.

**Triggers → notifications / feed** (Spanish titles):
friend request (addressee), friend accepted (requester), joint invite (invitee), joint response
(organizer), joint cancelled (others), plan proposal inserted with source `claude` or `ai_coach`
(owner: "Tu semana tiene N cambios propuestos"), kudos (event actor).
Feed: workout status → completed (`workout_completed`, payload sport/title/durationMin/distanceM,
skipped if actor visibility = 'busy', title omitted if 'summary'), race insert (`race_added`),
joint confirmed (`joint_confirmed`).

**Platform migration** (`…_platform.sql`, Supabase only): add tables to `supabase_realtime`
publication; `pg_net` trigger on `notifications` insert calling `/functions/v1/push-dispatch` with
Vault secrets `project_url` + `secret_key` (no-op if secrets missing); `pg_cron` jobs: garmin sync
(06:30 & 09:30 Europe/Madrid ≈ 05:30/08:30 UTC), push-dispatch sweep every 5 min.

**Tests** (`supabase/tests/*.test.ts`, run with `npm run test:db` → `node --test`, Node 24 native
TS — use explicit `.ts` extensions and `import type`): PGlite harness that creates stub `auth`
schema (`auth.users`, `auth.uid()` reading `request.jwt.claim.sub` / `request.jwt.claims`),
roles `anon`, `authenticated`, `service_role`, applies all migrations except `*_platform.sql`, and
helpers `asUser(id, fn)`. Cover RLS isolation, friend masking, joint session flow, apply_plan_changes,
tokens hashing (must equal Node `crypto.createHash('sha256')`).

---

## 8. Edge Functions (functions agent) — `supabase/functions`

Deno 2, `npm:` specifiers with pinned versions, one folder per function + `_shared/`.
`supabase/functions/_shared/types.ts` is a **mirror** of `src/domain/types.ts` (edge bundles cannot
import `src/`): keep PlanChange / WorkoutDraft / CoachRequest / CompletedData in sync. `daily_metrics`
rows with source `garmin` are written by both the Personal API sync and the Claude bridge; each
upserts only the fields it knows, so values merge field by field. Pure logic in
`_shared/**` (no Deno globals, explicit `.ts` imports, `import type`) is unit-tested with
`npm run test:functions` (`node --test`). `config.toml` entries are written by the db agent: give
your `verify_jwt` needs in your report (expected: coach/garmin = true … see below).

| Function | Auth | API |
|---|---|---|
| `coach` | user JWT (`verify_jwt=true`) | `POST CoachRequest` → `202 {jobId}`; inserts `coach_jobs`, runs Claude in `EdgeRuntime.waitUntil`, writes `plan_proposals` (source `ai_coach`) + job result. `503 {error:'ai_unavailable'}` when `ANTHROPIC_API_KEY` missing. Rate limit 30 jobs/user/day (`429`). |
| `mcp` | path token, `verify_jwt=false` | `POST /mcp/u/<secret>` Streamable HTTP, stateless JSON responses, dual-era (2025-03-26…2025-11-25 with `initialize`, and 2026-07-28 `_meta`/`server/discover`), GET/DELETE → 405. Resolve user via `svc_resolve_token(sha256(secret),'mcp')`. Never log the path. |
| `ics` | path token, `verify_jwt=false` | `GET /ics/<secret>.ics` → `text/calendar` (VTIMEZONE Europe/Madrid), workouts −14..+56 days + confirmed quedadas; all-day events when no start time. |
| `push-dispatch` | secret key (`verify_jwt=false`, check `apikey` == secret) | Sends unsent `notifications` (last 24 h) straight to APNs (see §13), respects `notification_prefs.social` for social types, marks `pushed_at`/`push_error`, deletes tokens Apple rejects. |
| `apple-revoke` | `verify_jwt=false`, user JWT verified in code | `POST {authorizationCode}` → exchanges it at Apple and revokes the token (SIWA account deletion); `503 apple_not_configured` without `APPLE_*` secrets. |
| `garmin` | `verify_jwt=false`; user JWT verified in code for `connect/disconnect/sync`; secret key for `sync_all` (pg_cron) | Garmin **Personal API** (`docs/research/04` §3.2): exchange key → JWT, pull dailies/sleep/HRV/body battery/activities, upsert `daily_metrics (source 'garmin')`, match activities to planned workouts (complete them) or insert completed unplanned workouts (`source 'garmin'`, `external_id 'garmin:<id>'`). Key encrypted AES-GCM with `GARMIN_KEY_SECRET` (env). Defensive parsing; never log keys. |

**Consent & privacy (coach):** the function answers `403 {error:'consent_required'}` when
`profiles.ai_consent_at` is null (the app falls back to rules and asks for consent first). The AI
context never contains busy-block titles (only start/end).

**Claude API (coach)** — follow the claude-api skill: `npm:@anthropic-ai/sdk@1.3.0`, model
**`claude-opus-5-5`**, adaptive thinking (omit `thinking`), `output_config: { effort: 'medium',
format: <JSON schema of {reply, summary, changes[]}> }` (structured outputs; no forced tool_choice,
no prefill, no temperature), streaming + `finalMessage()`, `timeout ~120 s`, `maxRetries: 1`, prompt
caching on the static system prompt, `client.beta.messages` with `betas: ['server-side-fallback-2026-07-01']`
+ `fallbacks: 'default'`, check `stop_reason` (`refusal`, `max_tokens`) before parsing, validate
every change (ids belong to the user's week, dates inside the week, durations sane) and drop invalid
ones. Record usage in `ai_usage`.

**MCP tools** (snake_case names, Spanish descriptions, `annotations` with `title` +
`readOnlyHint`/`destructiveHint`, `inputSchema` with `additionalProperties:false`, results as
`structuredContent` + JSON text block, errors as `isError: true` with actionable text):
1. `get_planning_context` (read) — profile, thresholds, availability, races + phase, week workouts
   (ids), life events, busy blocks (own titles ok), check-ins & metrics last 14 d, joint sessions,
   last 6 weeks load summary. Param `week_start?`, `detail?: concise|detailed`.
2. `get_friends_availability` (read) — accepted friends' masked weeks + common free slots.
3. `propose_plan_changes` (write) — `{ week_start, summary, changes: PlanChange[], apply_now?: boolean }`
   → stores proposal (source `claude`); `apply_now` applies via `svc_apply_plan_changes`. Default:
   pending, the user reviews in the app (push notification is sent by trigger).
4. `log_life_event` (write) — imprevisto.
5. `log_daily_metrics` (write) — Garmin snapshot days (hrv, resting hr, sleep, body battery,
   training readiness, vo2max, stress, training status) → `daily_metrics (source 'garmin')`.
6. `log_completed_activity` (write) — match & complete a planned workout or create unplanned.
7. `get_plan_for_device` (read) — upcoming planned workouts as structured steps (Garmin-workout
   friendly JSON) so the user's Garmin connector can upload them to the watch.
8. `manage_race` (write) — add/update a race.
Server `instructions`: how to plan with these tools (always read context first, propose changes as a
proposal, respect quedadas and key sessions, Spanish, Europe/Madrid, minutes).

---

## 9. Integrations (integrations agent) — `src/integrations`

Exports the screens rely on:
```ts
// healthkit.ts  (+ healthkit.web.ts stub returning unavailable)
isHealthAvailable(): boolean
requestHealthPermissions(): Promise<boolean>
syncHealth(repo: Repository, opts?: { days?: number }): Promise<{ metricsDays: number; workoutsCompleted: number; activitiesImported: number }>
// calendar.ts
getCalendarPermission(): Promise<'granted' | 'denied' | 'undetermined'>
requestCalendarPermission(): Promise<boolean>
listDeviceCalendars(): Promise<{ id: string; title: string; color: string | null; source: string }[]>
getSelectedCalendarIds(): Promise<string[]>; setSelectedCalendarIds(ids: string[]): Promise<void>
syncCalendarBusy(repo: Repository, range?: DateRange): Promise<{ blocks: number }>
// notifications.ts
getNotificationPermission(): Promise<'granted' | 'denied' | 'undetermined'>
requestNotificationPermission(): Promise<boolean>
registerForPush(repo: Repository): Promise<string | null>
rescheduleLocalNotifications(input: { workouts: Workout[]; profile: Profile; today: ISODate }): Promise<number>
// widgets/TodayWidget.tsx, RaceWidget.tsx, NextWorkoutWidget.tsx  (expo-widgets, 'widget' directive, names match app.config.ts)
// widgets/sync.ts
syncWidgets(input: { workouts: Workout[]; races: Race[]; jointSessions: JointSession[]; profile: Profile | null; today: ISODate }): void
// hooks.ts (for settings screens)
useHealthIntegration(): { available: boolean; enabled: boolean; lastSync: string | null; busy: boolean; connect(): Promise<void>; syncNow(): Promise<void>; disable(): Promise<void> }
useCalendarIntegration(): { permission; calendars; selectedIds; lastSync: string | null; busy: boolean; request(): Promise<void>; setSelected(ids: string[]): Promise<void>; syncNow(): Promise<void> }
useNotificationPermission(): { status; request(): Promise<boolean> }
// AppEffects.tsx — mounted once in root; when signed in & onboarded: register push, route on
// notification tap (data.url), on foreground: health sync, calendar sync, reschedule local
// notifications, refresh widgets. Web-safe (no native calls on web).
```
Widget deep links: `rebufo://workout/<id>`, `rebufo://today`, `rebufo://together`.

---

## 10. UI rules (all UI agents)

- Direction: **race-day hi-vis on ink & paper**. Barlow Condensed for display/numbers (use `variant`
  `hero/display/title/metric/overline`), Barlow for text. Lime (`colors.accent`) only for the
  primary action, "today" and "juntos" highlights. Sports colour-coded via `useTheme().sport(s)` /
  `SportBadge`. Compliance colours only for compliance, always with an icon.
- Hierarchy through scale contrast (big condensed numbers, small overlines), intentional rhythm
  (not uniform padding), cards with sport rails, pressed states (already in primitives), haptics.
- Every screen handles **loading / empty / error** (`Loading`, `EmptyState`, `ErrorNotice` with retry).
- Accessibility: labels on icon buttons, roles, ≥44 pt targets, dynamic type tolerant (no fixed
  heights on text containers), colour never the only signal.
- Spanish copy: friendly, short, tú. Dates "lun 27 oct", 24 h times, decimal comma.
- Confirm destructive actions with `Alert.alert` (native) — on web fall back to `window.confirm`
  via a small helper in your feature folder.
- Web preview must work (demo mode): guard native-only APIs with `Platform.OS`.
- **Trademarks:** TSS/CTL/ATL/TSB/IF are TrainingPeaks terms. Code may use them internally, but the
  UI says **Carga** (load), **Forma física** (fitness/CTL), **Fatiga** (ATL), **Frescura** (form/TSB).
  "Ironman" appears only in the app name ("Road to Ironman", owner's decision, private TestFlight use);
  race distances stay generic ("Media distancia", "Distancia completa"), never "70.3" or the M-Dot logo.

---

## 11. Platform notes (from `docs/research/03-stack-expo-ios.md` — read the relevant section)

- `expo-calendar` SDK 58: the new object API is the default (`Calendar.listEvents(calendars, start, end)`);
  legacy `*Async` functions only via `expo-calendar/legacy`. Reading needs full access.
- `expo-notifications`: foreground notifications shown by default; weekly triggers use 1 = Sunday;
  category ids without `:`/`-`; ≤64 pending local notifications (rolling 7-day window).
- HealthKit: request authorization before ANY query (otherwise crash). Garmin does not write HRV/VO2max to Health.
- `@testing-library/react-native@14`: async API (`await render(...)`).
- No Expo Go for SDK 58: native features are verified on EAS dev builds; web preview uses demo mode.

---

## 12. Changes after the review (2026-10-25)

- **AI consent:** `profiles.ai_consent_at` (server stamps it when granted; `null` = withdrawn). The coach UI asks
  before the first AI request (sheet naming Anthropic and the data categories) and Privacidad lets the user withdraw.
  The coach function answers `403 consent_required` without it; the data layer falls back to rules. Coach deep links
  (`/coach?...`) only **prefill** — the user must tap to send. No busy-block titles in any AI/MCP context.
- **Feed privacy:** `activity_events` / `kudos` are not client-readable; `list_feed` rebuilds joint participants per
  viewer (names only for insiders/eligible friends, `othersCount` otherwise).
- **Limits:** `svc_reserve_coach_job` (atomic 30/day); coach job deadline 110 s, client polls up to 130 s;
  MCP/ICS token gate (per-token bucket, negative cache, per-IP failure budget).
- **Imports:** Garmin sync and `log_completed_activity` skip activities already completed from Apple Health
  (same day, compatible sport, duration ±max(10′,15 %), start ±45′); Claude-logged unplanned rows get
  `externalId 'claude:<uuid>'`; HealthKit unplanned rows `healthkit:<uuid>`.
- **Accounts:** sign-out/deletion unregister the push token (`unregister_push_token`) first; deletion of SIWA accounts
  re-authorises with Apple and calls `apple-revoke`; session stored encrypted (key in Keychain, blob in AsyncStorage).
  Device opt-ins (Apple Salud, calendars, last syncs) are namespaced per user (`<key>.user.<userId>`); sign-out cancels
  local notifications and clears widgets.
- **Engine:** injuries also restrict bricks; cardiac flags expire (endDate + 14 d or medical all-clear note, then 7 easy
  days); callers pass life events from `weekStart − 14`; replanner window is the rolling `today..today+6`
  (`replanWindowEnd`); `PlannerInput.nowMinutes` skips past slots today; B/C-race mini-tapers, rest-day race handling,
  first-A-race compression (PLAN_TOO_SHORT survival plan) and recovery weeks per subphase.
- **Navigation:** root `unstable_settings.anchor = '(tabs)'` (deep links always have a way back); tab-path notification
  taps use `router.navigate`; friend_request links to `/together`; new `/privacy` screen (also linked from sign-in).
- **OTA:** `runtimeVersion.policy = 'fingerprint'`.

---

## 13. Changes on 2026-10-26 (rename, no AI coach, no EAS)

- **Name:** "Road to Ironman"; bundle id `io.github.diegomolinacatala.ironman`, App Group
  `group.io.github.diegomolinacatala.ironman`, widget extension `….ExpoWidgetsTarget`, URL scheme
  `roadtoironman://`. Internal storage/notification ids use the `rti.` prefix.
- **In-app AI coach off:** `env.aiCoachEnabled` (EXPO_PUBLIC_AI_COACH=1) gates every AI path. Off:
  `requestCoach` runs the local rules engine without calling the `coach` function; the UI shows no
  consent sheet, AI badge or Anthropic copy. The `coach` function and `ai_consent_at` stay for later.
  "Conecta tu Claude" (MCP, the user's own subscription) is unaffected.
- **Builds:** no EAS/Expo services. `.github/workflows/ios.yml` runs on a GitHub macOS runner:
  `npm ci` → typecheck + jest → `npx expo prebuild --platform ios --clean` → unsigned archive →
  ad-hoc entitlements (`scripts/ios/sign-archive.sh`) → export + upload to TestFlight with the App Store
  Connect API key (automatic cloud signing). Build number = workflow run number (`IOS_BUILD_NUMBER`).
  `EXPO_PUBLIC_*` values come from repository variables. expo-updates / expo-dev-client removed.
- **Push:** the app registers the raw APNs device token (`getDevicePushTokenAsync`); `push-dispatch`
  sends straight to APNs (HTTP/2, ES256 provider JWT from `APNS_KEY_ID` / `APNS_TEAM_ID` /
  `APNS_PRIVATE_KEY`, topic `APNS_TOPIC`), deleting tokens Apple reports as invalid.

## 14. Launch crash in TestFlight build 4 (2026-10-26)

- **Cause:** expo-widgets stores widget props in the App Group's `UserDefaults`, which only takes
  property lists. A JS `null` reaches Swift as `NSNull`, and `UserDefaults` throws. `createWidget(…,
  { next: null })` ran while `widgets/sync.ios.ts` was imported, so the app aborted on every launch.
  Web and jest never run that file.
- **Rule:** everything sent to a widget (initial props, `updateTimeline`, `updateSnapshot`) goes
  through `toPropertyList` (`widgets/plist.ts`), which drops `null`/`undefined`. Widget layouts must
  treat a missing key as no value (`!= null`, truthiness), never `!== null`.
  `__tests__/widgetSync.test.ts` loads `sync.ios.ts` against a fake that rejects what `UserDefaults`
  rejects.
- **Fatal JS errors in release** no longer abort silently: `index.ts` (the app entry, replacing
  `expo-router/entry`) installs `lib/fatalErrors.ts` before any app module loads. It shows an alert
  with the message and the top of the stack. Development builds keep the red box.
