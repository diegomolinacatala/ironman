# Road to Ironman — notes for coding agents

- Read `docs/V2.md`, `docs/ARCHITECTURE.md` and `docs/DESIGN.md` (design system + navigation: 5 tabs Hoy · Plan · Juntos · Progreso · Tú, navy "calm endurance" brand, Inter, light/dark/automatic) first: they are the contract (domain types, repository, query hooks, routes, RPCs, edge functions, MCP tools).
- Expo SDK 58 changed many APIs: follow `AGENTS.md` (read versioned docs, use `npx expo install`).
- UI copy is Spanish (Spain); code is English. Use `src/ui` primitives and `src/data/queries.ts` hooks only.
- Without `EXPO_PUBLIC_SUPABASE_*` the app runs on the local demo repository (`src/data/demo`).
- Checks: `npm run test:all` (typecheck + jest + PGlite DB tests + edge-function tests).
- Widget props must be property lists: pass them through `toPropertyList` (`src/integrations/widgets/plist.ts`), never send `null` to expo-widgets.
- iOS builds: GitHub Actions (`.github/workflows/ios.yml`) runs `expo prebuild` on a Mac and uploads to TestFlight; no EAS.
- After adding or updating an Expo package run `node scripts/ios/check-prebuilt-abi.mjs`: a prebuilt module built against another `expo-modules-core` closes the app at launch (build 7). `expo-file-system` is pinned to `58.0.11` for that reason.
- v2 (`docs/V2.md`): the in-app AI is on and free — `coach`/`briefing`/`meal` call Cloudflare Workers AI via `cloudflare/ai` (EXPO_PUBLIC_AI_COACH=0 disables). Never add a paid AI path without asking the owner.
- Jest replaces Reanimated globally (`jest.setup.ts`); worker tests: `node --test "cloudflare/ai/src/**/*.test.mts"`.

## Social ("Juntos") — state after v3 (2026-11-04)

Done: friends by @username, visibility `full|summary|busy`, week compare + Huecos + Oportunidades + weekly volume side by side, quedadas (propose / respond / cancel / **edit** / **open to all friends + join** / **comments**), feed with kudos + **`joint_completed`** ("entrenasteis juntos", posted when every accepted participant completed the linked workout, e.g. via Garmin sync), **friends' races + shared-race countdown**, **Juntos card on Hoy**, **quedada reminder ≥ 1 h before** (local notification), **morning briefing mentions today's quedada and pending invites**, **voice coach** gets `friendIds` when a friend is mentioned and may return a `quedada` suggestion (the app only prefills `/joint/new`, never sends it), **MCP `propose_joint_session`** (sends a real invite: Claude must confirm first). DB: `supabase/migrations/20261104000100_social_together.sql`; tests `supabase/tests/together.test.ts`.

Next ideas (not built): Live Activity for a quedada in progress; Garmin "same activity" detection by time overlap when the quedada had no linked workout; shared weekly goals/challenges; group chat beyond one quedada; Android.
