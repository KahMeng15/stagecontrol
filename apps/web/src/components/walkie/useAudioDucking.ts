'use client';

import { useEffect, useRef } from 'react';

interface UseAudioDuckingOptions {
  isSpeaker: boolean;    // True when current user is pressing PTT / transmitting
  isListener: boolean;   // True when another crew member is broadcasting incoming audio
  isPlayingCall?: boolean; // True when user is listening to a recorded call playback
}

interface StoredMediaState {
  volume: number;
  muted: boolean;
}

export function useAudioDucking({ isSpeaker, isListener, isPlayingCall = false }: UseAudioDuckingOptions) {
  const originalStatesRef = useRef<Map<HTMLMediaElement, StoredMediaState>>(new Map());

  const shouldDuck = isListener || isPlayingCall;

  useEffect(() => {
    // 1. Gather all HTML5 <video> and <audio> elements in the main DOM
    const mediaList: HTMLMediaElement[] = Array.from(
      document.querySelectorAll<HTMLMediaElement>('video, audio')
    );

    // 2. Also look inside any accessible iframes (such as same-origin or proxied live stream players)
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
    for (const ifr of iframes) {
      try {
        if (ifr.contentDocument) {
          const iframeMedia = Array.from(
            ifr.contentDocument.querySelectorAll<HTMLMediaElement>('video, audio')
          );
          mediaList.push(...iframeMedia);
        }
      } catch {
        // Cross-origin iframe, ignore
      }
    }

    // 3. Exclude any audio element that belongs to the Walkie-Talkie system itself
    const eligibleMedia = mediaList.filter((el) => {
      if (
        el.dataset.walkie === 'true' ||
        el.classList.contains('walkie-audio') ||
        el.id.includes('walkie')
      ) {
        return false;
      }
      return true;
    });

    const origMap = originalStatesRef.current;

    if (isSpeaker) {
      // SPEAKER: Mute all other media so microphone doesn't pick up echo or background audio
      for (const el of eligibleMedia) {
        if (!origMap.has(el)) {
          origMap.set(el, { volume: el.volume, muted: el.muted });
        }
        el.muted = true;
      }
    } else if (shouldDuck) {
      // LISTENER or CALL PLAYBACK: Duck volume down by 50% of its original volume level
      for (const el of eligibleMedia) {
        if (!origMap.has(el)) {
          origMap.set(el, { volume: el.volume, muted: el.muted });
        }
        const state = origMap.get(el)!;
        if (!state.muted) {
          el.muted = false;
          el.volume = Math.max(0, Math.min(1, state.volume * 0.5));
        }
      }
    } else {
      // NORMAL: Restore all media elements to their exact original volume and mute state
      for (const [el, state] of origMap.entries()) {
        try {
          el.muted = state.muted;
          el.volume = state.volume;
        } catch {
          // Element may have unmounted
        }
      }
      origMap.clear();
    }
  }, [isSpeaker, shouldDuck]);

  return {
    duckingState: isSpeaker ? 'speaker_muted' : shouldDuck ? 'listener_ducked' : 'normal',
  };
}
