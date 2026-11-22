/**
 * Keyword intents of the athlete's chat message (Spanish of Spain, accents
 * optional), read on the server so the coach knows when it MUST answer with
 * concrete plan changes ("mueve las series al jueves", "hoy no puedo",
 * "tengo pádel el jueves", "quita el rodaje de mañana") and when the athlete
 * talks about next week. A false positive only asks the model to propose
 * changes "if that is what the athlete wants". Pure.
 */

/** Verbs and phrases that ask to change the plan. */
const CHANGE_RE = new RegExp(
  [
    String.raw`\b(?:mu[eé]v|mover|muevo)\w*`,
    String.raw`\bp[aá]s(?:a|ame|amela|amelo|alo|ala|ar)\s+(?:el|la|los|las|mi|mis|lo|la)\b`,
    String.raw`\bc[aá]mbi(?:a|ame|amelo|amela|alo|ala|ar|arme|amos)\b`,
    String.raw`\bqu[ií]t(?:a|ame|amelo|amela|alo|ala|ar|arme)\b`,
    String.raw`\bb[oó]rr(?:a|ame|alo|ala|ar)\b`,
    String.raw`\belim[ií]n(?:a|ame|alo|ala|ar)\b`,
    String.raw`\bcancel(?:a|ame|alo|ala|ar)\b`,
    String.raw`\b(?:a[nñ]ad|agreg|met)(?:e|eme|ir|er|a|ame)\b`,
    String.raw`\bpon(?:me|lo|la)?\s+(?:un|una|otro|otra|el|la|los|las)\b`,
    String.raw`\b(?:sustitu|reemplaz|intercambi)\w*`,
    String.raw`\b(?:adelant|retras|atras|aplaz|recoloc|reorgan|replanif|reprogr|reaj|aj[uú]st|acort|alarg|reduc|rebaj)\w*`,
    String.raw`\bm[aá]s\s+(?:suave|corto|corta|largo|larga|f[aá]cil|ligero|ligera|tranquilo|tranquila)\b`,
    String.raw`\bno\s+(?:puedo|podr[eé]|voy\s+a\s+poder|me\s+da\s+tiempo|llego)\b`,
    String.raw`\btengo\s+(?:un\s+|una\s+)?(?:partido|p[aá]del|f[uú]tbol|tenis|cena|boda|viaje|comida|evento|reuni[oó]n|examen|ex[aá]menes)\b`,
    String.raw`\b(?:planif[ií]c|prep[aá]r|organ[ií]z|gener)\w*\s+(?:\w+\s+){0,3}semana\b`,
    String.raw`\b(?:hazlo|c[aá]mbialo|mu[eé]velo|qu[ií]talo|b[oó]rralo|prop[oó]n(?:me)?(?:lo)?|dale|ap[aá]ntalo)\b`,
  ].join('|'),
  'i',
);

const NEXT_WEEK_RE = /semana que viene|pr[oó]xima semana|semana siguiente|siguiente semana/i;

/** True when the message (or its follow-up) asks to change the plan. */
export function wantsPlanChange(message: string | undefined): boolean {
  return Boolean(message && CHANGE_RE.test(message));
}

/** True when the message talks about next week. */
export function mentionsNextWeek(message: string | undefined): boolean {
  return Boolean(message && NEXT_WEEK_RE.test(message));
}

/** Replies that claim a change was made ("te he movido…", "he quitado…"). */
const CLAIM_RE =
  /\b(?:te\s+)?(?:lo\s+|la\s+|los\s+|las\s+)?he\s+(?:movido|cambiado|quitado|borrado|eliminado|a[nñ]adido|pasado|puesto|preparado|recolocado|ajustado|acortado|cancelado|sustituido)\b/i;

export function claimsChanges(reply: string): boolean {
  return CLAIM_RE.test(reply);
}
