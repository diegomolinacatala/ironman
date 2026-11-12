# Road to Ironman — notes for coding agents

- Read `docs/V2.md`, `docs/V4.md`, `docs/ARCHITECTURE.md` and `docs/DESIGN.md` (design system + navigation: 5 tabs Hoy · Plan · Juntos · Progreso · Tú, navy "calm endurance" brand, Inter, light/dark/automatic) first: they are the contract (domain types, repository, query hooks, routes, RPCs, edge functions, MCP tools).
- Expo SDK 58 changed many APIs: follow `AGENTS.md` (read versioned docs, use `npx expo install`).
- UI copy is Spanish (Spain); code is English. Use `src/ui` primitives and `src/data/queries.ts` hooks only.
- Without `EXPO_PUBLIC_SUPABASE_*` the app runs on the local demo repository (`src/data/demo`).
- Checks: `npm run test:all` (typecheck + jest + PGlite DB tests + edge-function tests).
- Widget props must be property lists: pass them through `toPropertyList` (`src/integrations/widgets/plist.ts`), never send `null` to expo-widgets.
- iOS builds: GitHub Actions (`.github/workflows/ios.yml`) runs `expo prebuild` on a Mac and uploads to TestFlight; no EAS.
- After adding or updating an Expo package run `node scripts/ios/check-prebuilt-abi.mjs`: a prebuilt module built against another `expo-modules-core` closes the app at launch (build 7). `expo-file-system` is pinned to `58.0.11` for that reason.
- v2 (`docs/V2.md`): the in-app AI is on and free — `coach`/`briefing`/`meal` call Cloudflare Workers AI via `cloudflare/ai` (EXPO_PUBLIC_AI_COACH=0 disables). Never add a paid AI path without asking the owner.
- `src/domain/{zones,prescription,season,periodization,recoveryLayout,constants}.ts` and part of `dates.ts` are mirrored into `supabase/functions/_shared/planning/domain/`: after editing them run `npm run sync:mirror` (`mirror.test.ts` fails otherwise). Never edit the mirror by hand.
- Jest replaces Reanimated globally (`jest.setup.ts`); worker tests: `node --test "cloudflare/ai/src/**/*.test.mts"`.

## Social ("Juntos") — state after v3 (2026-11-04)

Done: friends by @username, visibility `full|summary|busy`, week compare + Huecos + Oportunidades + weekly volume side by side, quedadas (propose / respond / cancel / **edit** / **open to all friends + join** / **comments**), feed with kudos + **`joint_completed`** ("entrenasteis juntos", posted when every accepted participant completed the linked workout, e.g. via Garmin sync), **friends' races + shared-race countdown**, **Juntos card on Hoy**, **quedada reminder ≥ 1 h before** (local notification), **morning briefing mentions today's quedada and pending invites**, **voice coach** gets `friendIds` when a friend is mentioned and may return a `quedada` suggestion (the app only prefills `/joint/new`, never sends it), **MCP `propose_joint_session`** (sends a real invite: Claude must confirm first). DB: `supabase/migrations/20261104000100_social_together.sql`; tests `supabase/tests/together.test.ts`.

Next ideas (not built): Live Activity for a quedada in progress; Garmin "same activity" detection by time overlap when the quedada had no linked workout; shared weekly goals/challenges; group chat beyond one quedada; Android.

## App Store (2026-11-12)

`docs/APP_STORE.md` is the release checklist (TestFlight external link for friends, listing texts, review notes, privacy labels). Moderation for guideline 1.2: `block_user` / `report_user` (`20261112000100_moderation.sql`, `useModeration`). Review account `revision@roadtoironman.app` signs in with a password typed as the 6-digit code (`scripts/review-account.mjs`). Public pages (support, privacy, terms) are built from `site/` + `docs/PRIVACY.md` + `docs/TERMS.md` by `.github/workflows/pages.yml`.

## Coach v4 (2026-11-09) — un entrenador de verdad, COROS y plan general

Every session carries targets (ppm / pace / W / RPE / sensations, derived from thresholds by `domain/zones.ts`, explicit `step.target` wins) and `coaching` (objective, keys, success, plan B); the coach (AI, rules, Claude, briefing) speaks with those numbers and reviews completed sessions (`domain/review.ts`). Watch = Garmin or COROS (`profiles.watch_brand`; COROS via Apple Salud + the official COROS connector in the athlete's Claude, guide in `/settings/coros` and `docs/SETUP.md` §8b). Plan → General (`?view=general`) shows the weeks to the race (carga, más volumen, descarga, afinamiento, carrera) from `domain/season.ts`; week-level overrides live in `week_plans` (MCP `set_week_plans`) and the weekly rules planner honours them. Deploy the two `20261109*` migrations before the functions and the app.
