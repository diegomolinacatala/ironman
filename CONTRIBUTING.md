# Cómo contribuir a Road to Ironman

Somos un equipo pequeño (Diego, David, Nico y Darius) y trabajamos como una startup: todo cambio entra en `main` por una pull request, con la CI en verde. Cada persona fusiona sus propias PR; no hace falta esperar a nadie salvo en las rutas protegidas (ver más abajo).

## Primer día

1. Acepta la invitación al repositorio en GitHub y clónalo.
2. `npm ci` y `npx expo start`. Sin `.env` la app arranca con el repositorio demo (`src/data/demo`): no necesitas Supabase ni Cloudflare para empezar.
3. Lee `CLAUDE.md` / `AGENTS.md` y `memoria/Inicio.md`. Tu asistente (Claude Code o Codex) los lee solo al abrir el repo por la raíz.
4. Opcional: abre la carpeta `memoria/` como bóveda en [Obsidian](https://obsidian.md) para navegar la memoria con enlaces. Es Markdown normal; cualquier editor sirve.

## El ciclo de un cambio

1. **Tarea.** Coge una issue del tablero (o crea una) y asígnatela para que nadie la duplique.
2. **Rama.** Desde `main` actualizado:
   ```sh
   git switch main && git pull --ff-only
   git switch -c feat/quedadas-recurrentes
   ```
   Prefijos: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`, `test/`.
3. **Commits** en formato [Conventional Commits](https://www.conventionalcommits.org/es/): `feat: quedadas que se repiten cada semana`. Código en inglés, textos de la app en español de España.
4. **Pruebas.** `npm run test:all` antes de subir.
5. **Memoria.** Añade tu nota `memoria/sesiones/AAAA-MM-DD-tema.md` en la misma rama (ver `memoria/Cómo trabajamos.md`).
6. **PR.** `git push -u origin HEAD` y abre la PR hacia `main` (o `gh pr create --fill`). Rellena la plantilla. El título de la PR será el commit final, así que también va en Conventional Commits.
7. **CI.** El check **Tests** (`npm run test:all`) tiene que pasar.
8. **Fusionar.** Con la CI en verde, fusiona tú mismo con **Squash and merge**. La rama se borra sola.
9. **Build.** Cada merge en `main` que toque la app genera una build en TestFlight automáticamente.

Pedir revisión a un compañero es opcional pero recomendable en cambios grandes o delicados: añádelo como reviewer y comentad en la PR.

## Reglas de `main`

- Nadie hace push directo a `main` (tampoco Diego ni los asistentes): siempre PR.
- Solo **Squash and merge**: un commit por PR, historial limpio.
- Sin force-push ni borrado de `main`.
- Las PR que tocan `.github/`, `scripts/asc/` o `scripts/ios/` necesitan la aprobación de Diego (`.github/CODEOWNERS`): son los workflows y scripts que manejan las claves de Apple.

## Accesos

| Recurso | Quién |
| --- | --- |
| Repositorio (escritura) | Todo el equipo |
| TestFlight | Todo el equipo, grupo interno «Road to Ironman» |
| App Store Connect, Supabase, Cloudflare, secretos de GitHub | Diego |

Las migraciones de Supabase (`supabase/migrations/`) y las edge functions las despliega Diego después del merge: avísalo en la PR.

## Qué no se sube nunca

Credenciales, `.env`, tokens MCP, códigos de revisión de Apple, datos de salud reales, URLs personales de calendario ni conversaciones privadas.
