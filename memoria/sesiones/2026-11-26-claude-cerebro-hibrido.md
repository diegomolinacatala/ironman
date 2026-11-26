# Claude como cerebro (modelo híbrido), IA arreglada y dictado con jerga

**Autor:** Claude Code · 26-11-2026 · desde `9b9429d` (main, con cambios sin commit de otra tarea en Hoy, onboarding y cuenta).

**Objetivo.** Diego quería que su Claude fuera el cerebro de la app usando los planes Pro de los cuatro, que el coach dejara de fallar («La IA no está disponible ahora mismo») y que el dictado entendiera mejor la jerga y las cifras.

**Causa del fallo (observada).** Cloudflare retiró `@cf/nvidia/nemotron-3-120b-a12b` el 20-11-2026 (error 5028). Era el modelo por defecto del coach y del briefing, así que desde ese día todas las llamadas iban al motor de reglas.

**Decisiones.**
- Una suscripción de Claude no puede ser el motor dentro de la app: solo vale en los productos de Anthropic. Usar el token de Claude Code desde un servidor va contra sus condiciones. Decidimos un **modelo híbrido a coste cero**: chat rápido en la app con Cloudflare (gratis); informe diario y planificación larga con el Claude de cada uno vía MCP (plan Pro). Detalle en `docs/CLAUDE_COACH.md`.
- La app es para los cuatro de momento. Si algún día se abre a desconocidos, cada uno necesitaría su Claude con el conector.
- Tono del coach: cercano y humano pero técnico, con el porqué de cada decisión.
- Cambios del plan: el coach propone y el atleta acepta, como hasta ahora.

**Cambios.**
- Worker `cloudflare/ai`:
  - El modelo por defecto pasa a ser Qwen 3.8 27B, con el razonamiento siempre apagado: con razonamiento tardaba 95-120 s y sin él ~7 s, con la respuesta correcta.
  - gpt-oss-120b (reasoning `low`, ~10 s) entra en la lista permitida y hace de reserva para texto; Llama 4 Scout es la reserva para fotos. El worker la usa automáticamente cuando el modelo pedido está retirado o no está en el plan gratuito.
  - `RETIRED_MODELS` sirve a quien pida Nemotron con Qwen. **Desplegado** (última versión desplegada el 26-11).
- Supabase:
  - `DEFAULT_WORKERS_MODEL` pasa a Qwen.
  - Tono nuevo en los prompts del coach y del briefing, y en las instrucciones MCP, que además describen la rutina diaria.
  - Nueva herramienta MCP `save_briefing`: el Claude del atleta escribe el informe de la mañana en `briefings` con `model 'claude'`, solo para ayer, hoy o mañana.
- App:
  - `src/integrations/speech/dictation.ts` normaliza el dictado antes de enviarlo al coach. Por ejemplo, «dos por cuatro kilómetros a cuatro veinticinco el kilómetro» pasa a «2×4 km a 4:25 /km». También corrige zonas, RPE, vatios, ppm y la jerga.
  - El vocabulario del reconocedor pasa a 85 términos, más los nombres de los amigos.
  - Botón «Abrir en Claude» en el saludo del chat del coach (`claude.ai/new?q=…`).

**Revisión.** Un agente revisor no encontró nada crítico ni alto. Se corrigieron sus tres puntos medios: «uno por uno» ya no se convierte en serie, `save_briefing` conserva el sueño que ya hubiera guardado y la detección de modelo retirado es estricta. Además había un carácter de control en esa expresión regular.

**Comprobaciones.**
- Tests: worker 36/36, Edge Functions 264/264, base de datos 164/164, y en Jest las suites de habla y coach por voz (359).
- Prueba real con `wrangler dev --remote`: se pidió Nemotron con el prompt real del coach, respondió Qwen en 18 s con un JSON válido y un `move` correcto.
- Jest completo: fallan 23 tests en 8 suites de Hoy, onboarding y cuenta. Son de los cambios sin commit de otra tarea (textos y botones nuevos), no de esta.

**Pendiente.**
1. ~~Desplegar las funciones de Supabase~~ **Hecho el 26-11** con el OK de Diego: `coach`, `briefing`, `meal` y `mcp` están en producción y responden 401 sin sesión. `save_briefing` aparece en Claude al abrir un chat nuevo con el conector.
2. Probar en el iPhone que el enlace `claude.ai/new?q=` abre la app de Claude con el texto ya escrito.
3. Que cada uno configure su rutina diaria (texto en `docs/CLAUDE_COACH.md`).
4. Actualizar los tests de Hoy, onboarding y cuenta en la tarea que los cambió.
