/**
 * Privacy policy link (EXPO_PUBLIC_PRIVACY_URL) and the in-app summary of
 * docs/PRIVACY.md. Keep both in sync when the policy changes.
 *
 * The Coach IA (Cloudflare Workers AI) is only mentioned while the in-app AI coach is
 * switched on (EXPO_PUBLIC_AI_COACH); the user's own Claude connector always is.
 */
import * as WebBrowser from 'expo-web-browser';

import { isAiCoachEnabled } from '@/features/coach/aiCoachFlag';
import { logger } from '@/lib/logger';
import type { IconName } from '@/ui';

/** Only https links are opened (the value comes from build-time config). */
export function resolvePolicyUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  return /^https:\/\/[^\s]+$/i.test(value) ? value : null;
}

// Expo inlines EXPO_PUBLIC_* at build time: read it with its literal name.
export const PRIVACY_POLICY_URL = resolvePolicyUrl(process.env.EXPO_PUBLIC_PRIVACY_URL);

/** Opens the full policy in the in-app browser; false when there is no URL or it failed. */
export async function openPrivacyPolicy(url: string | null = PRIVACY_POLICY_URL): Promise<boolean> {
  if (!url) return false;
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch (error) {
    logger.warn('privacy policy open failed', error);
    return false;
  }
}

/**
 * Titles stay private: friends see 'ocupado' and the plan (or, with the AI coach on, the
 * Coach IA) only uses start/end times.
 */
export function calendarPrivacyNote(aiEnabled: boolean = isAiCoachEnabled()): string {
  return aiEnabled
    ? 'Los títulos de tus eventos son privados: tus amigos solo ven ‘ocupado’ y el Coach IA solo recibe las horas ocupadas, nunca los títulos. Solo tu propio Claude, si lo conectas, puede leerlos.'
    : 'Los títulos de tus eventos son privados: tus amigos solo ven ‘ocupado’ y tu plan solo usa las horas ocupadas, nunca los títulos. Solo tu propio Claude, si lo conectas, puede leerlos.';
}

export interface PrivacyPoint {
  icon: IconName;
  title: string;
  text: string;
}

export interface PrivacySectionContent {
  title: string;
  points: readonly PrivacyPoint[];
}

const USES: PrivacySectionContent = {
  title: 'Qué usamos y para qué',
  points: [
    { icon: 'profile', title: 'Tu cuenta', text: 'Email y nombre (o tu Apple ID anónimo) para entrar e identificarte ante tus amigos.' },
    {
      icon: 'week',
      title: 'Tu entreno',
      text: 'Perfil deportivo, entrenos, carreras, imprevistos, check-ins y nutrición, para planificar tu semana.',
    },
    {
      icon: 'health',
      title: 'Apple Salud y Garmin',
      text: 'Solo con tu permiso: marcamos entrenos hechos y estimamos tu recuperación. Nunca para publicidad.',
    },
    {
      icon: 'calendarBadge',
      title: 'Tu calendario',
      text: 'Solo las horas ocupadas, para encontrar huecos. Los títulos de tus eventos solo los ves tú.',
    },
    { icon: 'bell', title: 'Avisos', text: 'El token de notificaciones de tu iPhone, para enviarte avisos.' },
  ],
};

const FRIENDS_POINT: PrivacyPoint = {
  icon: 'together',
  title: 'Tus amigos',
  text: 'Solo lo que elijas en Yo › Privacidad. Nunca tus datos de salud, tus lesiones ni los títulos de tu calendario.',
};

const OPERATORS_POINT: PrivacyPoint = {
  icon: 'lock',
  title: 'Quien hace funcionar Road to Ironman',
  text: 'Supabase (base de datos y acceso, en la UE) y Expo (notificaciones). No vendemos datos ni hay publicidad.',
};

/** Only listed when the in-app AI coach is switched on. */
const AI_COACH_POINT: PrivacyPoint = {
  icon: 'sparkles',
  title: 'Cloudflare (Coach IA)',
  text: 'Solo si das tu permiso, que puedes retirar abajo cuando quieras. Workers AI no guarda lo que enviamos ni entrena con ello.',
};

const OWN_CLAUDE_POINT: PrivacyPoint = {
  icon: 'link',
  title: 'Tu propio Claude',
  text: 'Si conectas tu Claude, lo que lea o escriba en Road to Ironman queda también sujeto a tu relación con Anthropic.',
};

const YOUR_CHOICES: PrivacySectionContent = {
  title: 'Tus datos, tus decisiones',
  points: [
    {
      icon: 'trash',
      title: 'Borrar todo',
      text: 'En Yo › Borrar cuenta eliminas tu cuenta y tus datos al momento. Las claves de Garmin se borran al desconectar.',
    },
    {
      icon: 'mail',
      title: 'Tus derechos',
      text: 'Puedes acceder, corregir, exportar u oponerte escribiendo al contacto de la política. También puedes reclamar ante la AEPD.',
    },
  ],
};

/** The three summary sections; "Quién más los ve" names Cloudflare (Coach IA) only with the AI coach on. */
export function privacySummary(aiEnabled: boolean = isAiCoachEnabled()): readonly PrivacySectionContent[] {
  const sharing: PrivacySectionContent = {
    title: 'Quién más los ve',
    points: aiEnabled
      ? [FRIENDS_POINT, OPERATORS_POINT, AI_COACH_POINT, OWN_CLAUDE_POINT]
      : [FRIENDS_POINT, OPERATORS_POINT, OWN_CLAUDE_POINT],
  };
  return [USES, sharing, YOUR_CHOICES];
}
