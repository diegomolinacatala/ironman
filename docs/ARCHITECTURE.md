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

Short-notice plans (2026-11-26): `phaseFor(date, races, { level, recentWeeklyMinutes })`. When the A
race is closer than the minimum viable length (PLAN_TOO_SHORT), an intermediate or advanced athlete
whose last 4 weeks average at least `BASE_READY_HOURS` of the distance (`fitnessWeeklyMinutes`; full 10 h,
half 7,5 h, olympic 6 h…; null with < 2 weeks of training) gets a short base (⅓ of the training weeks)
and build weeks instead of the base-only survival plan; the race and taper weeks stay the same, so
week plans apply to the same weeks. Beginners and athletes without that history are unchanged. The
volume is the 4 weeks before the **current** week and every surface passes the same numbers: the
planner (`PlannerInput.fitnessWeeklyMinutes`, default `recentWeeklyMinutes`), the replanner, Plan →
General (`buildSeason`/`seasonWeekDetail`, `useFitnessMinutes`), the week view, Hoy, Progreso, the rules
coach and the server (planning context, briefing, `set_week_plans`).

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
workouts of the last ~30 days: run cap 1.10×, long-ride +15 % cap, form guard, and the **weekly run
cap**: the week's run minutes, bricks' run leg included, ≤ max(1.15 × the biggest run week of the
last 3, +10', 50') — mirrored `runVolume.ts`; the allocation re-plans the runs keeping the long and
quality ones and gives the freed minutes to bike/swim (run-only plans just lose them); new runs are
trimmed when existing ones fill the week; `PlanWeekResult.runCapMinutes`; the server context shows
the same number as `phase.runMaxMinutes` for the coach and Claude). In race weeks the
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
Navigate with `router.push('/workout/123')`, params via `useLocalSearchParams<{…}>()`. Tab
routes are reached with `router.navigate('/together')` (or `router.dismissTo` from a screen on top
of the tabs), never `router.push`, which would stack a second tab navigator. Five tabs since the
2026-11 rebrand: Hoy · Plan · Juntos · Progreso · Tú (`docs/DESIGN.md` §6).

| Route | Owner | Purpose / params |
|---|---|---|
| `index` | orch | auth/onboarding gate |
| `sign-in`, `verify` (`?email`) | ui-account | email OTP + Apple; demo hint |
| `onboarding` | ui-account | multi-step profile setup, sets `onboardedAt` |
| `(tabs)/today` | ui-plan | Hoy |
| `(tabs)/week` (`?week=YYYY-MM-DD`) | ui-plan | Plan |
| `(tabs)/together` (`?friend`) | ui-together | Juntos (tab): requests, quedadas, compare, shared races, feed |
| `(tabs)/progress` | ui-coach | Progreso (tab): PMC, volume, recovery, nutrition, races |
| `(tabs)/me` | ui-account | Tú (tab): settings hub incl. Apariencia (automático / claro / oscuro) |
| `workout/[id]` | ui-plan | detail + complete/skip/move/edit/delete/invite |
| `workout/edit` (`?id` or `?date&sport`) | ui-plan | create/edit (modal) |
| `event/edit` (`?id` or `?date&kind`) | ui-plan | imprevisto (modal) → offers re-plan |
| `checkin` (`?date`) | ui-plan | daily check-in (modal) |
| `talk` (`?message…`) | ui-talk | voice coach (full-screen modal) |
| `meal` (`?source&date`) | ui-talk | meal photo / description (modal) |
| `briefing` (`?play=1`) | ui-today | morning report (modal) |
| `coach` (`?mode&weekStart&lifeEventId&message`) | ui-coach | v1 links; prepares the request and hands over to `/talk` |
| `proposal/[id]` | ui-coach | diff review, apply selected / all / discard (modal) |
| `races/index`, `races/edit` (`?id`) | ui-coach | races list / form |
| `nutrition` (`?date`) | ui-coach | nutrition log + fueling tips |
| `friends/add` | ui-together | search username, share invite (modal) |
| `friends/[id]` (`?week`) | ui-together | full week compare + huecos + oportunidades |
| `joint/new` (`?friendId&friendIds&date&sport&startTime&durationMin&fromWorkoutId&title&intensity&location&open`) | ui-together | propose quedada (modal) |
| `joint/[id]` | ui-together | quedada detail, accept/decline/cancel, «Repetir la semana que viene» |
| `notifications` | ui-together | **Avisos** inbox (bell on Hoy and Juntos); tap → `data.url` (tab paths via `dismissTo`) |
| `settings/profile` | ui-account | name, username, level, sports, thresholds, coach notes |
| `settings/availability` | ui-account | weekly hours, rest/long/pool days, windows |
| `settings/training` | ui-account | **Tu forma de entrenar**: sessions per sport, preferred days, long ride/run days, intensity model, fixed weekly sessions |
| `settings/notifications` | ui-account | **Notificaciones** prefs (stored in profile) |
| `settings/integrations` | ui-account | Garmin Personal API, Apple Salud, Calendario |
| `settings/claude` | ui-account | "Conecta tu Claude" (MCP URL generator + guide) |
| `settings/calendar-feed` | ui-account | Suscripción de calendario: ICS subscription URL (webcal) |
| `privacy` | ui-account | Privacidad y datos |

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
| `block_user(p_user uuid)` | `void` | Pair row → `blocked`, owned by the blocker (only they can delete it = unblock). Repo `blockUser`. |
| `report_user(p_user uuid, p_reason text, p_context text, p_target uuid, p_details text)` | `void` | Stores a row in `user_reports` (owner reviews it; 20/day per reporter). Repo `reportUser`. |
| `list_friends()` | `table(friendship_id, status, direction, created_at, friend_id, username, display_name, avatar_url, sports)` | |
| `search_profiles(p_query text)` | `table(id, username, display_name, avatar_url, sports)` | ≥2 chars, ilike on username/display_name, excludes self, limit 20. |
| `get_friend_week(p_friend uuid, p_from date, p_to date)` | `table(kind, id, date, start_time, end_time, duration_min, sport, intensity, title, status, joint_session_id)` | Must be accepted friends; max 31 days; masked by friend's `visibility` (full: all; summary: no title; busy: only busy intervals). Busy blocks + timed workouts split per day in the friend's timezone, titles of busy blocks NEVER exposed. Life events: only padel/football/other_sport/travel/social, never health ones. |
| `propose_joint_session(p_session jsonb, p_invitees uuid[], p_from_workout uuid default null)` | `uuid` | Invitees must be accepted friends; creates session, participants (organizer accepted), organizer workout (link existing or create, source 'joint'). |
| `respond_joint_session(p_session_id uuid, p_accept boolean)` | `void` | On accept creates the invitee's linked workout; session → confirmed when ≥1 invitee accepted. |
| `cancel_joint_session(p_session_id uuid)` | `void` | Organizer only; status cancelled; deletes linked *planned* workouts of others, unlinks the organizer's. |
| `list_joint_sessions(p_from date, p_to date)` | `jsonb` (array of `JointSession` camelCase objects) | Sessions where caller participates. |
| `update_joint_session(p_session_id uuid, p_patch jsonb)` | `jsonb` (`JointSession`) | Organizer only (v3, migration `20261104000100`); merged fields re-validated, not to the past; every *planned* linked workout follows; others get `joint_updated`. |
| `list_open_joint_sessions(p_from date, p_to date)` | `jsonb` | Friends' open quedadas (`is_open`) from today the caller is not in; participants the caller is not friends with are left out. |
| `join_joint_session(p_session_id uuid)` | `jsonb` (`JointSession`) | Open quedada of a friend: participant accepted + linked workout, session confirmed, organizer gets `joint_response`. Max 11 people. |
| `list_joint_comments(p_session_id uuid)` / `add_joint_comment(p_session_id uuid, p_body text)` | `jsonb` | Participants only (declined: read only); 1..500 chars, 200 per quedada; others get `joint_comment`. Table `joint_session_comments` has no client access. |
| `list_friend_races()` | `jsonb` (`FriendRace[]`) | Friends' upcoming races; 'busy' friends skipped, `name` null for 'summary'. |
| `svc_propose_joint_session(p_user uuid, p_session jsonb, p_invitees uuid[])` | `jsonb` | Service role only (MCP `propose_joint_session`). `p_session.isOpen = true` allows no invitees and notifies every friend (`joint_open`). |
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
| `get_joint_session(p_session_id uuid)` | `jsonb` (camelCase `JointSession` or null) | Participants' names are not readable via RLS. v3: friends of the organizer also get an open quedada (only participants they are friends with). Feed event `joint_completed` ("entrenasteis juntos") is posted once every accepted participant completed their linked workout. |
| `claim_wake_briefing(p_date date, p_sleep_end timestamptz, p_due_at timestamptz)` | `boolean` | Wake-up briefing, Apple Salud path (§17): takes today's (profile time zone) briefing for this device before it schedules its own local notification; false when not in wake mode or the day is settled. `p_date` = today, wake-up within 18 h, due ≤ 1 h after it (else `validation`). Repo `claimWakeBriefing` (optional, absent in demo). |

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
`svc_reserve_speech(p_user uuid, p_chars int, p_user_daily_chars int, p_user_premium_chars int, p_premium_budget int, p_basic_budget int) returns text`
(`speech` function: the user's characters in 24 h + `p_chars` > `p_user_daily_chars` → null; else, since
00:00 UTC, `'premium'` while all users' premium characters + `p_chars` fit in `p_premium_budget` and the
user's fit in `p_user_premium_chars`, else `'basic'` while all users' basic characters + `p_chars` fit in
`p_basic_budget`, else null; inserts the `ai_usage` row only with a tier; see V2 §3).

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
| `coach` | user JWT (`verify_jwt=true`) | `POST CoachRequest` → `202 {jobId}`; inserts `coach_jobs`, runs Claude in `EdgeRuntime.waitUntil`, writes `plan_proposals` (source `ai_coach`) + job result. `503 {error:'ai_unavailable'}` when there is no AI provider (neither the Workers AI worker nor Claude with `ANTHROPIC_API_KEY` + `AI_ALLOW_PAID=1`). Rate limit 30 jobs/user/day (`429`). |
| `mcp` | path token, `verify_jwt=false` | `POST /mcp/u/<secret>` Streamable HTTP, stateless JSON responses, dual-era (2025-03-26…2025-11-25 with `initialize`, and 2026-07-28 `_meta`/`server/discover`), GET/DELETE → 405. Resolve user via `svc_resolve_token(sha256(secret),'mcp')`. Never log the path. |
| `ics` | path token, `verify_jwt=false` | `GET /ics/<secret>.ics` → `text/calendar` (VTIMEZONE Europe/Madrid), workouts −14..+56 days + confirmed quedadas; all-day events when no start time. |
| `push-dispatch` | secret key (`verify_jwt=false`, check `apikey` == secret) | Sends unsent `notifications` (last 24 h) straight to APNs (see §13), respects `notification_prefs.social` for social types, marks `pushed_at`/`push_error`, deletes tokens Apple rejects. |
| `morning` | secret key (`verify_jwt=false`), pg_cron every 5 min via `private.morning_wake_tick()` | Wake-up briefing sweep (§17): `POST {action:'sweep'}` → `{ candidates, sent, fallbacks, checked, waiting, late, failed, skipped }`. |
| `apple-revoke` | `verify_jwt=false`, user JWT verified in code | `POST {authorizationCode}` → exchanges it at Apple and revokes the token (SIWA account deletion); `503 apple_not_configured` without `APPLE_*` secrets. |
| `speech` | `verify_jwt=false`, user JWT verified in code | `POST {text, voice?}` → `200 {audio (base64), mime, model, tier}`: consent, `svc_reserve_speech` (per-user chars in 24 h + per-user premium share + global premium and basic budgets per UTC day), then the worker's `POST /v1/speech` (15 s). `503 ai_unavailable` on any worker problem (the app keeps the iPhone voice). Contract in V2 §3 and `supabase/functions/README.md`. Never logs the text. |
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
3. `propose_joint_session` (write) — `{ friend_ids[0..10], sport, date, start_time?, duration_min,
   intensity, title, location?, notes?, is_open? }` → `svc_propose_joint_session` (invitees must be
   accepted friends; organizer's linked workout created; invitees get notification + push). Date from
   today to +60 d; ≥1 friend unless `is_open`; same date + sport + title returns the existing quedada
   (`created: false`). The description tells Claude it sends a real invitation: confirm first.
4. `propose_plan_changes` (write) — `{ week_start, summary, changes: PlanChange[], apply_now?: boolean }`
   → stores proposal (source `claude`); `apply_now` applies via `svc_apply_plan_changes`. Default:
   pending, the user reviews in the app (push notification is sent by trigger).
5. `log_life_event` (write) — imprevisto.
6. `log_daily_metrics` (write) — Garmin snapshot days (hrv, resting hr, sleep, body battery,
   training readiness, vo2max, stress, training status) → `daily_metrics (source 'garmin')`.
7. `log_completed_activity` (write) — match & complete a planned workout or create unplanned.
8. `get_plan_for_device` (read) — upcoming planned workouts as structured steps (Garmin-workout
   friendly JSON) so the user's Garmin connector can upload them to the watch.
9. `manage_race` (write) — add/update a race.
Server `instructions`: how to plan with these tools (always read context first, propose changes as a
proposal, propose a quedada only after the user confirms it, respect quedadas and key sessions, Spanish, Europe/Madrid, minutes).

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

- Direction: **calm endurance** (2026-11 rebrand) — the binding spec is `docs/DESIGN.md`. Inter
  everywhere (`variant` `hero/display/title/heading/body/caption/metric/...`). Navy accent
  (`colors.accent`) only for the one primary action per screen; "today", "juntos" and selection use
  `accentSoft` + `onAccentSoft`. Sports colour-coded via `useTheme().sport(s)` / `SportBadge`.
  Compliance colours only for compliance, always with an icon. Light and dark are both designed.
- Hierarchy through scale contrast (tabular metrics, sentence-case headings), intentional rhythm
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
  Since 2026-11-26 a look-alike the athlete marked done by hand (no activity id in `completed`,
  `domain/watchCompletion.ts`, mirrored) is not skipped: the Garmin sync (`enrichCompletedWorkout`, only while
  `completed->>externalId` is null), the HealthKit importer (`updateWorkout`) and `log_completed_activity`
  (`enriched_manual`) give it the activity's duration, distance, average/max HR, load, kcal, power, source and
  id, keeping the athlete's RPE, sensaciones and notes. A look-alike already linked to another activity keeps
  the old behaviour. `CompletedData` gains `maxHr`, `kcal`, `avgPowerW`, `bestPower1MinW`, `bestPower20MinW`.
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

## 15. v2 "tu coach de bolsillo" (2026-10-27)

The product contract is `docs/V2.md`; this section lists what changed in the architecture.

- **Navigation:** three tabs (Hoy, Plan = `week`, Tú = `me`) plus an iOS 26 `NativeTabs.BottomAccessory`
  (`features/accessory`) that opens `/talk` (voice coach) and `/meal?source=camera`. Juntos and Progreso
  moved to root stack routes `/together` and `/progress`. New modals: `/briefing` (`?play=1` reads it
  aloud), `/talk` (fullScreenModal), `/meal` (`?source=camera|library|text`). `/coach` only redirects to
  `/talk` (prefill only).
- **Onboarding** (`features/onboarding`): forced, resumable step machine (bienvenida → objetivo → Garmin →
  Claude → calendario → informe → plan). The v2 migration resets `profiles.onboarded_at`, so existing users
  go through it once. Claude counts as connected when the `mcp` token created there has `lastUsedAt`.
- **In-app AI is ON** (`env.aiCoachEnabled`, `EXPO_PUBLIC_AI_COACH=0` disables) and costs nothing: the
  `coach`, `briefing` and `meal` functions use **Cloudflare Workers AI** through `cloudflare/ai` (see V2 §3,
  *AI provider*; the worker also serves `POST /v1/speech`, neural text-to-speech for the coach voice). `_shared/ai/provider.ts` picks Workers AI → Claude (optional) → none; the Workers port
  (`_shared/platform/workers-ai.ts`) implements the same `ClaudePort`. Consent copy names Cloudflare.
- **Coach rules first (2026-11-26):** with the AI on, a chat message the rules engine is sure about
  (`runRulesFirst`: a move, delete, swap, «hoy no puedo», a match, a dinner, exams, a trip, work or
  stress, no pool, little time, a softer week, more/less of a sport, tired today) is answered by it
  first: exact changes with full prescriptions, instantly, no AI quota (`CoachResponse.instant`, no
  «Modo sin IA»). Pain/illness, friends, questions, planning a whole week, compound or long messages
  go to the AI. `EXPO_PUBLIC_COACH_RULES_FIRST=0` sends everything to the AI. Imprevistos told in the
  message (exams, trips, matches…) are logged (`EditResult.logEvent`).
- **Coach chat reliability (2026-11-22):** chat uses the `concise` context; the model sees short workout ids
  (`w1`, `w2`… — `_shared/coach/short-ids.ts`, mapped back to UUIDs, unknown ids loosely matched by
  title/sport/date) and answers a short change shape (10 keys, structure + prescription in one nullable
  `prescription`; a missing prescription of a new session is filled from the athlete's zones,
  `coach/defaults.ts`). A message asking to change the plan (`coach/intent.ts`: "mueve…", "quita…",
  "hoy no puedo", "tengo pádel el jueves"…) makes changes mandatory and turns thinking on (effort
  `medium`). Each Workers call has its own timeout (`timeoutMs`); ONE repair re-prompt runs when the
  answer is cut, not JSON, every change was dropped or a requested change is missing; a reply never
  claims changes that are not in the proposal. The worker falls back to the reasoning text when
  thinking leaves `content` empty. App: a failed job's notice says why (`failureNotice`); the rules
  fallback understands the same edit intents (`src/data/demo/coachEdits.ts` → move / delete / easy
  update / `replanMissed` / `replanForEvent`); the history sent to the coach summarises each turn's
  proposal and whether it was applied, discarded or is pending; today's conversation is kept on the
  device (`features/talk/talkStorage.ts`, last 20 turns, cleared by "Nueva conversación").
- **New tables/columns:** `briefings` (select-own, server writes), `daily_metrics.sleep_*` (stages,
  start/end), `coach_jobs.extras` (`memory`, `lifeEventId`). Coach memory lines are appended to
  `profiles.coach_notes`; an imprevisto the coach detects is inserted into `life_events`.
- **Data layer:** `analyzeMeal`, `getBriefing`, `generateBriefing`. Every AI path falls back locally
  (`domain/briefing.ts` template, `domain/mealEstimate.ts`); a fallback briefing is cached on the device
  per user/date until a server one exists.
- **Integrations:** on-device speech-to-text (`integrations/speech/useVoiceInput`, expo-speech-recognition,
  es-ES) and text-to-speech (`useSpeaker`: natural Aura-2 voice first — `speechText.ts` prepares the text for the ear and cuts it in sentences, `neuralSpeech.ts` plays them with expo-audio and caches them in `Paths.cache/speech`, voice picked in Tú → Tu coach → Voz (`coachVoice.ts`, stored on the device); any failure hands the rest to expo-speech with the best installed Spanish voice; audio background mode). expo-audio is used WITHOUT its config plugin: the plugin would overwrite the Spanish `NSMicrophoneUsageDescription`; meal
  photos (`integrations/camera/mealPhoto`, downscaled JPEG, private copy in the app's documents); the
  **training calendar** (`integrations/calendar/trainingCalendar`): planned workouts of [today − 1, today + 21]
  written to a "Road to Ironman" calendar with an alarm, never read back as busy time; the
  `BriefingWidget` lock-screen widget → `roadtoironman://briefing?play=1`; the morning notification opens
  `/briefing?play=1`; foreground Garmin sync when the last one is older than 60 min.
- **Tests:** `jest.setup.ts` replaces `react-native-reanimated` with `src/test/reanimatedMock.tsx` (its own
  mock needs the native worklets runtime). Worker tests: `node --test "cloudflare/ai/src/**/*.test.mts"`.
- **Info.plist guard (build 6 rejected, ITMS-90683):** `expo-image-picker` with `microphonePermission: false`
  deleted the `NSMicrophoneUsageDescription` that `expo-speech-recognition` had written. Both now share one
  string (`MICROPHONE_PERMISSION` in `app.config.ts`) and CI runs `scripts/ios/check-info-plist.mjs` (final
  introspected Info.plist: every purpose string + background modes) before prebuild.
- **Prebuilt module guard (build 7 closed at launch, "DYLD Symbol missing"):** SDK 58 ships some modules
  as precompiled xcframeworks (`node_modules/<pkg>/prebuilds`) that go into the app byte-for-byte.
  `expo-file-system@58.0.12` was prebuilt against a newer `expo-modules-core` than the 58.0.26 `expo`
  installs, so it is pinned to `58.0.11`. CI runs `scripts/ios/check-prebuilt-abi.mjs`: every Swift
  symbol a prebuilt framework imports from another prebuilt framework must be exported by it. Re-run
  it after any `npx expo install`; unpin when `expo` moves to a core that matches.


## 16. v4 "un entrenador de verdad", COROS y plan general (2026-11-09)

The product contract is `docs/V4.md`; this section lists what changed in the architecture.

- **Shared pure modules, one copy for app and server.** `src/domain/zones.ts` (thresholds → ppm, pace,
  watts, RPE and sensations per zone; research 02 §2.1/§2.3), `src/domain/prescription.ts` (step lines,
  one-line target summary, plain-text prescription for calendar notes and ICS) and `src/domain/season.ts`
  (week-by-week overview to the target race + `applyWeekPlan`). Edge bundles cannot import `src/`, so
  `scripts/sync-domain-mirror.mjs` (`npm run sync:mirror`) generates
  `supabase/functions/_shared/planning/domain/` from `constants`, `dates` (subset), `recoveryLayout`,
  `periodization`, `zones`, `season`, `prescription` and `watchCompletion`; `mirror.test.ts` fails in
  `test:functions` when the copy is stale. The server's old approximate `phaseFor` is now an adapter over the mirrored engine, so the
  app, the AI coach, Claude and the briefing describe the same week.
- **Concrete sessions.** `WorkoutStep` gains `target` (explicit ranges), `cue` and `leg` (jsonb, no
  migration); targets are otherwise derived at render/export time from the step intensity and the current
  thresholds. `workouts.coaching jsonb` holds objective, keys, success criterion and plan B (validated in
  `apply_plan_changes`; direct client writes are validated by the repository). `CompletedData.feel` stores
  sensations (1–5); `domain/review.ts` compares the session with the plan; `domain/planB.ts` builds the
  easier version ("No es mi día").
- **Season plan.** Table `week_plans` (own rows, PK user + Monday, kind `load|push|recovery|rest`, optional
  minutes and note, source `manual|ai_coach|claude`, realtime topic `week_plans`), repository
  `listWeekPlans / saveWeekPlans / deleteWeekPlan`, hooks `useWeekPlans / useSaveWeekPlans /
  useDeleteWeekPlan`. Overrides apply only to prep/base/build weeks without a race; the rules planner honours
  them through `PlannerInput.weekPlan`. Plan tab: `?view=general` (default week view unchanged). The coach
  may suggest week plans (`CoachResponse.weekPlans`, stored in `coach_jobs.extras.weekPlans`); Claude writes
  them with the MCP tool `set_week_plans` (10 tools now).
- **COROS.** `profiles.watch_brand` (`garmin | coros`, null = Garmin). COROS has no personal API: data comes
  from Apple Salud on the iPhone (HealthKit importer, `source 'healthkit'`) and, optionally, from the athlete's
  Claude with the official COROS connector writing through our MCP (`log_daily_metrics` `source 'coros'`).
  Metrics merge priority everywhere: garmin > coros > healthkit > manual. Onboarding step 3 is "Tu reloj"
  (id still `garmin` for saved progress); `/settings/coros` is the full guide. `get_plan_for_device` is
  device-neutral (Garmin JSON + provider-neutral steps Claude can push to the COROS calendar).
- **Deploy order:** `supabase db push` (`20261109000100_coach_v4.sql`, then `20261109000900_week_plans_platform.sql`)
  before deploying the edge functions or shipping the app.

## 17. Race plan, finish-time prediction and the wake-up briefing (2026-11-26)

- **Plan de carrera** (Carreras, under the next A race; highlighted and open from 21 days before):
  `domain/raceDay.ts` (documented coaching tables: bike × FTP sprint 0.90–0.95, olympic 0.85–0.90, half
  0.75–0.82, full 0.65–0.75; run off the bike = threshold pace × open-race factor × fade; leg distances),
  `domain/racePlan.ts` (swim pace per 100 m + feel, bike watts in three blocks with an uphill ceiling and an HR
  cap without FTP, run in three parts with HR guidance, fueling g/h + fluids + sodium + intakes by minute via
  `fueling.intakeSchedule`, T1/T2 checklist; missing thresholds degrade to HR, then RPE/feel, and `missing`
  says what to add), `domain/racePlanCopy.ts` (Spanish copy). UI: `features/races/RacePlanSection.tsx`.
- **Previsión** (`domain/racePrediction.ts` + `domain/bikeSpeed.ts`): per-leg and total range (optimistic –
  conservative). Swim = CSS + race offset + 3–6 s/100 m open water, course up to 3 % longer (level CSS when
  missing, flagged); bike = flat-course physics P·η = Crr·m·g·v + ½ρ·CdA·v³ (CdA by level 0.36/0.32/0.28, Crr
  0.005, 80 kg, ρ 1.20, η 0.975) on the plan's power band, slow end +4 % for turns/aid stations/wind, or, without
  FTP, the median speed of recent rides at race heart rate; run = plan pace band, slow end + tough-day fade;
  typical transitions; total = sum of the legs. Hidden (with a hint) without FTP/rides or threshold pace. The
  plan's fueling is timed with the predicted leg minutes.
- **Informe al despertar** (optional; `notification_prefs.morningMode = 'wake'`, `wakeDelayMin` 5/10/15/30,
  optional `wakeWindow`; fixed time stays the default). Shared pure module `domain/wakeWindow.ts`, mirrored
  to the server: usual window from the last 21 nights (earliest − 30 min, latest + 60 min, weekday/weekend
  apart when each has enough nights, trimmed with ≥ 7), the athlete's own window wins, default = the 2 h before
  the fixed time; `decideWake` → wait / check / send at wake-up + delay / fallback at
  max(window end, fixed time), held up to 3 h while a night is known to go on, never more than 3 h late.
  - *Server path (real):* migration `20261126000300_wake_notification.sql` — `briefing_notices` (user, local
    day; `watching → push | device | skipped`; select-own RLS), notification type `morning_briefing` (inserted
    already read), RPCs `svc_wake_candidates`, `svc_record_wake_check`, `svc_send_morning_briefing`,
    `svc_skip_morning_briefing`, `claim_wake_briefing`. `20261126000301_wake_notification_platform.sql` adds the
    cron job `rti-morning-wake` (every 5 min, `private.morning_wake_tick()` calls the `morning` function only
    while someone in wake mode is in an unsettled morning). The sweep (`_shared/morning/*`) sends through the
    existing notifications → push-dispatch path; Garmin users get a light pull of today's sleep at most every
    10 min inside their window (`_shared/garmin/sleep-pull.ts`, 2 Personal API calls).
  - *Device path (best effort):* Apple Salud only reaches the server when the app syncs. The HealthKit config
    plugin now has `background: true` (background-delivery entitlement); `integrations/health/sleepWatch.ts`
    registers a sleep observer (`configureBackgroundTypes`) so iOS may wake the app when a watch app writes the
    night; `useWakeBriefing` → `health/wakeBriefing.ts` reads the main sleep (`sleepWindowsByDate`: naps do not
    move the wake-up), claims the day and schedules a local `wake_briefing` notification at wake-up + delay
    (outside the rolling window, cancelled on sign-out). Wake mode with a backend drops the local fixed-time
    briefing (`ScheduleInput.serverWake`); demo keeps it. HealthKit drafts now carry `sleepStart`/`sleepEnd`.
  - *Deploy order:* `supabase db push` (000300, then 000301) → `functions deploy morning` → once
    `select private.schedule_platform_jobs();` → app build (new entitlement). Needs `APNS_*`; Garmin pulls need
    `GARMIN_KEY_SECRET`.

## 18. Planner and races (2026-11-26)

Four changes approved by David; the contract details live in §4 (`periodization.ts`, `planner.ts`) and `docs/V4.md`.

- **Softer ramp cap.** `rampCapMinutes`: the volume cap over the biggest of the last 3 weeks is +20 % at most
  (+15 % beginners, +10 % under life stress; +15' minimum). The coach prompt states the same numbers.
- **Weekly run cap.** Mirrored `domain/runVolume.ts`; the rules planner caps the week's run minutes (bricks count
  their run leg) and the planning context shows the same number as `phase.runMaxMinutes`.
- **Short-notice plans from real volume.** `PhaseOptions.recentWeeklyMinutes` (see §4 `periodization.ts`).
- **How a B/C race is prepared — `races.prep`** (migration `20261126000100_race_prep.sql`): `text`, null or
  `'training' | 'taper' | 'specific'` (check constraint; covered by the table grants and own-rows RLS).
  `Race.prep?` / `RaceDraft.prep?` (`RACE_PREPS`, `RacePrep`), zod `raceDraftSchema.prep`, app mappers (a null
  prep is left out of inserts), server `mapRace` / `RACE_COLS` / `RaceWrite`, demo repository and both seeds
  (the demo B race is `specific`), MCP `manage_race` (`prep`, nullable). null = the priority's default (B →
  `taper`, C → `training`); A races ignore it (`racePrepOf`).
  - `training` («Como entreno»): race week × 0.9, the race alone (no activation), easy day before, no recovery
    week after (the old C behaviour).
  - `taper` («Solo afinar»): mini-taper (race week × 0.65, activation D−1, no hard day 48 h before) and the
    post-race recovery (the old B behaviour).
  - `specific` («Preparación específica»): `PhaseInfo.specificPrep` = 1 session two weeks before the race week
    and 2 the week before (`SPECIFIC_PREP_SESSIONS`), only in prep/base/build weeks of a plan towards an A
    race. `specializeForRace` (planner and Plan → General detail) retargets short race-pace bricks and turns
    bike/run quality sessions into race-pace sets (`BK_RP`, new `RN_RP`) with the B race's distance
    (`SessionSpec.raceDistance`, `specificFor`); long sessions and long bricks keep serving the A race. They
    become key sessions and the Z1-Z2 guard eases them last. Then the mini-taper and recovery as `taper`.
  Plan → General's `why` and the week focus say which preparation applies; the form asks «¿Cómo la
  preparas?» for B/C races (`RaceForm`, `raceFormModel`).
- **Deploy order:** `supabase db push` (`20261126000100_race_prep.sql`) before deploying the edge functions
  (`RACE_COLS` reads `prep`) or shipping the app.

## 19. Indoor trainer, offline saves, repeated quedadas and zone reviews (2026-11-26)

- **MyWhoosh** (`domain/mywhoosh.ts`): hand-curated catalog of free MyWhoosh workouts (source: the fan site
  mywhooshinfo.com, checked 26-11-2026). `myWhooshFor(workout, { thresholds, raceDistance })` reads the session's
  main set (kind, rep length, rep count, then duration; sweet spot from the title or its 88–94 % target; race pace
  → tempo or sweet spot by % FTP; rides over 105' → «90 Minute Endurance» + free ride). Opt-in device setting
  `rti.myWhoosh.v1` (`features/workouts/myWhooshSetting.ts`, Tú › Entrenamiento); when on, planned bike sessions
  show one line under the structure (`detail/MyWhooshNote.tsx`).
- **Offline check-in and «Hecho»** (`data/offline/`): `useUpsertCheckin` and `useCompleteWorkout` run with
  `networkMode: 'always'` through `saveOrQueue`: a `network | unavailable | rate_limited | not_authenticated` error,
  a request slower than 10 s or `onlineManager` offline keeps the change in a per-account AsyncStorage queue
  (`rti.offline.queue.v1.user.<id>`, one item per `checkin:<date>` / `complete:<workoutId>`) and resolves with the
  optimistic result; other errors throw as before. `useWorkouts` / `useWorkout` / `useCheckins` lay the queue over
  the server data (`pendingOverlay.ts`), so the optimistic state survives refetches and restarts. `OfflineSyncBridge`
  (mounted by `RepositoryProvider` while signed in) flushes on sign-in, foreground, `onlineManager` back online,
  «Reintentar» and a 15 s → 5 min backoff timer. Idempotent: check-ins upsert by date; a queued «Hecho» first reads
  the session (deleted → dropped; same or newer manual «Hecho» → nothing sent; completed by the watch → only RPE,
  sensations and notes are added). «Reabrir» drops a queued «Hecho». Notice: `features/offline/OfflineNotice.tsx`
  (Hoy, workout detail, check-in result). React Native has no network listener installed (no NetInfo): there the
  foreground and the timer do the work.
- **«Repetir la semana que viene»** (`joint/[id]`, organiser or accepted participant, not cancelled):
  `jointForm.repeatPrefill` opens `/joint/new` with the same sport, title, start time, duration, intensity, place and
  people (everyone but me who did not decline, `friendIds` comma-separated; the form keeps only current friends),
  date + 7 days (never in the past: `nextWeekDate`). Notes are not copied; open only if I organised an open one.
  The athlete reviews and sends; nothing is sent by itself.

## 20. Weather for outdoor training (2026-11-26)

Weather is a **separate layer that proposes changes to an existing week**; the planner
(`allocation`, `placement`, `periodization`, `plannerSupport`) is untouched and nothing is ever applied
without the athlete reviewing a proposal.

- **City, never the device location.** `profiles.weather_place / weather_lat / weather_lon` (all three or
  none, client-updatable; `Profile.weatherPlace`). Picked in *Tú › Entrenamiento › Tu ciudad para el
  tiempo* (`/settings/weather`, `WeatherPlaceSettings`): one search per tap on *Buscar*, never while typing.
  Plan shows one quiet hint (`WeatherPlaceHint`) only without a city and with outdoor sessions left.
- **Providers (free, allowed in a free App Store app).** Forecast: **MET Norway Locationforecast 2.0**
  (`compact`; NLOD 2.0 / CC BY 4.0: credit «Datos del tiempo: MET Norway», linking to the licence, wherever a
  forecast is shown). City search: **Nominatim / OpenStreetMap** (ODbL: «© colaboradores de OpenStreetMap»;
  usage policy: identifying `User-Agent`, at most 1 request/s for the whole app, no autocomplete, cached
  results). Both are called only from the server with `WEATHER_USER_AGENT` (app name + support page).
- **Edge function `weather`** (`verify_jwt = false`, JWT checked in code): `{ action: 'forecast' }` → the
  forecast of the athlete's own city (coordinates come from the profile, never the request, so it is not
  an open proxy) and `{ action: 'search', query }` → places. `_shared/weather/`: `met.ts` (fetch + parse,
  `Expires` / `If-Modified-Since`), `geocode.ts`, `service.ts` (cache-first `cachedForecast`, stale copy
  < 24 h when MET fails, UTC steps → local hours with 6-hour blocks spread as `coarse` hours,
  `safeForecast` that never throws for the AI paths), `prompt.ts` (compact Spanish context, no
  coordinates). Tables (service role only, no user id): `weather_forecasts` (PK coordinates rounded to
  2 decimals), `geocode_results` (30 days), `provider_calls` + `svc_reserve_provider_call` (global
  spacing). Migration `20261126000500_weather.sql`. Logs never contain the city, the query or coordinates.
- **Pure rules** `src/domain/weather.ts` (mirrored to the server by `sync:mirror`): dry hour = chance
  < 30 %, < 0.1 mm and no wet symbol; rainy hour = ≥ 0.5 mm (≥ 0.3 mm/h in a 6-hour block) with chance
  ≥ 60 % or unknown (MET gives no probability outside the Nordic area); a session is rainy when ≥ half its
  window is rainy (untimed: 07:00–22:00); a dry gap holds the session + 30'. Outdoor = run, bike, brick,
  unless the title says rodillo / trainer / MyWhoosh / Zwift / indoor / cinta…; swim, strength and
  mobility are never affected.
- **Proposal builder** `src/domain/weatherPlan.ts` (app only): key sessions first; same-day dry gap →
  new time; week scope: another day's dry gap that keeps the re-planner rules (rest day, restrictions,
  no two hard sessions a day, no hard days in a row, ≤ 2 sessions a day, never two of a sport); else
  `weatherIndoor.ts` (bike → «Rodillo», same structure; run → pool or trainer with a similar load; brick →
  trainer). Quedadas only get a sentence (decide it with your partner). `weatherWeek.ts` folds the layer
  into «Planificar semana» as one proposal (`model 'weather:plan:<signature>'`).
- **Checks** (`src/features/weather/`, mounted by `AppEffects`): weekly on the first open on Monday (or
  Sunday ≥ 18:00 for the next week) and daily on the first open of each day. At most one weather proposal
  a day; a signature (sessions + outcome, FNV-1a) is never proposed again once the athlete discarded it;
  sessions in a pending weather proposal are left out; out-of-date pending ones are closed by the app.
  Proposals are ordinary `replan` proposals (`source 'rules'`, `model 'weather:<day|week>:<signature>'`),
  shown as an «El tiempo» banner in Hoy.
- **Messages.** Hoy: one quiet line on today's outdoor session (rain on the card, a dry forecast inside the
  details, always with the credit). Briefing: one sentence only when today's outdoor session falls in the
  rain, both in the local script (`briefingScript.ts`) and in the server context/prompt. AI coach: seven
  days of outlook in its context (`weather` in `coach/messages.ts`). Demo mode: deterministic example
  forecast and a fixed list of cities, labelled «Tiempo de ejemplo».
- **Deploy:** `supabase db push` (`20261126000500_weather.sql`), then deploy `weather`, `briefing` and
  `coach`, then ship the app. No secrets needed (`GEOCODER_URL` / `MET_FORECAST_URL` optional overrides).

## 21. Planner for real athletes: habitual volume, long sessions, exams, beginners (2026-11-26)

Found with an evaluation harness (`planWeek` for realistic athletes, automatic availability, a month of history);
tests in `src/domain/__tests__/plannerRealistic.test.ts`.

- **Habitual volume (automatic availability only).** Mirrored `season.ts`: `habitualWeeklyMinutes(recent)` (average
  of the recent weeks, null with < 2 or all zero), `habitualFloorMinutes(info, weeklyHours, recent, plan?)` and
  `weekMinutesFor({ weeklyHours, info, auto, recentWeeklyMinutes, plan })`. A normal prep/base/build week never asks
  for less than the habitual volume, a descarga never for less than `HABITUAL_RECOVERY_SHARE` (60 %) of it; both are
  capped by the automatic peak hours, and the planner's ramp cap still applies on top. No floor for taper, race and
  post-race weeks, a «Semana libre» or a week with explicit minutes. The planner uses the 4 weeks before the current
  week (`fitnessWeeklyMinutes`, default `recentWeeklyMinutes`); Plan → General (`buildSeason` with
  `recentWeeklyMinutes`), the week view (`weekPhaseOf`) and the server (`planning/phase.ts` `targetMinutes`) show the
  same number.
- **Long sessions first.** Half/full distance in prep/base/build: with few minutes a sport gets fewer sessions rather
  than losing its long one (`SportPlanInput.keepLong`). Placement queues long sessions and bricks before quality
  sessions (`queueRank`), so they take the weekend and the quality goes on weekdays (this also fixes a long run on a
  Wednesday in maintenance weeks). A sport's only session is never a quality one.
- **Exams** (`restrictions.ts` `examEffects`): on exam days only easy sessions of ≤ 45' (`EXAM_DAY_MAX_MIN`), no
  quality the day before, at most one quality session in the week (swim CSS included). The planner cuts the whole
  week by `examVolumeFactor` (−30 %, −40 % at severity 3; not applied to a descarga, already lighter), swaps heavy
  strength for maintenance and says it in the summary: «Semana de exámenes: 5h 35' en vez de 8h, sin series el día
  antes ni el día del examen.» (or «coincide con la descarga»).
- **Stress never lifts a week.** Life stress (stress/work/exam events of severity ≥ 2, or `PlannerInput.checkinStress`
  ≥ 4 from today's check-in, passed by `useWeekData`) moves the cadence to 2:1 and slows the ramp; when the calm
  cadence gives the week a descarga or less volume, that phase stays (`stressedPhase`).
- **Beginners:** at most 1 quality session in base and 2 in build (`BEGINNER_QUALITY_MAX`, swim CSS counted) and
  maintenance strength instead of heavy.

## 22. «Tu forma de entrenar»: the athlete's own distribution (2026-11-26)

Tú › Entrenamiento › **Tu forma de entrenar** (`settings/training`, `TrainingPrefsEditor`, `trainingPrefsModel.ts`;
the row shows the summary or «Automático»). Stored in `profiles.training_prefs jsonb` (nullable = everything
automático; `20261126000600_training_prefs.sql`: own row, client-writable, outline + 8 KB checked by the database,
every field by `trainingPrefsSchema` in `validation.ts`). Mirrored `domain/trainingPrefs.ts`: `parseTrainingPrefs`
(lenient reader used by the app mappers and `db/rows.ts` `mapProfile`), `trainingPrefsSummary` /
`trainingPrefsSentence`, `fixedSessionsOn`, `lowIntensityShareFor`. Everything optional:

- **Sessions per week per sport** (`sessionsPerWeek`, swim/bike/run 0-7, strength 0-3). `allocateWeek` uses the
  number instead of the table and weights the sport's share of the week (×½-×2, 0 = no time), so sessions stay
  above the minimum length; the week's minutes, the run cap and the minimum session lengths still apply. No strength
  in race and post-race weeks whatever the number.
- **Preferred days** (`preferredDays` per sport, `longRideDays`, `longRunDays`, 0 = Monday). Soft: placement adds
  `OFF_PREFERENCE_PENALTY` on other days and `RESERVED_DAY_PENALTY` when a session without a preference takes a day
  another sport prefers; long ride/run days become the week's long-session days; the rest day avoids preferred days.
- **Intensity model** (`intensityModel`): «Automático» (Z1-Z2 ≥ 75 %), «Polarizado 80/20» (≥ 80 %, at most 2 hard
  sessions, tempo/sweet spot → threshold), «Piramidal» (≥ 70 %, threshold/VO2 → tempo/sweet spot, one more quality
  in base). `enforceIntensityDistribution(…, minShare)` checks the share.
- **Fixed weekly sessions** (`fixedSessions`, ≤ 10: sport, weekday, optional time, 10-360', title). Each planned week
  proposes them as new workouts (easy, `source: 'rules'`) unless that day already has a session of that sport, a race
  or a restriction that forbids it; they count as existing sessions (volume, sport sessions, the day's load) so the
  planner plans around them, and their day is never the rest day.
- The week summary ends with «Según tu forma de entrenar: piscina L y X, larga S.».
- Server: `athlete-view.ts` `trainingPrefsView` → MCP `get_planning_context` `athlete.trainingPrefs` («automático» or
  the choices with `summary`, `how`, `intensity.lowIntensityShare`); the coach and the briefing read the same view.
  Safety (injuries, illness, load ramp) always wins over the preferences.
