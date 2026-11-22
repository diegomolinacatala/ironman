# Atlas del repositorio

| Directorio o contrato | Qué buscar aquí |
| --- | --- |
| `index.ts`, `src/app/_layout.tsx` | Arranque, proveedores, navegación y efectos globales. Las rutas viven en `src/app`; los layouts de pestañas tienen variante web. |
| `src/features` | `account`, `onboarding`, `settings` para identidad y conexiones. `today`, `briefing`, `checkin`, `meal`, `nutrition` para el día. `races`, `season`, `week`, `events`, `workouts` para planificar. `coach`, `talk`, `accessory` para el entrenador. `social`, `together` y `progress` para amigos y evolución. |
| `src/domain/types.ts`, `validation.ts` | Vocabulario y validación del atleta, plan, sesión y objetos sociales. `planner.ts`, `season.ts`, `replanner.ts`, `prescription.ts`, `together.ts` son entradas a las reglas principales. |
| `src/data` | Contrato del repositorio, hooks de consulta, demo y adaptadores Supabase. Ver también parsers, mappers, semillas y pruebas de paridad. |
| `src/integrations`, `src/lib`, `src/ui` | Adaptación a dispositivo y servicios, configuración y logging, sistema visual y accesibilidad. |
| `supabase/migrations`, `config.toml`, `seed.sql`, `templates` dentro de `supabase` | Historial del esquema y permisos, configuración de plataforma, datos iniciales y plantilla del correo de acceso. |
| `supabase/functions/_shared` | Lógica por servicio. `platform` conecta proveedores y almacenamiento. `planning` prepara vistas y contiene el espejo de dominio. `mcp/tools/index.ts` registra las diez herramientas. |
| `supabase/tests`, pruebas junto a cada módulo | Regresiones de SQL y permisos, funciones y cliente. El harness de PGlite está en `supabase/tests/harness.ts`. |
| `cloudflare/ai` | Worker, configuración Wrangler, contratos de chat/voz y pruebas propias. |
| `assets`, `scripts`, `store`, `site` | Marca/iconos, utilidades de capturas/compilación/ficha, materiales de tienda y páginas de soporte públicas. |
| `.github/workflows`, `.claude`, `.vscode` | Automatización de entrega y publicación, configuración local del asistente y del editor. |

## Biblioteca original

- `docs/PRODUCT.md` e investigación `docs/research/01…05`. Contexto histórico de planificadores, reglas deportivas, SDK iOS, Garmin y Claude/MCP. Revalidar los datos de proveedores al implementar.
- `docs/ARCHITECTURE.md`. Contratos por capa e historial técnico, incluidos incidentes de arranque.
- `docs/V2.md` y `docs/V4.md`. Evolución del coach de bolsillo, briefings, comida, voz, temporadas y soporte COROS. Los repartos de trabajo históricos se refieren a aquellas entregas.
- `docs/DESIGN.md`. Sistema visual, navegación, interacción, contraste y movimiento.
- `docs/SETUP.md` y `supabase/functions/README.md`. Puesta en marcha de servicios y contratos de las funciones.
- `docs/APP_STORE.md`, `docs/PRIVACY.md` y `docs/TERMS.md`. Operación de la tienda y textos públicos. El registro de ajustes de App Review también se puede seguir en Git.

## Búsquedas desde la raíz

`rg --files src/app` enumera las rutas reales. `rg --files src/domain` localiza la regla y sus pruebas. Para seguir una escritura, buscar el nombre del método en `src/data` y después la RPC en `supabase/migrations` y `supabase/tests`. Para saber qué cambió desde una sesión, comparar su revisión con la rama actual y revisar también los archivos sin seguimiento.
