/**
 * iOS audio session for text-to-speech.
 *
 * expo-speech uses the app's shared AVAudioSession. Left alone it is either the default
 * `soloAmbient` (silenced by the ring/silent switch) or, right after dictation,
 * expo-speech-recognition's `playAndRecord` + `measurement`. The briefing is something the
 * user explicitly asked to hear, so before speaking we switch to `playback` / `spokenAudio`
 * (plays with the silent switch on, ducks music) and deactivate it afterwards so other
 * audio comes back. expo-speech-recognition sets its own category every time it starts.
 */
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

export function prepareSpeechPlayback(): void {
  if (Platform.OS !== 'ios') return;
  try {
    ExpoSpeechRecognitionModule.setCategoryIOS({
      category: 'playback',
      categoryOptions: ['duckOthers'],
      mode: 'spokenAudio',
    });
  } catch (error) {
    logger.warn('speech: could not set the playback audio session', error);
  }
}

export function releaseSpeechPlayback(): void {
  if (Platform.OS !== 'ios') return;
  try {
    ExpoSpeechRecognitionModule.setAudioSessionActiveIOS(false, { notifyOthersOnDeactivation: true });
  } catch (error) {
    // Throws while other I/O is still running (e.g. dictation started meanwhile): harmless.
    logger.debug('speech: audio session still busy', error);
  }
}
