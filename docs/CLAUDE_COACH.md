# Claude como cerebro del coach (modelo híbrido)

Decidido el 26 de noviembre de 2026 para los cuatro usuarios actuales (Diego, David, Nico y Darius). Coste cero: nada de API de pago.

## Por qué es híbrido

Una suscripción de Claude (Pro o Max) no se puede usar como motor dentro de la app: Anthropic solo la permite en sus propios productos (la app de Claude, Claude Code y sus tareas programadas). Sacar el token de Claude Code para usarlo desde un servidor va contra sus condiciones y pone la cuenta en riesgo, así que no se hace. Por eso el trabajo se reparte así:

| Qué | Quién lo hace | Coste |
| --- | --- | --- |
| Chat rápido dentro de la app, por voz o texto | Cloudflare Workers AI: Qwen 3.8 27B, ~7 s; si Cloudflare retira el modelo, pasa a gpt-oss-120b | Gratis (10.000 neuronas/día) |
| Informe de la mañana | Tu Claude, con la herramienta `save_briefing` del conector. Si no lo ha escrito, lo genera la IA gratuita al abrir Hoy | Tu plan Pro |
| Revisar la semana, replanificar o planificar un bloque | Tu Claude, con `get_planning_context` y después `propose_plan_changes` o `set_week_plans`. Tú aceptas en la app | Tu plan Pro |
| Si no hay IA disponible | Motor de reglas de la app ("Modo sin IA") | Gratis |

Claude nunca cambia el plan sin permiso: propone cambios y tú los aceptas en la app. Solo `set_week_plans` (el plan general por semanas) se aplica directamente, como ya pasaba.

## Configurarlo (cada uno de los cuatro)

1. **Conecta tu Claude**: en la app, Tú › Conexiones › Claude. Pega el enlace personal en claude.ai › Ajustes › Conectores.
2. **Charlas largas**: en el chat del coach, sin conversación abierta, toca «Abrir en Claude». Se abre un chat nuevo con este mensaje ya escrito: «Usa Road to Ironman: revisa cómo voy esta semana…». En la app de Claude también puedes usar el modo voz.
3. **Informe de la mañana con tu Claude**. Elige una de estas opciones:
   - **Tarea programada** en la app de escritorio de Claude (tareas programadas). Ponla cada día a las 7:00 con el texto de abajo. Solo se ejecuta si el ordenador está encendido a esa hora.
   - **A mano**: cada mañana, en la app de Claude del móvil, di «prepárame el informe de hoy».

### Texto de la rutina diaria

```
Usa Road to Ironman. Prepárame el informe de hoy:
1. get_planning_context para ver mi semana, mis zonas y cómo fue ayer (planVsDone).
2. Si tienes el conector de Garmin o COROS, lee mi sueño, VFC y FC en reposo de anoche y la actividad de ayer, y guárdalos con log_daily_metrics y log_completed_activity.
3. Guarda el informe con save_briefing para hoy: cercano pero técnico, con el porqué de la sesión, una cifra que mande y una sensación.
4. Si ves fatiga, un imprevisto o una sesión que salió mal, propón cambios mínimos con propose_plan_changes y explícame por qué. No apliques nada sin preguntarme.
```

## Tono del coach

Los tres coaches (la IA gratuita, el informe y tu Claude por las instrucciones del conector) hablan igual: cercanos y humanos, pero técnicos. Cada decisión lleva su porqué: qué adaptación busca la sesión, por qué ese día y qué notará el cuerpo. Usan las cifras de tus zonas y no dan ánimos vacíos.

## Dictado por voz

- El reconocedor del iPhone recibe unas 85 palabras de triatlón (bloques, ritmo de media, brick, T1, FTP, VO2max, sóleo…) y los nombres de tus amigos.
- Antes de enviar el mensaje al coach, `src/integrations/speech/dictation.ts` corrige la jerga y las cifras. Por ejemplo, «dos por cuatro kilómetros a cuatro veinticinco el kilómetro» se envía como «2×4 km a 4:25 /km». También corrige zonas, RPE, vatios, pulsaciones y ritmos de natación.

## Si un día vuelve a fallar la IA

1. Prueba el modelo directamente:

   ```
   curl -X POST https://api.cloudflare.com/client/v4/accounts/<cuenta>/ai/run/@cf/qwen/qwen3.8-27b
   ```

   Usa el token de wrangler y un mensaje corto. El error 5028 significa que el modelo está retirado; el 4006, que se han gastado las neuronas del día.
2. Lista los modelos gratuitos (`/ai/models/search?task=Text%20Generation`) y prueba candidatos con el prompt real del coach. Cambia `DEFAULT_WORKERS_MODEL` (`supabase/functions/_shared/ai/provider.ts`) y la lista `MODELS` del worker (`cloudflare/ai/src/chat.mts`).
3. Despliega el worker (`cd cloudflare/ai && npx wrangler deploy`) y las funciones `coach`, `briefing`, `meal` y `mcp`.
