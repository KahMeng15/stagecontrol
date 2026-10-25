'use client';

import React from 'react';
import {
  Mic,
  MicOff,
  Radio,
  Lock,
  Unlock,
  Users,
  Play,
  Pause,
  ExternalLink,
  Volume2,
  VolumeX,
  Clock,
  Sparkles,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
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
      className={`p-2.5 rounded-lg border text-xs transition-all space-y-1.5 shadow-2xs ${
        isPlaying
          ? 'bg-primary/5 border-primary/40 shadow-sm'
          : 'bg-card/80 hover:bg-card border-border/60'
      }`}
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
        <div className="flex items-center gap-2 min-w-0">
          {/* Play / Pause button */}
          <button
            type="button"
            onClick={onTogglePlay}
            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-transform active:scale-95 ${
              isPlaying
                ? 'bg-amber-500 hover:bg-amber-600 text-white animate-pulse'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
            title={isPlaying ? 'Pause audio' : 'Play audio recording'}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5 ml-0.5" />
            )}
          </button>

          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-semibold text-foreground truncate">
              {call.caller_name}
            </span>
            <RoleBadge role={call.caller_role} />
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0 font-mono">
          <Clock className="w-3 h-3 text-muted-foreground/70" />
          <span>{formatTimeOnly(call.created_at)}</span>
          <span>•</span>
          <span className="bg-background/80 px-1.5 py-0.5 rounded border border-border/50">
            {formatSeconds(isPlaying ? currentTime : call.duration_seconds)}
          </span>
        </div>
      </div>

      {/* Playback Scrubber when playing */}
      {isPlaying && (
        <div className="pl-9 pr-1 flex items-center gap-2 animate-in fade-in duration-150">
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

      {/* FULL TRANSCRIPTION MESSAGE (NO TRUNCATION) */}
      <div className="pl-9 pr-1">
        {call.status === 'transcribing' ? (
          <span className="text-muted-foreground italic text-[11px] flex items-center gap-1">
            <span className="w-2 h-2 rounded-full border border-primary border-t-transparent animate-spin" />
            Transcribing audio with Whisper AI...
          </span>
        ) : (
          <p className="text-xs text-foreground/90 font-normal leading-relaxed break-words whitespace-normal select-text">
            &ldquo;{call.transcription || '(No speech detected)'}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

export function WalkieCard({
  voiceRoom,
  isConnected,
  isTransmitting,
  isHandsFree,
  audioLevel,
  incomingSpeaker,
  incomingAudioLevel,
  connectedUsers,
  channelBusyMessage,
  recentCalls,
  onStartTransmission,
  onStopTransmission,
  onToggleTransmission,
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
  const [isAutoScroll, setIsAutoScroll] = React.useState(true);
  const [isScrolledDown, setIsScrolledDown] = React.useState(false);

  // Auto-scroll effect on new incoming calls
  React.useEffect(() => {
    if (isAutoScroll && feedRef.current) {
      feedRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [recentCalls, isAutoScroll]);

  const handleFeedScroll = () => {
    if (!feedRef.current) return;
    const scrolled = feedRef.current.scrollTop > 30;
    setIsScrolledDown(scrolled);
  };

  const scrollToLatest = () => {
    if (feedRef.current) {
      feedRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      setIsScrolledDown(false);
      setIsAutoScroll(true);
    }
  };

  const isSomeoneElseSpeaking = !!incomingSpeaker;

  return (
    <Card className={cn("flex flex-col border-border/70 shadow-sm relative overflow-hidden", className)}>
      {/* Active speaker backdrop glow */}
      {isTransmitting && (
        <div className="absolute inset-0 bg-red-500/5 pointer-events-none animate-pulse" />
      )}
      {isSomeoneElseSpeaking && (
        <div className="absolute inset-0 bg-blue-500/5 pointer-events-none animate-pulse" />
      )}

      {/* Card Header */}
      <CardHeader className="pb-3 border-b border-border/40 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${isTransmitting ? 'text-destructive animate-pulse' : 'text-emerald-400'}`} />
            <CardTitle className="text-xs font-bold uppercase tracking-wider">
              Crew Walkie-Talkie
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] ${
                isConnected
                  ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                  : 'border-muted text-muted-foreground'
              }`}
            >
              {isConnected ? 'LIVE COMMS' : 'CONNECTING...'}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={onOpenCommsTab}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Full View <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs flex items-center justify-between">
          <span>Push-to-talk voice channel for stage directors & crew.</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Users className="w-3 h-3" />
            <strong>{connectedUsers.length}</strong> online
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="p-4 flex flex-col flex-1 min-h-0 gap-3">
        {/* SECTION 1: RECENT VOICE CALLS (Expands flexibly to fill available vertical space) */}
        <div className="flex-1 flex flex-col min-h-0 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
            <div className="flex items-center gap-1.5 text-foreground">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Recent Calls & Transcripts</span>
              {recentCalls.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 bg-muted text-foreground/80 rounded-full font-mono font-bold">
                  {recentCalls.length}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Auto-Scroll Toggle Button */}
              <button
                type="button"
                onClick={() => setIsAutoScroll((prev) => !prev)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors flex items-center gap-1 font-mono ${
                  isAutoScroll
                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10 font-bold'
                    : 'border-border/70 text-muted-foreground hover:text-foreground'
                }`}
                title="Toggle automatic scrolling to latest calls"
              >
                <ArrowDown className={`w-3 h-3 ${isAutoScroll ? 'text-emerald-400 animate-bounce' : ''}`} />
                <span>Auto-Scroll: {isAutoScroll ? 'ON' : 'OFF'}</span>
              </button>

              {recentCalls.length > 0 && (
                <button
                  type="button"
                  onClick={onOpenCommsTab}
                  className="text-primary hover:underline lowercase font-normal"
                >
                  view all
                </button>
              )}
            </div>
          </div>

          {/* Calls Feed Container with Flexible Height & Auto Scroll */}
          <div className="flex-1 min-h-0 relative bg-muted/15 border border-border/40 rounded-xl p-2">
            <div
              ref={feedRef}
              onScroll={handleFeedScroll}
              className="absolute inset-0 overflow-y-auto space-y-2 p-2 scroll-smooth"
            >
              {recentCalls.length === 0 ? (
                <div className="h-full min-h-[140px] flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-border/60 bg-muted/20 text-center space-y-1">
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

            {/* Jump to Latest Floating Button */}
            {isScrolledDown && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
                <Button
                  size="xs"
                  onClick={scrollToLatest}
                  className="h-7 px-3 text-[11px] shadow-xl bg-primary text-primary-foreground hover:bg-primary/90 rounded-full gap-1.5 font-semibold animate-in fade-in slide-in-from-top-2"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>Jump to Latest Call</span>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* SECTION 2: PUSH-TO-TALK CONSOLE & GIANT BUTTON (Anchored firmly below recent calls) */}
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
                : 'bg-gradient-to-b from-card to-muted hover:from-muted hover:to-muted/80 text-foreground border-2 border-border/80 hover:border-emerald-500/50 shadow-black/20'
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
                <Mic className="w-7 h-7 mb-1 text-emerald-400 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-bold tracking-wider uppercase text-foreground">
                  HOLD TO TALK
                </span>
              </>
            )}
          </button>

          {/* Spacebar & Hands-Free Toggle */}
          <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground z-10">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] bg-background/80 px-2 py-0.5 rounded border border-border/60">
              [SPACE] to Talk
            </span>
            <span>•</span>
            <button
              type="button"
              onClick={onToggleTransmission}
              className={`inline-flex items-center gap-1 text-[11px] font-medium transition-colors hover:text-foreground ${
                isHandsFree ? 'text-emerald-400 font-bold' : ''
              }`}
            >
              {isHandsFree ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
              {isHandsFree ? 'Locked ON' : 'Toggle Lock'}
            </button>
          </div>

          {/* Busy warning */}
          {channelBusyMessage && (
            <div className="mt-2 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-3 py-1 rounded-full animate-in fade-in duration-150">
              {channelBusyMessage}
            </div>
          )}

          <span className="text-[10px] text-muted-foreground mt-2 font-mono">
            Room: <strong className="text-foreground">{voiceRoom || 'connecting...'}</strong>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
