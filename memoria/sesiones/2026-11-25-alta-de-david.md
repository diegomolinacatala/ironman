# Alta de David como desarrollador

**Autor:** Claude Code · 25-11-2026 · desde `9329326` (main, con cambios sin commit del rechazo de la build 19).

**Objetivo.** Preparar la entrada de David como segundo desarrollador y comprobar sus accesos.

**Observado.**
- GitHub: David ya es colaborador del repositorio con permiso `write`. El repositorio es público.
- Secretos de Actions (`ASC_*`) solo viven en GitHub; en local no hay credenciales de App Store Connect. Por eso el acceso a TestFlight se comprueba en la web de App Store Connect (TestFlight › Probadores), no desde el repo.

**Propuesta de trabajo a dos.** Cada uno en su rama y PR hacia main. Cada push a main dispara `ios.yml` y sube una build a TestFlight. Al cerrar cada tarea, una nota en `sesiones/` (ver [[Cómo trabajamos]]). Sin `.env`, la app arranca con el repositorio demo, así que David puede empezar sin acceso a Supabase.

**Pendiente.** (1) El dueño comprueba en App Store Connect si David está como probador. (2) Commit de los cambios pendientes de la build 19 para que David parta del estado actual. (3) Decidir si David necesita acceso a Supabase y Cloudflare.
