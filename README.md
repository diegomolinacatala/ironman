# Rebufo

**Entrena a rueda de tus amigos.** App iOS para planificar el triatlón en pareja o en grupo pequeño:
semana de entrenos, imprevistos que reorganizan el plan, coach con IA, conexión con *tu* Claude y
con Garmin, y calendarios compartidos para cuadrar quedadas.

- **Hoy / Semana** — plan semanal (lun–dom), cumplimiento por colores, totales, fase y cuenta atrás.
- **Imprevistos** — pádel, fútbol, lesión, trabajo, estrés… → propuesta de cambios que aceptas uno a uno.
- **Coach** — motor de reglas (siempre disponible) + Coach IA (Claude) + **Conecta tu Claude** (MCP).
- **Juntos** — amigos, calendario compartido con privacidad, **huecos** comunes, **quedadas**, feed.
- **Datos** — Garmin (Personal API oficial), Apple Salud, calendario del iPhone, check-in diario, nutrición.
- **Widgets y notificaciones** — hoy/mañana, cuenta atrás, pantalla de bloqueo, recordatorios.

## Empezar

```bash
npm install
```

```bash
npm run web
```

Sin backend arranca en **modo demo**. Para el backend, las builds y TestFlight: [docs/SETUP.md](docs/SETUP.md).

## Documentación

- [docs/SETUP.md](docs/SETUP.md) — puesta en marcha (Supabase, EAS, TestFlight, Claude, Garmin).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — arquitectura y contratos.
- [docs/PRODUCT.md](docs/PRODUCT.md) — resumen de la investigación y alcance del MVP.
- [docs/PRIVACY.md](docs/PRIVACY.md) — borrador de política de privacidad para App Store Connect.
- [docs/research/](docs/research/) — investigación: planificadores existentes, reglas de entrenamiento,
  stack Expo/iOS, integración Garmin, Claude/MCP y Supabase.

## Stack

Expo SDK 58 · React Native 0.88 · Expo Router · TanStack Query · Supabase (Postgres + RLS, Auth,
Edge Functions) · Claude API (`claude-opus-5-5`) · MCP · expo-widgets · HealthKit · EventKit.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run web` | Vista previa en el navegador (modo demo) |
| `npm run typecheck` | TypeScript |
| `npm test` | Tests de app y dominio (jest) |
| `npm run test:db` | Tests de base de datos (PGlite: RLS, RPCs, triggers) |
| `npm run test:functions` | Tests de las Edge Functions (lógica pura) |
| `npm run test:all` | Todo lo anterior |

> "IRONMAN" y "70.3" son marcas registradas de World Triathlon Corporation; Rebufo no está afiliada.
