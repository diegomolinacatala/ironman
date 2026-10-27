import { useEffect, useRef } from 'react';

import { useSpeaker, type Speaker } from '@/integrations/speech/useSpeaker';
import { haptics } from '@/ui';

import { playerMode, type PlayerMode } from './briefingModel';

export interface BriefingPlayer {
  mode: PlayerMode;
  /** 0..1 */
  progress: number;
  hasEnhancedVoice: boolean;
  voiceName: string | null;
  /** Play → pause → resume. */
  toggle: (script: string) => void;
  /** Reads the script again from the start. */
  restart: (script: string) => void;
  play: (script: string) => void;
  stop: () => void;
}

/** Text-to-speech controls for the briefing script. Stops reading when the owner unmounts. */
export function useBriefingPlayer(): BriefingPlayer {
  const speaker: Speaker = useSpeaker();
  const mode = playerMode(speaker);
  const stopRef = useRef(speaker.stop);

  useEffect(() => {
    stopRef.current = speaker.stop;
  });
  useEffect(() => () => stopRef.current(), []);

  const play = (script: string) => {
    if (script.trim()) speaker.speak(script);
  };

  return {
    mode,
    progress: Math.max(0, Math.min(1, speaker.progress)),
    hasEnhancedVoice: speaker.hasEnhancedVoice,
    voiceName: speaker.voiceName,
    play,
    toggle: (script) => {
      haptics.tap();
      if (mode === 'playing') speaker.pause();
      else if (mode === 'paused') speaker.resume();
      else play(script);
    },
    restart: (script) => {
      haptics.tap();
      play(script);
    },
    stop: () => speaker.stop(),
  };
}
