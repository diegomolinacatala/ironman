# Cómo trabajamos

**Al terminar cualquier tarea, actualizar siempre la bóveda de Obsidian.** Se aplica a todo el equipo y a sus asistentes, Codex y Claude Code, también en análisis, investigación o depuración que terminan sin cambios de código. Un resultado puede ser una decisión, una hipótesis descartada o una reproducción pendiente.

## Equipo

Desde el 25 de noviembre de 2026 somos cuatro personas desarrollando la app. Cada una trabaja con su asistente (Claude Code o Codex) sobre la misma bóveda.

| Persona | Papel | Accesos |
| --- | --- | --- |
| Diego | Dueño del proyecto. Administra GitHub, App Store Connect, Supabase y Cloudflare. | Todos |
| David | Desarrollador. Es el compañero de piso de Diego. | GitHub con permiso de escritura. TestFlight en el grupo interno «Road to Ironman», con rol Developer. Le invitamos el 26-10-2026 y el 25-11-2026 seguía en estado «Invitado», sin aceptar. |
| Nico | Desarrollador, se incorpora el 25-11-2026. Usa COROS. | GitHub (`nicoroig-ai`) con permiso de escritura (aceptada el 26-11-2026). App Store Connect aceptado y app instalada por TestFlight el 26-11-2026. |
| Darius | Desarrollador, se incorpora el 25-11-2026. | GitHub con permiso de escritura, probablemente como `ddorel-rt` (sin confirmar). TestFlight pendiente. |

Para incorporar a alguien:
1. Invitarle como colaborador del repositorio en GitHub.
2. Añadirle a TestFlight, en el grupo interno o con el enlace externo.
3. Darle acceso a Supabase o Cloudflare solo si va a tocar el backend: sin `.env`, la app arranca con el repositorio demo.

## Flujo de trabajo con PR

Desde el 26-11-2026 todo cambio entra en `main` por pull request. El detalle práctico está en `CONTRIBUTING.md`, en la raíz del repositorio.

- **Push directo a `main` bloqueado** para todos, Diego y asistentes incluidos (ruleset «main protegida» en GitHub). Sin force-push ni borrado.
- **Cada autor fusiona su propia PR** cuando pasa el check **Tests** (`.github/workflows/ci.yml`, ejecuta `npm run test:all`). No hace falta aprobación: Diego no quiere revisar cada cambio, solo tener un historial profesional.
- **Excepción:** las PR que tocan `.github/`, `scripts/asc/` o `scripts/ios/` necesitan la aprobación de Diego (`.github/CODEOWNERS`). Ahí están los workflows y scripts que usan las claves de Apple.
- **Solo «Squash and merge»**: un commit por PR, con el título de la PR en Conventional Commits (`feat:`, `fix:`…). La rama se borra al fusionar.
- **Claves de Apple en environments**: `production` (solo `main`, lo usa `ios.yml`) y `app-store` (solo `main` y con aprobación de Diego, lo usa `app-store.yml`). Una rama no puede leerlas ni enviar la app a revisión.
- Cada merge en `main` que toque la app genera una build en TestFlight.
- Tareas en GitHub Issues (plantillas de error e idea). Cada uno se asigna la suya antes de empezar.

## Abrir la misma memoria en varios ordenadores

1. Cada persona usa su copia del mismo repositorio. Cuando la rama con la memoria esté compartida, traerla con Git. En una rama limpia con seguimiento, `git pull --ff-only` trae los cambios. Si hay trabajo en curso o las ramas han divergido, revisar antes de integrar.
2. En Obsidian, elegir **Abrir carpeta como bóveda**, seleccionar la carpeta **memoria** dentro de esa copia y abrir **Inicio**. Cada equipo conserva su propia disposición de ventanas. Basta un editor Markdown para trabajar sin Obsidian.
3. Abrir el proyecto por la raíz en Codex o Claude Code. Las instrucciones de entrada de ambos llevan al mismo índice. En un chat sin acceso al repositorio, adjuntar las notas pertinentes y devolver las conclusiones a la bóveda.
4. Para pasar el trabajo a otro ordenador o a otra persona, incluir las notas con los cambios de la tarea en la misma rama y PR. Cuando la PR se fusiona, el resto lo trae con `git pull --ff-only` en `main`. Una conversación privada o un cambio local pendiente de subir solo se conoce allí donde se produjo.

## Inicio y cierre de sesión

- **Inicio.** Leer [[Estado y relevo]] y el último registro pertinente. Revisar `git status --short --branch` y el historial reciente. Si alguien está tocando el mismo recorrido, identificar los archivos concretos antes de editar.
- **Durante.** Anotar las decisiones que costaría reconstruir. Distinguir comportamiento observado, hipótesis de producto y confirmación en un entorno externo. Documentar contratos duraderos en su nota temática.
- **Cierre obligatorio.** Crear una nota en `sesiones/AAAA-MM-DD-tema.md` con autor, objetivo, rama o revisión de partida, cambios, motivo, comprobaciones y pendiente con siguiente paso, y subirla en la misma PR que el código. No se añade a una lista central: la carpeta `sesiones/`, ordenada por fecha, es el registro, y así varias PR en paralelo no chocan. [[Estado y relevo]] solo se toca cuando cambia el estado general del proyecto. Actualizar también el área o decisión afectada. Para una tarea pequeña bastan unas líneas.
- **Si trabajamos a la vez.** Cada tarea tiene su propia nota. Al integrar, conservar ambas entradas y resolver discrepancias consultando el código y sus pruebas. Los pendientes pueden llevar responsable cuando alguien los asuma.
- **Qué compartir.** Guardar conclusiones técnicas, decisiones y ejemplos ficticios. Mantener fuera conversaciones privadas, datos de salud identificables, credenciales, códigos de revisión, URLs personales de calendario y tokens MCP.
