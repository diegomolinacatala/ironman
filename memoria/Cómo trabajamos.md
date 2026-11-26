# Cómo trabajamos

**Al terminar cualquier tarea, actualizar siempre la bóveda de Obsidian.** Se aplica a todo el equipo y a sus asistentes, Codex y Claude Code, también en análisis, investigación o depuración que terminan sin cambios de código. Un resultado puede ser una decisión, una hipótesis descartada o una reproducción pendiente.

## Equipo

Desde el 25 de noviembre de 2026 somos cuatro personas desarrollando la app. Cada una trabaja con su asistente (Claude Code o Codex) sobre la misma bóveda.

| Persona | Papel | Accesos |
| --- | --- | --- |
| Diego | Dueño del proyecto. Administra GitHub, App Store Connect, Supabase y Cloudflare. | Todos |
| David | Desarrollador. Es el compañero de piso de Diego. | GitHub con permiso de escritura. TestFlight en el grupo interno «Road to Ironman», con rol Developer. Le invitamos el 26-10-2026 y el 25-11-2026 seguía en estado «Invitado», sin aceptar. |
| Nico | Desarrollador, se incorpora el 25-11-2026. | GitHub. TestFlight pendiente. |
| Darius | Desarrollador, se incorpora el 25-11-2026. | Pendiente |

Para incorporar a alguien:
1. Invitarle como colaborador del repositorio en GitHub.
2. Añadirle a TestFlight, en el grupo interno o con el enlace externo.
3. Darle acceso a Supabase o Cloudflare solo si va a tocar el backend: sin `.env`, la app arranca con el repositorio demo.

Cada persona trabaja en su rama y abre una PR hacia `main`. Cada push a `main` genera una build en TestFlight.

## Abrir la misma memoria en varios ordenadores

1. Cada persona usa su copia del mismo repositorio. Cuando la rama con la memoria esté compartida, traerla con Git. En una rama limpia con seguimiento, `git pull --ff-only` trae los cambios. Si hay trabajo en curso o las ramas han divergido, revisar antes de integrar.
2. En Obsidian, elegir **Abrir carpeta como bóveda**, seleccionar la carpeta **memoria** dentro de esa copia y abrir **Inicio**. Cada equipo conserva su propia disposición de ventanas. Basta un editor Markdown para trabajar sin Obsidian.
3. Abrir el proyecto por la raíz en Codex o Claude Code. Las instrucciones de entrada de ambos llevan al mismo índice. En un chat sin acceso al repositorio, adjuntar las notas pertinentes y devolver las conclusiones a la bóveda.
4. Para pasar el trabajo al otro ordenador, incluir las notas con los cambios de la tarea en la misma rama, hacer commit, compartir por el remoto acordado y traer esa revisión en el segundo ordenador. Una conversación privada o un cambio local pendiente de subir solo se conoce allí donde se produjo.

## Inicio y cierre de sesión

- **Inicio.** Leer [[Estado y relevo]] y el último registro pertinente. Revisar `git status --short --branch` y el historial reciente. Si alguien está tocando el mismo recorrido, identificar los archivos concretos antes de editar.
- **Durante.** Anotar las decisiones que costaría reconstruir. Distinguir comportamiento observado, hipótesis de producto y confirmación en un entorno externo. Documentar contratos duraderos en su nota temática.
- **Cierre obligatorio.** Crear una nota en `sesiones/AAAA-MM-DD-tema.md` con autor, objetivo, rama o revisión de partida, cambios, motivo, comprobaciones y pendiente con siguiente paso. Añadir su enlace a [[Estado y relevo]]. Actualizar también el área o decisión afectada. Para una tarea pequeña bastan unas líneas.
- **Si trabajamos a la vez.** Cada tarea tiene su propia nota. Al integrar, conservar ambas entradas y resolver discrepancias consultando el código y sus pruebas. Los pendientes pueden llevar responsable cuando alguien los asuma.
- **Qué compartir.** Guardar conclusiones técnicas, decisiones y ejemplos ficticios. Mantener fuera conversaciones privadas, datos de salud identificables, credenciales, códigos de revisión, URLs personales de calendario y tokens MCP.
