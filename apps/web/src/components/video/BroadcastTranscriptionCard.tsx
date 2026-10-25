'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Trash2,
  ArrowUp,
  Music,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api, getWebSocketUrl, SubtitleItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface BroadcastTranscriptionCardProps {
  eventId: string;
  isSMOrAdmin: boolean;
  className?: string;
}

export function BroadcastTranscriptionCard({
  eventId,
  isSMOrAdmin,
  className,
}: BroadcastTranscriptionCardProps) {
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [activeCaption, setActiveCaption] = useState<string | null>(null);
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null);
  const [isScrolledAway, setIsScrolledAway] = useState<boolean>(false);

  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);
  const isAtTopRef = useRef<boolean>(true);
  const captionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchTranscriptionStatus = useCallback(async () => {
    try {
      await api.getSubtitleStatus(eventId);
    } catch {}
  }, [eventId]);

  useEffect(() => {
    let isSubscribed = true;
    api.listSubtitles(eventId).then((data) => {
      if (isSubscribed) setSubtitles(data);
    }).catch(() => {});

    const interval = setInterval(() => {
      fetchTranscriptionStatus();
    }, 4000);
    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [eventId, fetchTranscriptionStatus]);

  // Auto-scroll to top on new subtitles ONLY IF user is at the top (matches WalkieCard)
  useEffect(() => {
    if (isAtTopRef.current && transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [subtitles]);

  // WebSocket for Real-time Subtitles Streaming
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isDisposed = false;

    const connectWebSocket = () => {
      if (isDisposed) return;
      try {
        const wsUrl = getWebSocketUrl(`/api/events/${eventId}/subtitles/ws`);
        if (!wsUrl) return;

        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'subtitle') {
              setActiveCaption(data.text);
              setActiveSubtitleId(data.id || data.text);
              setSubtitles((prev) => {
                if (prev.some((p) => p.id === data.id)) return prev;
                return [data, ...prev].slice(0, 200);
              });

              if (captionTimeoutRef.current) {
                clearTimeout(captionTimeoutRef.current);
              }
              captionTimeoutRef.current = setTimeout(() => {
                setActiveCaption(null);
                setActiveSubtitleId(null);
              }, 5000);
            }
          } catch {}
        };

        ws.onclose = () => {
          if (!isDisposed) {
            reconnectTimer = setTimeout(connectWebSocket, 4000);
          }
        };

        ws.onerror = () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        };
      } catch {
        if (!isDisposed) {
          reconnectTimer = setTimeout(connectWebSocket, 4000);
        }
      }
    };

    connectWebSocket();

    return () => {
      isDisposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
      if (captionTimeoutRef.current) {
        clearTimeout(captionTimeoutRef.current);
      }
    };
  }, [eventId]);

  const handleClearSubtitles = async () => {
    if (!confirm('Clear all recorded subtitles and transcripts for this event?')) return;
    try {
      await api.clearSubtitles(eventId);
      setSubtitles([]);
      setActiveCaption(null);
      toast.success('Transcript cleared');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear subtitles');
    }
  };

  const handleFeedScroll = () => {
    if (!transcriptContainerRef.current) return;
    const isAway = transcriptContainerRef.current.scrollTop > 20;
    isAtTopRef.current = !isAway;
    setIsScrolledAway(isAway);
  };

  const scrollToLatest = () => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      isAtTopRef.current = true;
      setIsScrolledAway(false);
    }
  };

  const formatTimeOnly = (dateStr?: string) => {
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
      className={cn(
        "bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col relative shadow-2xl text-card-foreground",
        className
      )}
    >
      {/* Card Header Bar */}
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3 bg-muted/30 z-10 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider truncate">
            Transcription
          </span>
          {subtitles.length > 0 && (
            <Badge variant="secondary" className="font-mono text-[9px] uppercase font-bold tracking-wider h-5 px-1.5 shrink-0">
              {subtitles.length} lines
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* SM / Admin Clear Action */}
          {isSMOrAdmin && subtitles.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleClearSubtitles}
              className="h-7 w-7 rounded text-muted-foreground hover:text-destructive shrink-0"
              title="Clear transcript"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="p-3 flex flex-col flex-1 min-h-0 relative">
        {/* Subtitles Feed List Container */}
        <div className="flex-1 min-h-0 relative bg-muted/15 border border-border/40 rounded-xl overflow-hidden">
          <div
            ref={transcriptContainerRef}
            onScroll={handleFeedScroll}
            className="absolute inset-0 overflow-y-auto divide-y divide-border/30 scroll-smooth"
          >
            {subtitles.length === 0 ? (
              <div className="h-full min-h-[140px] flex flex-col items-center justify-center p-4 text-center space-y-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Waiting for speech</p>
                  <p className="text-[11px] text-muted-foreground max-w-xs mt-0.5">
                    Audio from the live broadcast is transcribed in real-time.
                  </p>
                </div>
              </div>
            ) : (
              subtitles.map((sub, idx) => {
                const isActive = Boolean(
                  (activeSubtitleId && (sub.id === activeSubtitleId || sub.text === activeCaption)) ||
                  (!activeSubtitleId && activeCaption && (sub.text === activeCaption || idx === 0))
                );

                return (
                  <div
                    key={sub.id || idx}
                    className={cn(
                      "px-3 py-2 text-xs transition-colors select-none",
                      isActive
                        ? "bg-primary/10"
                        : "hover:bg-muted/40"
                    )}
                  >
                    {/* Top Row: Time (top-left) & Language (top-right) */}
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[10px] font-mono shrink-0",
                          isActive ? "text-primary font-semibold" : "text-muted-foreground"
                        )}
                      >
                        {formatTimeOnly(sub.created_at)}
                      </span>

                      <Badge
                        variant="outline"
                        className="text-[9px] uppercase font-mono px-1 py-0 h-4 text-muted-foreground shrink-0"
                      >
                        {sub.language || 'ms'}
                      </Badge>
                    </div>

                    {/* Below: Transcription text */}
                    <div className="mt-0.5">
                      <p
                        className={cn(
                          "text-xs leading-snug break-words whitespace-normal select-text",
                          isActive ? "text-primary font-medium" : "text-foreground font-normal"
                        )}
                      >
                        {sub.is_music && (
                          <Music className="w-3 h-3 text-orange-400 inline mr-1.5 shrink-0 align-sub" />
                        )}
                        <span>{sub.text}</span>
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Floating View Latest Button when user scrolled away */}
          {isScrolledAway && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
              <Button
                type="button"
                size="xs"
                onClick={scrollToLatest}
                className="h-7 px-3 text-[11px] shadow-xl bg-primary text-primary-foreground hover:bg-primary/90 rounded-full gap-1.5 font-semibold animate-in fade-in slide-in-from-top-2"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>View Latest</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
