'use client';

import React from 'react';
import {
  Mic,
  Radio,
  ExternalLink,
  Volume2,
  ArrowUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WalkieCall, WalkieActiveSpeaker, WalkiePresenceUser, getAudioMediaUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

interface WalkieCardProps {
  voiceRoom: string;
  isConnected: boolean;
  isTransmitting: boolean;
  isHandsFree: boolean;
  audioLevel: number;
  incomingSpeaker: WalkieActiveSpeaker | null;
  incomingAudioLevel: number;
  connectedUsers: WalkiePresenceUser[];
  channelBusyMessage: string | null;
  recentCalls: WalkieCall[];
  onStartTransmission: () => void;
  onStopTransmission: () => void;
  onToggleTransmission: () => void;
  onOpenCommsTab: () => void;
  onPlaybackChange?: (isPlaying: boolean) => void;
  className?: string;
}

interface WalkieRecentCallItemProps {
  call: WalkieCall;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPlaybackEnded: () => void;
}

function WalkieRecentCallItem({
  call,
  isPlaying,
  onTogglePlay,
  onPlaybackEnded,
}: WalkieRecentCallItemProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(call.duration_seconds || 0);

  const audioSrc = getAudioMediaUrl(call.audio_url);

  // Synchronize playing state with HTML5 audio element
  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.play().catch((err) => {
        console.error('Audio play error:', err);
        onPlaybackEnded();
      });
    } else {
      audio.pause();
      audio.currentTime = 0;
      setCurrentTime(0);
    }
  }, [isPlaying, onPlaybackEnded]);

  // Audio lifecycle event listeners
  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setCurrentTime(0);
      onPlaybackEnded();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
    };
  }, [onPlaybackEnded]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seekTime = parseFloat(e.target.value);
    audio.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatTimeOnly = (dateStr: string) => {
    try {
      if (!dateStr) return '';
      const iso = dateStr.endsWith('Z') || /[+-]\d{2}(:\d{2})?$/.test(dateStr) ? dateStr : `${dateStr}Z`;
      const d = new Date(iso);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTogglePlay}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTogglePlay();
        }
      }}
      className={cn(
        "px-3 py-2 text-xs transition-colors cursor-pointer select-none",
        isPlaying
          ? "bg-primary/10"
          : "hover:bg-muted/40"
      )}
    >
      {/* Native HTML5 Audio Element in DOM tree with walkie tags */}
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        data-walkie="true"
        className="walkie-audio"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isPlaying && <Volume2 className="w-3.5 h-3.5 text-primary animate-pulse shrink-0" />}
          <span className={cn("font-semibold truncate", isPlaying ? "text-primary" : "text-foreground")}>
            {call.caller_name}
          </span>
        </div>

        <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
          {formatTimeOnly(call.created_at)}
        </span>
      </div>

      {/* Playback Scrubber when playing */}
      {isPlaying && (
        <div
          className="flex items-center gap-2 animate-in fade-in duration-150 py-0.5 mt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min="0"
            max={duration > 0 ? duration : 1}
            step="0.05"
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1 bg-muted-foreground/30 rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
            {formatSeconds(currentTime)} / {formatSeconds(duration)}
          </span>
        </div>
      )}

      {/* Transcription message */}
      <div className="mt-0.5">
        {call.status === 'transcribing' ? (
          <span className="text-muted-foreground italic text-[11px] flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border border-primary border-t-transparent animate-spin" />
            Transcribing audio with Whisper AI...
          </span>
        ) : (
          <p className="text-xs text-foreground/90 font-normal leading-snug break-words whitespace-normal select-text">
            &ldquo;{call.transcription || '(No speech detected)'}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

export function WalkieCard({
  isConnected,
  isTransmitting,
  isHandsFree,
  audioLevel,
  incomingSpeaker,
  incomingAudioLevel,
  channelBusyMessage,
  recentCalls,
  onStartTransmission,
  onStopTransmission,
  onOpenCommsTab,
  onPlaybackChange,
  className,
}: WalkieCardProps) {
  const [playingCallId, setPlayingCallId] = React.useState<string | null>(null);

  // Notify parent of playback state for audio ducking
  React.useEffect(() => {
    onPlaybackChange?.(!!playingCallId);
  }, [playingCallId, onPlaybackChange]);

  // If someone transmits live or incoming voice arrives, immediately pause call replay
  React.useEffect(() => {
    if (isTransmitting || incomingSpeaker) {
      setPlayingCallId(null);
    }
  }, [isTransmitting, incomingSpeaker]);

  // Auto-scroll & scroll-position tracking
  const feedRef = React.useRef<HTMLDivElement | null>(null);
  const [isScrolledAway, setIsScrolledAway] = React.useState(false);
  const isAtTopRef = React.useRef(true);

  // Auto-scroll to top on new calls ONLY IF user is at the top
  React.useEffect(() => {
    if (isAtTopRef.current && feedRef.current) {
      feedRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [recentCalls]);

  const handleFeedScroll = () => {
    if (!feedRef.current) return;
    const isAway = feedRef.current.scrollTop > 20;
    isAtTopRef.current = !isAway;
    setIsScrolledAway(isAway);
  };

  const scrollToLatest = () => {
    if (feedRef.current) {
      feedRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      isAtTopRef.current = true;
      setIsScrolledAway(false);
    }
  };

  const isSomeoneElseSpeaking = !!incomingSpeaker;

  return (
    <div
      className={cn(
        "bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col relative group shadow-2xl text-card-foreground",
        className
      )}
    >
      {/* Active speaker backdrop glow */}
      {isTransmitting && (
        <div className="absolute inset-0 bg-red-500/5 pointer-events-none animate-pulse" />
      )}
      {isSomeoneElseSpeaking && (
        <div className="absolute inset-0 bg-blue-500/5 pointer-events-none animate-pulse" />
      )}

      {/* Card Header Bar */}
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3 bg-muted/30 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <Radio className={cn("w-4 h-4", isTransmitting ? "text-destructive animate-pulse" : "text-primary")} />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
            Crew Walkie-Talkie
          </span>
        </div>

        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={onOpenCommsTab}
          title="Open Full Comms"
          className="rounded text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Card Content */}
      <div className="p-4 flex flex-col flex-1 min-h-0 gap-3">
        {/* RECENT VOICE CALLS (Expands flexibly to fill available vertical space) */}
        <div className="flex-1 min-h-0 relative bg-muted/15 border border-border/40 rounded-xl overflow-hidden">
          <div
            ref={feedRef}
            onScroll={handleFeedScroll}
            className="absolute inset-0 overflow-y-auto divide-y divide-border/30 scroll-smooth"
          >
            {recentCalls.length === 0 ? (
              <div className="h-full min-h-[140px] flex flex-col items-center justify-center p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-foreground">No recorded calls yet</p>
                <p className="text-[11px] text-muted-foreground max-w-xs">
                  Hold the button below or press <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono border border-border/60">[SPACE]</kbd> to broadcast a voice message to all online crew.
                </p>
              </div>
            ) : (
              recentCalls.map((call) => (
                <WalkieRecentCallItem
                  key={call.id}
                  call={call}
                  isPlaying={playingCallId === call.id}
                  onTogglePlay={() => {
                    setPlayingCallId((prev) => (prev === call.id ? null : call.id));
                  }}
                  onPlaybackEnded={() => {
                    setPlayingCallId((prev) => (prev === call.id ? null : prev));
                  }}
                />
              ))
            )}
          </div>

          {/* View Latest Call Floating Button */}
          {isScrolledAway && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
              <Button
                type="button"
                size="xs"
                onClick={scrollToLatest}
                className="h-7 px-3 text-[11px] shadow-xl bg-primary text-primary-foreground hover:bg-primary/90 rounded-full gap-1.5 font-semibold animate-in fade-in slide-in-from-top-2"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>View Latest Call</span>
              </Button>
            </div>
          )}
        </div>

        {/* PUSH-TO-TALK CONSOLE & GIANT BUTTON */}
        <div className="shrink-0 flex flex-col items-center justify-center py-5 px-3 bg-muted/40 rounded-xl border border-border/50 relative">
          {/* Radial Equalizer Wave Ring */}
          {(isTransmitting || isSomeoneElseSpeaking) && (
            <div
              className={`absolute w-36 h-36 rounded-full border-2 transition-all duration-75 pointer-events-none ${
                isTransmitting
                  ? 'border-red-500/40 bg-red-500/10 scale-110 animate-ping'
                  : 'border-blue-500/40 bg-blue-500/10 scale-105 animate-pulse'
              }`}
              style={{
                transform: `scale(${1 + (isTransmitting ? audioLevel : incomingAudioLevel) * 0.4})`,
              }}
            />
          )}

          {/* Giant Hold-to-Talk Button */}
          <button
            type="button"
            onMouseDown={onStartTransmission}
            onMouseUp={onStopTransmission}
            onMouseLeave={isTransmitting && !isHandsFree ? onStopTransmission : undefined}
            onTouchStart={(e) => {
              e.preventDefault();
              onStartTransmission();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              onStopTransmission();
            }}
            disabled={!isConnected || (isSomeoneElseSpeaking && !isTransmitting)}
            className={`w-24 h-24 rounded-full flex flex-col items-center justify-center select-none shadow-lg transition-all duration-150 relative z-10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
              isTransmitting
                ? 'bg-destructive text-white shadow-destructive/40 border-4 border-white ring-4 ring-destructive/40'
                : isSomeoneElseSpeaking
                ? 'bg-blue-600 text-white shadow-blue-500/30 border-2 border-blue-400 cursor-not-allowed'
                : 'bg-gradient-to-b from-card to-muted hover:from-muted hover:to-muted/80 text-foreground border-2 border-border/80 hover:border-primary/50 shadow-black/20'
            }`}
          >
            {isTransmitting ? (
              <>
                <Mic className="w-8 h-8 mb-1 animate-bounce" />
                <span className="text-[10px] font-black tracking-widest uppercase">
                  TRANSMITTING
                </span>
              </>
            ) : isSomeoneElseSpeaking ? (
              <>
                <Radio className="w-7 h-7 mb-1 animate-pulse" />
                <span className="text-[9px] font-bold tracking-wider uppercase text-center px-2 truncate max-w-full">
                  {incomingSpeaker?.caller_name}
                </span>
              </>
            ) : (
              <>
                <Mic className="w-7 h-7 mb-1 text-primary group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-bold tracking-wider uppercase text-foreground">
                  HOLD TO TALK
                </span>
              </>
            )}
          </button>

          {/* Spacebar to Talk */}
          <div className="flex items-center justify-center mt-3 text-[11px] text-muted-foreground z-10">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] bg-background/80 px-2 py-0.5 rounded border border-border/60">
              [SPACE] to Talk
            </span>
          </div>

          {/* Busy warning */}
          {channelBusyMessage && (
            <div className="mt-2 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full animate-in fade-in duration-150">
              {channelBusyMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
