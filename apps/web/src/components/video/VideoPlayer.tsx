'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

export interface VideoPlayerRef {
  play: () => Promise<void> | void;
  pause: () => void;
  seek: (seconds: number) => void;
  currentTime: () => number;
  duration: () => number;
  isPaused: () => boolean;
}

export interface VideoMarkerItem {
  id: string;
  title: string;
  timestamp_seconds: number;
  color?: string | null;
}

interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  preload?: 'auto' | 'metadata' | 'none';
  fallbackDuration?: number;
  markers?: VideoMarkerItem[];
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (error: unknown) => void;
  onJumpToMarker?: (seconds: number) => void;
  className?: string;
}

export const VideoPlayer = React.forwardRef<VideoPlayerRef, VideoPlayerProps>(function VideoPlayer(
  {
    src,
    poster,
    autoPlay = false,
    preload = 'metadata',
    fallbackDuration = 0,
    markers = [],
    onTimeUpdate,
    onPlay,
    onPause,
    onEnded,
    onError,
    onJumpToMarker,
    className = '',
  },
  ref
) {
  const videoNodeRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [progressHolder, setProgressHolder] = useState<HTMLElement | null>(null);

  // Expose imperative playback controls to parent
  React.useImperativeHandle(ref, () => ({
    play: () => {
      if (playerRef.current && !playerRef.current.isDisposed?.()) {
        const p = playerRef.current.play();
        if (p && typeof p.then === 'function') {
          return p.catch((err: any) => {
            if (err?.name !== 'AbortError') console.error('Play error:', err);
          });
        }
      }
    },
    pause: () => {
      if (playerRef.current && !playerRef.current.isDisposed?.()) {
        playerRef.current.pause();
      }
    },
    seek: (seconds: number) => {
      if (playerRef.current && !playerRef.current.isDisposed?.()) {
        playerRef.current.currentTime(seconds);
      }
    },
    currentTime: () => {
      if (playerRef.current && !playerRef.current.isDisposed?.()) {
        return playerRef.current.currentTime() || 0;
      }
      return 0;
    },
    duration: () => {
      if (playerRef.current && !playerRef.current.isDisposed?.()) {
        const d = playerRef.current.duration();
        if (d && !isNaN(d) && isFinite(d) && d > 0) return d;
      }
      return fallbackDuration || 0;
    },
    isPaused: () => {
      if (playerRef.current && !playerRef.current.isDisposed?.()) {
        return playerRef.current.paused();
      }
      return true;
    },
  }));

  // Initialize Video.js player once
  useEffect(() => {
    if (!videoNodeRef.current) return;

    // Create a video element
    const vEl = document.createElement('video-js');
    vEl.classList.add(
      'vjs-big-play-centered',
      'vjs-default-skin',
      'vjs-fluid'
    );
    videoNodeRef.current.appendChild(vEl);

    const options: any = {
      autoplay: autoPlay,
      controls: true,
      responsive: true,
      fluid: true,
      preload: preload,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      poster: poster,
      userActions: {
        hotkeys: true,
      },
      sources: [
        {
          src: src,
          type: src.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
        },
      ],
      controlBar: {
        children: [
          'playToggle',
          'volumePanel',
          'currentTimeDisplay',
          'timeDivider',
          'durationDisplay',
          'progressControl',
          'liveDisplay',
          'remainingTimeDisplay',
          'playbackRateMenuButton',
          'pictureInPictureToggle',
          'fullscreenToggle',
        ],
      },
    };

    const vjs = (videojs as any).default || videojs;
    const player = vjs(vEl, options, () => {
      // Find progress holder element for chapter pins
      const holder = vEl.querySelector('.vjs-progress-holder') as HTMLElement;
      if (holder) {
        setProgressHolder(holder);
      }
    });
    playerRef.current = player;

    // Register event listeners
    player.on('timeupdate', () => {
      const cur = player.currentTime() || 0;
      let dur = player.duration() || 0;
      if (isNaN(dur) || !isFinite(dur) || dur <= 0) {
        dur = fallbackDuration;
      }
      onTimeUpdate?.(cur, dur);
    });

    player.on('play', () => onPlay?.());
    player.on('pause', () => onPause?.());
    player.on('ended', () => onEnded?.());
    player.on('error', () => {
      const err = player.error();
      console.error('Video.js error:', err);
      onError?.(err);
    });

    return () => {
      setProgressHolder(null);
      if (player && !player.isDisposed?.()) {
        player.dispose();
        playerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update source when src changes
  useEffect(() => {
    const player = playerRef.current;
    if (player && !player.isDisposed?.()) {
      const currentSources = player.currentSources?.();
      const currentSrc = currentSources?.[0]?.src;
      if (currentSrc !== src) {
        const wasPlaying = !player.paused();
        const curTime = player.currentTime();
        player.src({
          src: src,
          type: src.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
        });
        if (curTime > 0) {
          player.currentTime(curTime);
        }
        if (poster) player.poster(poster);
        if (autoPlay || wasPlaying) {
          player.play()?.catch(() => {});
        }
      }
    }
  }, [src, poster, autoPlay]);

  return (
    <div className={`relative w-full h-full bg-black flex items-center justify-center overflow-hidden rounded-xl group ${className}`}>
      <div data-vjs-player className="w-full h-full flex items-center justify-center">
        <div ref={videoNodeRef} className="w-full h-full" />
      </div>

      {/* Render StageControl Chapter Pins directly inside Video.js timeline slider */}
      {progressHolder &&
        createPortal(
          <>
            {markers.map((m) => {
              const total =
                (playerRef.current?.duration() || 0) > 0
                  ? playerRef.current?.duration() || 1
                  : fallbackDuration || 1;
              const pct = Math.min(100, Math.max(0, (m.timestamp_seconds / total) * 100));
              return (
                <div
                  key={m.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (playerRef.current && !playerRef.current.isDisposed?.()) {
                      playerRef.current.currentTime(m.timestamp_seconds);
                    }
                    onJumpToMarker?.(m.timestamp_seconds);
                  }}
                  style={{ left: `${pct}%` }}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 z-20 group/marker flex items-center justify-center cursor-pointer pointer-events-auto"
                  title={`${m.title} (${Math.floor(m.timestamp_seconds / 60)}:${String(Math.floor(m.timestamp_seconds % 60)).padStart(2, '0')})`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ring-2 ring-black shadow-md transition-transform group-hover/marker:scale-150 ${
                      m.color === 'emerald'
                        ? 'bg-emerald-400'
                        : m.color === 'amber'
                        ? 'bg-amber-400'
                        : m.color === 'blue'
                        ? 'bg-blue-400'
                        : m.color === 'rose'
                        ? 'bg-rose-400'
                        : 'bg-purple-500'
                    }`}
                  />
                  {/* Tooltip on marker hover */}
                  <div className="absolute bottom-full mb-2 hidden group-hover/marker:flex flex-col items-center pointer-events-none whitespace-nowrap z-50">
                    <div className="bg-[#0b0e17] border border-[#232f48] text-white text-[10px] px-2 py-0.5 rounded shadow-lg flex items-center gap-1.5">
                      <span className="font-mono text-purple-400 font-bold">
                        {Math.floor(m.timestamp_seconds / 60)}:{String(Math.floor(m.timestamp_seconds % 60)).padStart(2, '0')}
                      </span>
                      <span className="font-semibold">{m.title}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </>,
          progressHolder
        )}
    </div>
  );
});

