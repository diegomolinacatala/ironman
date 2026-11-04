import { DEFAULT_TZ, diffDays, isIsoDate, todayIn } from '../../dates.ts';
import { dateSchema, timeSchema, uuidSchema } from '../../planning/changes.ts';
import { StoreRejectedError } from '../../planning/store.ts';
import type { JointSessionDraft } from '../../planning/store.ts';
import { array, boolean, enumOf, integer, nullable, object, optional, string } from '../../schema.ts';
import { INTENSITIES, SPORTS } from '../../types.ts';
import type { FriendSummary, JointSession, UUID } from '../../types.ts';
import { defineTool, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

/** How far ahead a quedada can be proposed (days from today, Europe/Madrid). */
export const MAX_DAYS_AHEAD = 60;
const MAX_INVITEES = 10;
const JOINT_SPORTS = SPORTS.filter((s): s is JointSessionDraft['sport'] => s !== 'rest');

const input = object({
  friend_ids: optional(
    array(uuidSchema('friendId de get_planning_context.friends o get_friends_availability'), {
      max: MAX_INVITEES,
      description: 'Amigos aceptados a los que se invita (friendId). Al menos uno, salvo que is_open sea true.',
    }),
  ),
  sport: enumOf(JOINT_SPORTS, 'swim, bike, run, brick, strength, mobility u other.'),
  date: dateSchema(`Día de la quedada (YYYY-MM-DD, Europe/Madrid): desde hoy hasta ${MAX_DAYS_AHEAD} días vista.`),
  start_time: optional(nullable(timeSchema('Hora de inicio HH:mm (hora local). Omítela solo si aún no hay hora.'))),
  duration_min: integer({ min: 5, max: 720, description: 'Duración en minutos.' }),
  intensity: enumOf(INTENSITIES, 'recovery=Z1, endurance=Z2, tempo=Z3, threshold=Z4, vo2=Z5, race=ritmo de carrera.'),
  title: string({ min: 1, max: 120, description: 'Título corto en español, p. ej. "Rodaje del sábado".' }),
  location: optional(nullable(string({ max: 200, description: 'Lugar de encuentro, p. ej. "Retiro, puerta de Alcalá".' }))),
  notes: optional(nullable(string({ max: 2000, description: 'Detalles para el amigo: ritmo, ruta, qué llevar…' }))),
  is_open: optional(
    boolean('true: quedada abierta, se avisa a todos los amigos aceptados y cualquiera puede apuntarse (friend_ids puede ir vacío). Por defecto false.'),
  ),
});

const sameTitle = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A non-cancelled quedada of the user (not declined) on the same day, sport and title. */
function findDuplicate(sessions: readonly JointSession[], userId: UUID, draft: JointSessionDraft): JointSession | undefined {
  return sessions.find(
    (s) =>
      s.status !== 'cancelled' &&
      s.date === draft.date &&
      s.sport === draft.sport &&
      sameTitle(s.title, draft.title) &&
      (s.organizerId === userId || s.participants.some((p) => p.userId === userId && p.status !== 'declined')),
  );
}

function sessionView(s: JointSession, userId: UUID): Record<string, unknown> {
  return {
    ...s,
    myWorkoutId: s.participants.find((p) => p.userId === userId)?.workoutId ?? null,
    appLink: `roadtoironman://joint/${s.id}`,
  };
}

function checkDate(date: string, today: string): void {
  if (!isIsoDate(date)) throw new ToolInputError(`date ${date} no es una fecha real.`);
  if (date < today) throw new ToolInputError(`No se puede proponer una quedada en el pasado (hoy es ${today}).`);
  if (diffDays(date, today) > MAX_DAYS_AHEAD) {
    throw new ToolInputError(`La quedada puede ser como mucho a ${MAX_DAYS_AHEAD} días vista (hoy es ${today}).`);
  }
}

function checkInvitees(ids: readonly UUID[], friends: readonly FriendSummary[], isOpen: boolean): FriendSummary[] {
  if (ids.length === 0 && !isOpen) {
    throw new ToolInputError('Indica al menos un amigo en friend_ids (friendId de get_friends_availability) o usa is_open=true para una quedada abierta.');
  }
  const unknown = ids.filter((id) => !friends.some((f) => f.friendId === id));
  if (unknown.length > 0) {
    const available = friends.map((f) => `${f.displayName} (${f.friendId})`).join(', ') || 'ninguno';
    throw new ToolInputError(`Solo puedes invitar a amigos aceptados; no lo son: ${unknown.join(', ')}. Amigos disponibles: ${available}.`);
  }
  return ids.map((id) => friends.find((f) => f.friendId === id) as FriendSummary);
}

function nextHint(invited: readonly FriendSummary[], isOpen: boolean): string {
  const names = invited.map((f) => f.displayName).join(', ');
  const who = [names ? `Invitación enviada a ${names}` : '', isOpen ? 'aviso a todos los amigos (quedada abierta)' : ''].filter(Boolean).join(' y ');
  return `${who}. El entreno ya está en el plan del usuario (myWorkoutId); a cada amigo se le añade al aceptar. Cambios o cancelación, desde la app.`;
}

export const proposeJointSessionTool: RegisteredTool = defineTool({
  name: 'propose_joint_session',
  title: 'Proponer quedada a amigos',
  description: [
    'Crea una quedada (entreno juntos) organizada por el usuario y ENVÍA una invitación real a los amigos indicados: reciben una notificación y un push en la app.',
    'Antes de llamarla confirma con el usuario el día, la hora, el lugar y a quién se invita; no la uses para tantear.',
    'Para elegir el hueco usa antes get_friends_availability (commonSlots = huecos libres comunes, sameSportDays = días con el mismo deporte); los friendId salen de ahí o de get_planning_context.friends.',
    'Solo se puede invitar a amigos aceptados (máximo 10). is_open=true crea una quedada abierta: se avisa a todos los amigos y friend_ids puede ir vacío.',
    `La fecha va de hoy a ${MAX_DAYS_AHEAD} días vista; horas HH:mm en Europe/Madrid. Se añade el entreno al plan del usuario y, a cada amigo, cuando acepta.`,
    'Si ya existe una quedada igual (mismo día, deporte y título) devuelve la existente con created=false y no envía otra invitación.',
  ].join(' '),
  input,
  annotations: { title: 'Proponer quedada a amigos', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const profile = await ctx.store.getProfile(ctx.userId);
    const today = todayIn(profile?.timezone ?? DEFAULT_TZ, ctx.now());
    checkDate(args.date, today);
    const isOpen = args.is_open ?? false;
    const ids = [...new Set(args.friend_ids ?? [])];
    const invited = checkInvitees(ids, await ctx.store.listFriends(ctx.userId), isOpen);
    const draft: JointSessionDraft = {
      sport: args.sport,
      date: args.date,
      startTime: args.start_time ?? null,
      durationMin: args.duration_min,
      intensity: args.intensity,
      title: args.title.trim(),
      location: args.location?.trim() || null,
      notes: args.notes?.trim() || null,
      isOpen,
    };
    const existing = findDuplicate(await ctx.store.listJointSessions(ctx.userId, args.date, args.date), ctx.userId, draft);
    if (existing) {
      return toolOk({
        created: false,
        jointSession: sessionView(existing, ctx.userId),
        next: 'Ya existía esta quedada: no se ha creado otra ni se ha vuelto a invitar. Para cambiarla o cancelarla, desde la app.',
      });
    }
    try {
      const created = await ctx.store.proposeJointSession(ctx.userId, draft, ids);
      return toolOk({ created: true, jointSession: sessionView(created, ctx.userId), next: nextHint(invited, isOpen) });
    } catch (error) {
      if (error instanceof StoreRejectedError) throw new ToolInputError(`No se ha creado la quedada: ${error.message}.`);
      throw error;
    }
  },
});
