# Conexión directa con COROS (MCP oficial)

**Autor:** Nico con Claude Code · 26-11-2026 · rama `feat/conexion-coros` desde `main` (`532f509`).

**Objetivo.** Que los atletas con COROS reciban sus datos solos, como con Garmin, sin depender de Apple Salud ni de su Claude.

**Problema de partida.** Con COROS, los datos llegaban por Apple Salud o por el Claude del atleta. COROS escribe en Salud el tiempo **total** (con paradas) y sin pulso ni distancia en muchos casos. Cuando Claude registraba las mismas sesiones con el tiempo en movimiento, el importador de Salud no las reconocía (la diferencia superaba la tolerancia) y duplicaba sobre todo natación y bici. En una cuenta real hubo seis duplicados en dos semanas, que inflaban la carga semanal (900 min en lugar de 482).

**Cambios.**
- Función nueva `coros` (`supabase/functions/coros`, código en `_shared/coros/`): OAuth 2.1 + PKCE contra el MCP oficial de COROS con registro dinámico de cliente (no hace falta pedir claves a COROS). Acciones `start`, `sync`, `disconnect`, `sync_all` y `GET /coros/callback`. El verificador PKCE viaja cifrado en `state`, así que no hay tabla de estados. Tokens cifrados en `integration_credentials` (`provider 'coros_mcp'`) con `COROS_TOKEN_SECRET`.
- Cliente MCP mínimo: el servidor de COROS es sin estado y responde JSON normal, así que cada herramienta es un POST `tools/call`.
- Lectores de los informes en prosa de COROS (`parse.ts`), comprobados contra respuestas reales. Las pruebas usan el mismo formato con números inventados.
- Sincronización: actividades → `workouts` (`source 'coros'`, `external_id 'coros:<labelId>'`, la misma clave que `log_completed_activity`, así que lo que ya registró Claude no se duplica). Las copias de Apple Salud se reconocen por día, deporte y hora de inicio (±15 min). Intensidad desde el «Training Focus» de COROS, porque su carga no está en escala TSS: con TSS, los rodajes suaves salían como umbral. Bienestar → `daily_metrics (source 'coros')`.
- Migraciones `20261127000100_coros_mcp.sql` (proveedor y `workouts.source`) y `20261127000900_coros_platform.sql` (cron `rti-coros-sync` a las 05:35 y 08:35 UTC).
- App: tarjeta «COROS · Conexión directa» en Tú › Conexiones (`CorosDirectCard`), métodos `startCorosConnect`, `syncCoros` y `disconnectCoros` en el repositorio y en la demo. Con la conexión directa activa, el importador de Apple Salud ignora los entrenos cuya fuente es COROS.
- Arreglos de paso: `rowToIntegration` devolvía siempre `garmin_personal` (una fila de COROS habría salido como Garmin), y la demo borraba todas las integraciones del usuario al desconectar Garmin.
- Docs: `supabase/functions/README.md`, `docs/SETUP.md` §8b, instrucciones del conector MCP.

**Comprobaciones.** `npm run test:all` en verde, con 17 pruebas nuevas de la función y pruebas de app (modelo de la tarjeta, demo, mapeo de proveedores). Tipos de `_shared/coros` comprobados aparte con `tsc`, porque el typecheck del repo excluye `supabase/`. **No probado contra COROS desde el servidor:** el flujo OAuth y las herramientas sí se verificaron desde un ordenador (cliente local del atleta), pero no desde Supabase.

**Pendiente.**
1. ~~Diego despliega~~ **Hecho el 27-11** (Claude Code, con el OK de Diego): migraciones `20261127000100` y `20261127000900` aplicadas, cron `rti-coros-sync` programado (05:35 y 08:35 UTC), `COROS_TOKEN_SECRET` creado (aleatorio, no está guardado en ningún sitio más: no lo cambies) y función `coros` desplegada. Responde 401 sin sesión y 302 en `/coros/callback`. La build de TestFlight del 27-11 (`bebb233`) ya trae la tarjeta. Falta volver a desplegar `mcp` para que Claude lea las instrucciones nuevas de COROS.
2. **Primera prueba real**: conectar una cuenta COROS desde la app y confirmar que COROS acepta la dirección de vuelta `…/functions/v1/coros/callback` y la región (la entrada `mcp.coros.com` remite a `mcpeu.coros.com`; si la región dependiera de la IP, `COROS_MCP_URL` permite fijarla).
3. Confirmar con COROS que su MCP se puede usar desde un servidor en nombre del atleta (lo verificado es su uso desde clientes como Claude o un script local).
4. Onboarding: añadir la conexión directa al paso «Tu reloj» cuando esté probada.
