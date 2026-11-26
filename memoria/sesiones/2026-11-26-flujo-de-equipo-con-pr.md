# Flujo de equipo con PR obligatorias

**Autor:** Claude Code · 26-11-2026 · rama `chore/flujo-de-equipo` desde `origin/main` (`9b9429d`).

**Objetivo.** Que el proyecto tenga un historial profesional con cuatro desarrolladores: todo entra por PR, pero cada uno fusiona la suya sin esperar a Diego.

**Decisión de Diego.** PR obligatorias, sin aprobación obligatoria: no quiere revisar cada cambio. Solo las rutas que manejan las claves de Apple exigen su visto bueno.

**Cambios.**
- `.github/workflows/ci.yml`: check **Tests** (`npm run test:all`) en cada PR y en cada push a `main`. Sin filtro de rutas, porque es obligatorio en todas las PR.
- `.github/CODEOWNERS`: Diego es dueño de `.github/`, `scripts/asc/` y `scripts/ios/`.
- Plantilla de PR, plantillas de issue (error, idea) y `CONTRIBUTING.md`.
- `ios.yml` usa el environment `production` solo en `main`; `app-store.yml` usa `app-store` (solo `main` y con la aprobación de Diego).
- GitHub: ruleset «main protegida» (PR obligatoria con 0 aprobaciones, revisión de code owners, check Tests, sin force-push ni borrado; el admin solo puede saltárselo desde una PR), solo squash merge, borrado de ramas al fusionar, etiquetas y environments.
- [[Cómo trabajamos]]: nueva sección «Flujo de trabajo con PR». Las notas de sesión ya no se listan en [[Estado y relevo]], para que las PR en paralelo no choquen.

**Motivo de los environments.** Con permiso de escritura, cualquiera podía subir una rama con un workflow que leyera los secretos `ASC_*` o lanzar `app-store.yml` con «submit». Los secretos de environment solo llegan a los jobs de `main`.

**Pendiente.**
1. Diego mueve los secretos: crearlos en los environments `production` (`ASC_KEY_P8`, `ASC_KEY_ID`, `ASC_ISSUER_ID`) y `app-store` (esos tres más `ASC_REVIEW_CODE` y `ASC_CONTACT_PHONE`), y después borrar los secretos del repositorio. Mientras sigan a nivel de repositorio, una rama aún puede leerlos.
2. Tablero de GitHub Projects: el token de `gh` no tiene el permiso `project`. Se crea desde la web (repositorio › Projects › New project › Board).
3. Confirmar que `ddorel-rt` es Darius. Nico tiene que aceptar la invitación.
4. El trabajo de UI sin commit en la copia de Diego (74 archivos en `src/`) no pasaba `tsc` el 26-11 (`planStep.test.tsx` y `moreSheet.test.ts`): queda fuera de `main` hasta que se termine en su propia PR.
