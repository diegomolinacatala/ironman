# Rebufo — notes for coding agents

- Read `docs/ARCHITECTURE.md` first: it is the contract (domain types, repository, query hooks, routes, RPCs, edge functions, MCP tools).
- Expo SDK 58 changed many APIs: follow `AGENTS.md` (read versioned docs, use `npx expo install`).
- UI copy is Spanish (Spain); code is English. Use `src/ui` primitives and `src/data/queries.ts` hooks only.
- Without `EXPO_PUBLIC_SUPABASE_*` the app runs on the local demo repository (`src/data/demo`).
- Checks: `npm run test:all` (typecheck + jest + PGlite DB tests + edge-function tests).
