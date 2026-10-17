'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Copy,
  Check,
  Download,
  Trash2,
  Sparkles,
  Clock,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { WalkieCall, api, getAudioMediaUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';

interface WalkieCallCardProps {
  call: WalkieCall;
  canManage?: boolean;
  onDelete?: (callId: string) => void;
}

export function WalkieCallCard({ call, canManage, onDelete }: WalkieCallCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(call.duration_seconds || 0);
  const [copied, setCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Authenticated full audio URL
  const audioSrc = getAudioMediaUrl(call.audio_url);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((err) => console.error('Audio play error:', err));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seekTime = parseFloat(e.target.value);
    audio.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  const handleCopyTranscription = () => {
    if (!call.transcription) return;
    navigator.clipboard.writeText(call.transcription);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(call.id);
    } catch {
      setIsDeleting(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatDateTime = (dateStr: string) => {
    try {
      if (!dateStr) return '';
      // Ensure UTC string is explicitly marked with Z if missing offset so browser parses in local time
      const iso = dateStr.endsWith('Z') || /[+-]\d{2}(:\d{2})?$/.test(dateStr) ? dateStr : `${dateStr}Z`;
      const d = new Date(iso);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const isTranscribing = call.status === 'transcribing';

  return (
    <div className="group relative rounded-xl border border-border/60 bg-card/60 hover:bg-card/90 transition-all duration-200 p-4 shadow-sm hover:shadow-md space-y-3">
      {/* Hidden native audio element */}
      <audio ref={audioRef} src={audioSrc} preload="metadata" data-walkie="true" className="walkie-audio" />

      {/* Top Header: Caller, Role, Timestamp & Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-xs text-primary shrink-0">
            {call.caller_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate text-foreground">
                {call.caller_name}
              </span>
              <RoleBadge role={call.caller_role as 'admin' | 'stage_manager' | 'crew' | 'presenter' | 'viewer'} />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{formatDateTime(call.created_at)}</span>
              <span>•</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-mono">
                {formatSeconds(call.duration_seconds || duration)}
              </Badge>
            </div>
          </div>
        </div>

        {/* Delete button (SM/Admin only) */}
        {canManage && onDelete && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={isDeleting}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-70 group-hover:opacity-100 transition-opacity"
            title="Delete recording"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Audio Replay Controller */}
      <div className="flex items-center gap-3 bg-muted/30 border border-border/40 rounded-lg p-2.5">
        <Button
          size="sm"
          variant="secondary"
          onClick={togglePlay}
          className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          title={isPlaying ? 'Pause' : 'Play recorded transmission'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </Button>

        {/* Scrubber Timeline */}
        <div className="flex-1 space-y-1">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-muted-foreground/20 rounded-lg appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>{formatSeconds(currentTime)}</span>
            <span>{formatSeconds(duration)}</span>
          </div>
        </div>

        {/* Volume & Download */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (isMuted) {
                audio.muted = false;
                setIsMuted(false);
              } else {
                audio.muted = true;
                setIsMuted(true);
              }
            }}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </Button>

          <a
            href={audioSrc}
            download={`walkie_${call.caller_name.replace(/\s+/g, '_')}_${call.id.slice(0, 8)}.wav`}
            className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="Download audio recording (.wav)"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* AI Speech Transcription Box */}
      <div className="rounded-lg bg-background/80 border border-border/40 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="uppercase tracking-wider text-[10px]">AI Transcription</span>
            {call.language && (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1 uppercase text-muted-foreground border-border/60">
                {call.language}
              </Badge>
            )}
          </div>

          {call.transcription && !isTranscribing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCopyTranscription}
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400 mr-1" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          )}
        </div>

        {isTranscribing ? (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
            <span className="italic">Generating Whisper speech-to-text transcript...</span>
          </div>
        ) : (
          <p className="text-sm text-foreground/90 leading-relaxed select-text font-normal">
            &ldquo;{call.transcription || '(No speech detected)'}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
