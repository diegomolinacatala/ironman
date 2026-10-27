/**
 * Demo stand-ins for the AI edge functions: the morning briefing (local
 * template, stored per day like the `briefings` table) and meal analysis
 * (local estimate; photos get a plausible canned dish). Both "think" for
 * `delays.aiMs` so loading states can be seen in the demo.
 */
import { composeBriefing } from '@/domain/briefing';
import { addDays, isISODate } from '@/domain/dates';
import { estimateMealLocally } from '@/domain/mealEstimate';
import { nextRace } from '@/domain/periodization';
import type { Briefing, ISODate, MealAnalysis, MealAnalysisInput, MealSlot, UUID } from '@/domain/types';

import { RepositoryError, type Repository } from '../../repository';
import { cleanMealInput } from '../../supabase/mealApi';
import type { DemoBriefing, DemoDb } from '../db';
import { pause, requireMe, type DemoDeps } from './common';
import { withSync } from './integrationsDemo';

type AiMethods = Pick<Repository, 'getBriefing' | 'generateBriefing' | 'analyzeMeal'>;

/** Like the server: Garmin is re-synced before a briefing when the last sync is older than this. */
const GARMIN_STALE_MS = 30 * 60_000;

function stripBriefing({ userId: _userId, ...briefing }: DemoBriefing): Briefing {
  return briefing;
}

function assertDate(date: ISODate): void {
  if (!isISODate(date)) throw new RepositoryError('validation', 'La fecha del informe no es válida.');
}

function syncIfStale(db: DemoDb, me: UUID, now: string, today: string): DemoDb {
  const garmin = db.integrations.find((i) => i.userId === me && i.state === 'connected');
  if (!garmin) return db;
  const stale = garmin.lastSyncAt === null || Date.parse(now) - Date.parse(garmin.lastSyncAt) > GARMIN_STALE_MS;
  return stale ? withSync(db, me, now, today) : db;
}

function briefingFrom(db: DemoDb, me: UUID, date: ISODate, now: Date): Briefing {
  const tomorrow = addDays(date, 1);
  const mine = db.workouts.filter((w) => w.userId === me);
  return composeBriefing({
    date,
    name: db.profiles.find((p) => p.id === me)?.displayName ?? '',
    metrics: db.metrics.filter((m) => m.userId === me && m.date >= addDays(date, -7) && m.date <= date),
    todayWorkouts: mine.filter((w) => w.date === date),
    tomorrowWorkouts: mine.filter((w) => w.date === tomorrow),
    race: nextRace(
      db.races.filter((r) => r.userId === me),
      date,
    ),
    now,
  });
}

type CannedDish = Omit<MealAnalysis, 'meal' | 'confidence' | 'engine'>;

/** What the demo "sees" in a photo, by meal slot. */
const CANNED_DISHES: Record<MealSlot, CannedDish> = {
  breakfast: {
    description: 'Tostadas con tomate y aceite, café con leche',
    items: ['Pan tostado · 80 g', 'Tomate rallado · 60 g', 'Aceite de oliva · 10 ml', 'Café con leche · 200 ml'],
    kcal: 420, carbsG: 55, proteinG: 14, fatG: 15,
    tip: 'Buen desayuno: si entrenas por la mañana, añade un plátano para llegar con más energía.',
  },
  lunch: {
    description: 'Arroz con pollo y verduras',
    items: ['Arroz cocido · 200 g', 'Pechuga de pollo · 150 g', 'Verduras salteadas · 150 g'],
    kcal: 640, carbsG: 70, proteinG: 48, fatG: 14,
    tip: 'Plato muy completo: hidratos para entrenar y proteína para recuperar.',
  },
  dinner: {
    description: 'Salmón a la plancha con patata asada y ensalada',
    items: ['Salmón · 150 g', 'Patata asada · 200 g', 'Ensalada verde · 100 g'],
    kcal: 610, carbsG: 45, proteinG: 34, fatG: 30,
    tip: 'Buena cena de recuperación: el salmón aporta proteína y grasas saludables.',
  },
  snack: {
    description: 'Yogur griego con plátano y nueces',
    items: ['Yogur griego · 125 g', 'Plátano · 1 ud', 'Nueces · 20 g'],
    kcal: 330, carbsG: 35, proteinG: 12, fatG: 16,
    tip: 'Buen tentempié: hidratos y algo de proteína entre comidas.',
  },
  pre: {
    description: 'Tostada con miel y plátano',
    items: ['Pan · 60 g', 'Miel · 15 g', 'Plátano · 1 ud'],
    kcal: 320, carbsG: 70, proteinG: 7, fatG: 2,
    tip: 'Perfecto antes de entrenar: hidratos de digestión fácil.',
  },
  during: {
    description: 'Gel energético y bebida isotónica',
    items: ['Gel · 1 ud', 'Bebida isotónica · 500 ml'],
    kcal: 210, carbsG: 52, proteinG: 0, fatG: 0,
    tip: 'Apunta cuántos hidratos tomas por hora para afinar tu plan de carrera.',
  },
  post: {
    description: 'Batido de proteína con leche y plátano',
    items: ['Batido de proteína · 1 ud', 'Leche · 250 ml', 'Plátano · 1 ud'],
    kcal: 380, carbsG: 45, proteinG: 33, fatG: 7,
    tip: 'Buena recuperación: proteína e hidratos en la primera hora después de entrenar.',
  },
};

/** Text first (local estimate); a photo the estimate cannot read becomes a canned dish of the slot. */
export function demoMealAnalysis(input: MealAnalysisInput): MealAnalysis {
  const local = estimateMealLocally(input);
  if (local.items.length > 0 || !input.imageBase64) return local;
  return { ...CANNED_DISHES[local.meal], meal: local.meal, confidence: 'medium', engine: 'rules' };
}

export function aiDemo({ store, delays }: DemoDeps): AiMethods {
  return {
    async getBriefing(date: ISODate): Promise<Briefing | null> {
      assertDate(date);
      const me = await requireMe(store);
      const found = (await store.read()).briefings.find((b) => b.userId === me && b.date === date);
      return found ? stripBriefing(found) : null;
    },

    async generateBriefing(date: ISODate, opts: { refresh?: boolean } = {}): Promise<Briefing> {
      assertDate(date);
      const me = await requireMe(store);
      const existing = (await store.read()).briefings.find((b) => b.userId === me && b.date === date);
      if (existing && opts.refresh !== true) return stripBriefing(existing);
      await pause(delays.aiMs);
      return store.update((db, clock) => {
        const synced = date === clock.today ? syncIfStale(db, me, clock.now, clock.today) : db;
        const briefing = briefingFrom(synced, me, date, new Date(clock.now));
        const others = synced.briefings.filter((b) => !(b.userId === me && b.date === date));
        return { db: { ...synced, briefings: [...others, { ...briefing, userId: me }] }, result: briefing };
      });
    },

    async analyzeMeal(raw: MealAnalysisInput): Promise<MealAnalysis> {
      const input = cleanMealInput(raw);
      await requireMe(store);
      await pause(delays.aiMs);
      return demoMealAnalysis(input);
    },
  };
}
