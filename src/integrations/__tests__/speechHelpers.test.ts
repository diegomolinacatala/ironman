import { describe, expect, test } from '@jest/globals';

import {
  applyRecognitionResult,
  EMPTY_TRANSCRIPT,
  normaliseVolume,
  transcriptText,
  VOICE_CONTEXTUAL_STRINGS,
  voiceErrorMessage,
  type TranscriptState,
} from '../speech/transcript';
import { pickSpanishVoice, rankSpanishVoices, speechProgress, voiceDisplayName, voiceTier, type VoiceLike } from '../speech/voices';

function feed(events: [boolean, string][]): TranscriptState {
  return events.reduce((state, [isFinal, text]) => applyRecognitionResult(state, isFinal, text), EMPTY_TRANSCRIPT);
}

describe('dictation transcript', () => {
  test('interim results replace each other and follow the finals', () => {
    const state = feed([
      [false, 'hoy'],
      [false, 'hoy me duele'],
      [true, 'Hoy me duele el gemelo.'],
      [false, ' mañana'],
    ]);
    expect(transcriptText(state)).toBe('Hoy me duele el gemelo. mañana');
  });

  test('iOS 18 segments (leading space) are appended, not replaced', () => {
    const state = feed([
      [false, 'Ayer'],
      [true, 'Ayer dormí mal.'],
      [false, ' Hoy'],
      [true, ' Hoy prefiero rodaje suave.'],
    ]);
    expect(transcriptText(state)).toBe('Ayer dormí mal. Hoy prefiero rodaje suave.');
    expect(state.interim).toBe('');
  });

  test('a repeated final with no speech in between is dropped', () => {
    const state = feed([
      [false, 'Series'],
      [true, 'Series de umbral.'],
      [true, 'Series de umbral.'],
    ]);
    expect(transcriptText(state)).toBe('Series de umbral.');
  });

  test('the same words said twice are kept', () => {
    const state = feed([
      [false, 'Sí'],
      [true, 'Sí.'],
      [false, 'Sí'],
      [true, 'Sí.'],
    ]);
    expect(transcriptText(state)).toBe('Sí. Sí.');
  });

  test('empty finals clear the interim and add nothing', () => {
    const state = feed([
      [false, 'eh'],
      [true, '   '],
    ]);
    expect(transcriptText(state)).toBe('');
  });

  test('mic level is 0..1 (below 0 is silence)', () => {
    expect(normaliseVolume(-2)).toBe(0);
    expect(normaliseVolume(0)).toBe(0);
    expect(normaliseVolume(5)).toBe(0.5);
    expect(normaliseVolume(14)).toBe(1);
    expect(normaliseVolume(Number.NaN)).toBe(0);
  });

  test('triathlon vocabulary biases recognition', () => {
    expect(VOICE_CONTEXTUAL_STRINGS).toEqual(expect.arrayContaining(['rodaje', 'tirada larga', 'zona dos', 'VFC', 'FTP', 'pádel']));
  });

  test('errors become Spanish messages; aborts and silence after speech stay quiet', () => {
    expect(voiceErrorMessage('aborted', false)).toBeNull();
    expect(voiceErrorMessage('no-speech', true)).toBeNull();
    expect(voiceErrorMessage('no-speech', false)).toMatch(/No te he oído/);
    expect(voiceErrorMessage('not-allowed', false)).toMatch(/Ajustes/);
    expect(voiceErrorMessage('network', false)).toMatch(/conexión/);
    expect(voiceErrorMessage('something-new', false)).toMatch(/No se pudo reconocer/);
  });
});

const voice = (identifier: string, name: string, language: string, quality = 'Default'): VoiceLike => ({
  identifier,
  name,
  language,
  quality,
});

const VOICES: VoiceLike[] = [
  voice('com.apple.voice.compact.en-US.Samantha', 'Samantha', 'en-US'),
  voice('com.apple.eloquence.es-ES.Eddy', 'Eddy', 'es-ES'),
  voice('com.apple.voice.compact.es-MX.Paulina', 'Paulina', 'es-MX'),
  voice('com.apple.voice.compact.es-ES.Monica', 'Mónica', 'es-ES'),
  voice('com.apple.voice.enhanced.es-ES.Jorge', 'Jorge', 'es-ES', 'Enhanced'),
  voice('com.apple.voice.premium.es-ES.Marisol', 'Marisol', 'es-ES'),
];

describe('text-to-speech voice choice', () => {
  test('premium beats enhanced beats compact for es-ES; robotic voices last', () => {
    const ranked = rankSpanishVoices(VOICES).map((v) => v.name);
    expect(ranked).toEqual(['Marisol', 'Jorge', 'Mónica', 'Paulina', 'Eddy']);
  });

  test('es-ES is preferred over other Spanish even at lower quality', () => {
    const chosen = pickSpanishVoice([
      voice('com.apple.voice.enhanced.es-MX.Paulina', 'Paulina', 'es-MX', 'Enhanced'),
      voice('com.apple.voice.compact.es-ES.Monica', 'Mónica', 'es_ES'),
    ]);
    expect(chosen?.name).toBe('Mónica');
  });

  test('falls back to any Spanish voice, or null without one', () => {
    expect(pickSpanishVoice([voice('x.es-AR', 'Diego', 'es-AR')])?.name).toBe('Diego');
    expect(pickSpanishVoice([voice('x.en', 'Samantha', 'en-US')])).toBeNull();
  });

  test('tiers and display names (Premium is reported as "Default" by expo-speech)', () => {
    expect(voiceTier(voice('com.apple.voice.premium.es-ES.Marisol', 'Marisol', 'es-ES'))).toBe(3);
    expect(voiceDisplayName(voice('com.apple.voice.premium.es-ES.Marisol', 'Marisol', 'es-ES'))).toBe('Marisol (prémium)');
    expect(voiceDisplayName(voice('com.apple.voice.enhanced.es-ES.Monica', 'Mónica', 'es-ES', 'Enhanced'))).toBe('Mónica (mejorada)');
    expect(voiceDisplayName(voice('com.apple.voice.compact.es-ES.Monica', 'Mónica', 'es-ES'))).toBe('Mónica');
  });

  test('progress follows word boundaries and stays within 0..1', () => {
    expect(speechProgress(0, 4, 100)).toBe(0.04);
    expect(speechProgress(96, 4, 100)).toBe(1);
    expect(speechProgress(150, 4, 100)).toBe(1);
    expect(speechProgress(10, 4, 0)).toBe(0);
  });
});
