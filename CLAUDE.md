# Road to Ironman — notes for coding agents

- Read `docs/V2.md` and `docs/ARCHITECTURE.md` first: they are the contract (domain types, repository, query hooks, routes, RPCs, edge functions, MCP tools).
- Expo SDK 58 changed many APIs: follow `AGENTS.md` (read versioned docs, use `npx expo install`).
- UI copy is Spanish (Spain); code is English. Use `src/ui` primitives and `src/data/queries.ts` hooks only.
- Without `EXPO_PUBLIC_SUPABASE_*` the app runs on the local demo repository (`src/data/demo`).
- Checks: `npm run test:all` (typecheck + jest + PGlite DB tests + edge-function tests).
- Widget props must be property lists: pass them through `toPropertyList` (`src/integrations/widgets/plist.ts`), never send `null` to expo-widgets.
- iOS builds: GitHub Actions (`.github/workflows/ios.yml`) runs `expo prebuild` on a Mac and uploads to TestFlight; no EAS.
- v2 (`docs/V2.md`): the in-app AI is on and free — `coach`/`briefing`/`meal` call Cloudflare Workers AI via `cloudflare/ai` (EXPO_PUBLIC_AI_COACH=0 disables). Never add a paid AI path without asking the owner.
- Jest replaces Reanimated globally (`jest.setup.ts`); worker tests: `node --test "cloudflare/ai/src/**/*.test.mts"`.
