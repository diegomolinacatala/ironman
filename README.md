# Road to Ironman

**Tu coach de triatlón de bolsillo.** App iOS que lee tu Garmin, vive en tu calendario y se adapta a lo
que le cuentas:

- **Onboarding guiado** — conecta Garmin, Claude y tu calendario en unos minutos.
- **Hoy** — informe de cada mañana (cómo has dormido y qué te toca, también en audio), tu entreno y tus comidas.
- **Coach por voz** — cuéntale una lesión, un cambio de planes o una preferencia y ajusta tu plan.
- **Fotos de comidas** — haz una foto y calcula lo que llevas.
- **Calendario** — tus entrenos aparecen en el calendario del iPhone, con aviso.
- **Widget** en la pantalla de bloqueo para escuchar el informe; **Conecta tu Claude** (MCP) para hablar de tu
  plan desde claude.ai. La IA de la app es gratuita (Cloudflare Workers AI).

## Empezar

```bash
npm install
```

```bash
npm run web
```

Sin backend arranca en **modo demo**. Para el backend, las builds (GitHub Actions → TestFlight) y la puesta en marcha: [docs/SETUP.md](docs/SETUP.md).

## Documentación

- [docs/SETUP.md](docs/SETUP.md) — puesta en marcha (Supabase, Apple, GitHub Actions, TestFlight, Claude, Garmin).
- [docs/V2.md](docs/V2.md) — la v2 (coach de bolsillo): experiencia y contratos.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitectura y contratos.
- [docs/PRODUCT.md](docs/PRODUCT.md) — resumen de la investigación y alcance del MVP.
- [docs/PRIVACY.md](docs/PRIVACY.md) — borrador de política de privacidad para App Store Connect.
- [docs/research/](docs/research/) — investigación: planificadores existentes, reglas de entrenamiento,
  stack Expo/iOS, integración Garmin, Claude/MCP y Supabase.

## Stack

Expo SDK 58 · React Native 0.88 · Expo Router · TanStack Query · Supabase (Postgres + RLS, Auth,
Edge Functions) · Cloudflare Workers AI · MCP (conector de Claude) · APNs · expo-widgets · HealthKit ·
EventKit · reconocimiento y síntesis de voz en el iPhone · GitHub Actions.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run web` | Vista previa en el navegador (modo demo) |
| `npm run typecheck` | TypeScript |
| `npm test` | Tests de app y dominio (jest) |
| `npm run test:db` | Tests de base de datos (PGlite: RLS, RPCs, triggers) |
| `npm run test:functions` | Tests de las Edge Functions (lógica pura) |
| `npm run test:all` | Todo lo anterior |

> "IRONMAN" y "70.3" son marcas registradas de World Triathlon Corporation; esta app no está afiliada a ella.
