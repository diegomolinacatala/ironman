/**
 * Pure choice of the text-to-speech voice (expo-speech `Voice`), unit-tested.
 *
 * expo-speech 58 reports `quality` as "Enhanced" or "Default" only: iOS Premium voices come
 * back as "Default", so the tier is read from the identifier too
 * ("com.apple.voice.premium.es-ES.Monica", "….enhanced.…", "….compact.…").
 * Eloquence / novelty voices (Eddy, Grandma, Bahh…) sound robotic: last resort only.
 */

export interface VoiceLike {
  identifier: string;
  name: string;
  quality: string;
  language: string;
}

export type VoiceTier = 0 | 1 | 2 | 3;

/** Natural Spanish (Spain) voices, preferred in this order at equal quality. */
const PREFERRED_NAMES = ['mónica', 'monica', 'marisol', 'jorge', 'paulina'];

function normaliseLanguage(language: string): string {
  return language.replace('_', '-').toLowerCase();
}

/** 3 = premium, 2 = enhanced, 1 = default/compact, 0 = robotic (eloquence / novelty). */
export function voiceTier(voice: VoiceLike): VoiceTier {
  const id = voice.identifier.toLowerCase();
  if (id.includes('eloquence') || id.includes('speech.synthesis.voice')) return 0;
  if (id.includes('.premium.')) return 3;
  if (voice.quality === 'Enhanced' || id.includes('.enhanced.')) return 2;
  return 1;
}

/** 2 = es-ES, 1 = another Spanish, 0 = not Spanish. */
function languageScore(voice: VoiceLike): number {
  const language = normaliseLanguage(voice.language);
  if (language === 'es-es') return 2;
  return language === 'es' || language.startsWith('es-') ? 1 : 0;
}

function nameScore(voice: VoiceLike): number {
  const name = voice.name.toLowerCase();
  const index = PREFERRED_NAMES.findIndex((preferred) => name.startsWith(preferred));
  return index === -1 ? 0 : PREFERRED_NAMES.length - index;
}

function score(voice: VoiceLike): number {
  const tier = voiceTier(voice);
  // A natural voice from another Spanish locale sounds better than a robotic es-ES one.
  if (tier === 0) return languageScore(voice);
  return languageScore(voice) * 1000 + tier * 100 + nameScore(voice);
}

/** Spanish voices, best first (es-ES before other Spanish; premium > enhanced > default; robotic last). */
export function rankSpanishVoices<T extends VoiceLike>(voices: readonly T[]): T[] {
  return voices
    .filter((voice) => languageScore(voice) > 0)
    .map((voice) => ({ voice, score: score(voice) }))
    .sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name, 'es'))
    .map(({ voice }) => voice);
}

export function pickSpanishVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  return rankSpanishVoices(voices)[0] ?? null;
}

/** "Mónica (mejorada)", "Marisol (prémium)", "Jorge". */
export function voiceDisplayName(voice: VoiceLike): string {
  const tier = voiceTier(voice);
  if (tier === 3) return `${voice.name} (prémium)`;
  if (tier === 2) return `${voice.name} (mejorada)`;
  return voice.name;
}

/** Approximate progress 0..1 from a word-boundary event. */
export function speechProgress(charIndex: number, charLength: number, textLength: number): number {
  if (!Number.isFinite(charIndex) || textLength <= 0) return 0;
  const spoken = charIndex + (Number.isFinite(charLength) ? Math.max(0, charLength) : 0);
  return Math.max(0, Math.min(1, spoken / textLength));
}
