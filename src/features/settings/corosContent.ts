/**
 * COROS: what we tell a friend (docs/V4.md §6, docs/SETUP.md §8b). Pure content shared
 * by the onboarding ("Tu reloj" and the Claude step), Tú › Conexiones and /settings/coros.
 *
 * COROS has no personal API key: Apple Salud brings workouts, sleep and pulse
 * automatically; the official COROS connector in the athlete's own Claude brings
 * HRV, recovery and load, and puts run/bike workouts on the watch.
 */
import type { GuideItem } from '../onboarding/GuideParts';

/** The guide screen ("Conectar COROS"). */
export const COROS_GUIDE_ROUTE = '/settings/coros';
/** COROS in the App Store: «Abrir» when it is installed. */
export const COROS_APP_URL = 'https://apps.apple.com/app/id1277625343';
/** Official COROS connector, for «Añadir conector personalizado» when it is not listed. */
export const COROS_MCP_URL = 'https://mcp.coros.com/mcp';
/** The same connector on COROS's European servers (if the first one fails). */
export const COROS_MCP_EU_URL = 'https://mcpeu.coros.com/mcp';

/** COROS → Apple Salud → Road to Ironman, as the onboarding and Conexiones guide it. */
export const COROS_HEALTH_STEPS: readonly GuideItem[] = [
  {
    icon: 'settings',
    text: 'En la app COROS: Perfil › Ajustes › Apps de terceros › Sincronización de datos › Apple Health',
    detail: 'Actívalo y, cuando Salud lo pida, pulsa «Activar todo» y «Permitir».',
  },
  {
    icon: 'watch',
    text: 'Sincroniza tu reloj',
    detail: 'Abre COROS con el reloj cerca. Pasan a Salud los entrenos nuevos, no los antiguos.',
  },
  {
    icon: 'health',
    text: 'Vuelve y pulsa «Conectar Apple Salud»',
    detail: 'Leemos tus entrenos, tu sueño, tu pulso en reposo y tus pasos.',
  },
];

/** What COROS does not send to Apple Salud, and who brings it. */
export const COROS_CLAUDE_NOTE = 'La VFC, la recuperación y la carga de COROS llegan a través de tu Claude, en el siguiente paso.';

/** Where to look when nothing from COROS arrives (iOS Salud app). */
export const COROS_PERMISSION_CHECKS: readonly string[] = [
  'Salud › tu foto › Apps › COROS: que pueda escribir entrenos y sueño.',
  'Salud › tu foto › Apps › Road to Ironman: que pueda leerlos.',
];

/** The official COROS connector in claude.ai. */
export const COROS_CLAUDE_STEPS: readonly GuideItem[] = [
  { icon: 'plug', text: 'En Claude: Personalizar › Conectores › Explorar conectores', detail: 'Donde añadiste Road to Ironman.' },
  { icon: 'search', text: 'Busca COROS y pulsa «Conectar»', detail: 'Inicia sesión con tu cuenta COROS.' },
  { icon: 'sparkles', text: 'En un chat, activa COROS y Road to Ironman', detail: 'Pulsa «+» y enciende los dos conectores.' },
];

export interface ConnectorPermission {
  /** What the connector asks to do. */
  label: string;
  /** The option to pick in Claude. */
  value: string;
  why: string;
}

/** How to set the COROS connector's permissions in Claude. */
export const COROS_PERMISSIONS: readonly ConnectorPermission[] = [
  { label: 'Leer tus datos', value: 'Permitir siempre', why: 'Guarda tu sueño, tu VFC y tus entrenos sin preguntarte cada vez.' },
  { label: 'Crear entrenos', value: 'Necesita aprobación', why: 'Tú decides qué pasa a tu reloj.' },
  { label: 'Planes de COROS', value: 'Bloqueado', why: 'El plan manda desde Road to Ironman.' },
];

/** Every morning (30 s). */
export const COROS_DAILY_PROMPT = 'Guarda en Road to Ironman mi sueño, VFC y recuperación de COROS de anoche';
/** COROS sends nothing old to Apple Salud: Claude brings the recent history once. */
export const COROS_HISTORY_PROMPT = 'Registra en Road to Ironman mis entrenos de COROS de las últimas 4 semanas';
/** Run and bike workouts into the COROS calendar (they reach the watch when it syncs). */
export const COROS_CALENDAR_PROMPT =
  'Pasa a mi calendario de COROS los entrenos de carrera y bici de esta semana de Road to Ironman';
/** First time: two weeks of recovery data and workouts. */
export const COROS_BACKFILL_PROMPT =
  'Lee de COROS mi VFC, FC en reposo, sueño y recuperación de los últimos 14 días y guárdalos en Road to Ironman. Después registra mis entrenos de COROS de esas dos semanas';

/** Example prompts once both connectors are on. */
export const COROS_CLAUDE_PROMPTS: readonly string[] = [COROS_DAILY_PROMPT, COROS_HISTORY_PROMPT, COROS_CALENDAR_PROMPT];

/** Thresholds to set the same in Road to Ironman and in COROS. */
export const SHARED_THRESHOLDS: readonly string[] = ['FC máxima', 'FC umbral', 'Ritmo umbral de carrera', 'FTP de bici'];
