/**
 * Privacy policy link (EXPO_PUBLIC_PRIVACY_URL) and the in-app summary of
 * docs/PRIVACY.md. Keep both in sync when the policy changes.
 */
import * as WebBrowser from 'expo-web-browser';

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

/** Titles stay private: friends see 'ocupado' and the Coach IA only gets start/end times. */
export const CALENDAR_PRIVACY_NOTE =
  'Los títulos de tus eventos son privados: tus amigos solo ven ‘ocupado’ y el Coach IA solo recibe las horas ocupadas, nunca los títulos. Solo tu propio Claude, si lo conectas, puede leerlos.';

export interface PrivacyPoint {
  icon: IconName;
  title: string;
  text: string;
}

export interface PrivacySectionContent {
  title: string;
  points: readonly PrivacyPoint[];
}

export const PRIVACY_SUMMARY: readonly PrivacySectionContent[] = [
  {
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
  },
  {
    title: 'Quién más los ve',
    points: [
      {
        icon: 'together',
        title: 'Tus amigos',
        text: 'Solo lo que elijas en Yo › Privacidad. Nunca tus datos de salud, tus lesiones ni los títulos de tu calendario.',
      },
      {
        icon: 'lock',
        title: 'Quien hace funcionar Rebufo',
        text: 'Supabase (base de datos y acceso, en la UE) y Expo (notificaciones). No vendemos datos ni hay publicidad.',
      },
      {
        icon: 'sparkles',
        title: 'Anthropic (Coach IA)',
        text: 'Solo si das tu permiso, que puedes retirar abajo cuando quieras.',
      },
      {
        icon: 'link',
        title: 'Tu propio Claude',
        text: 'Si conectas tu Claude, lo que lea o escriba en Rebufo queda también sujeto a tu relación con Anthropic.',
      },
    ],
  },
  {
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
  },
];
