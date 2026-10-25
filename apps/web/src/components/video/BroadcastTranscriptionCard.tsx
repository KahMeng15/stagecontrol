'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  FileText,
  Mic,
  Clock,
  Music,
  Search,
  Trash2,
  Copy,
  Check,
  ArrowDown,
  RefreshCw,
  X,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api, getWebSocketUrl, SubtitleItem } from '@/lib/api';
import { copyToClipboard, cn } from '@/lib/utils';
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
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcriptSearch, setTranscriptSearch] = useState<string>('');
  const [togglingTranscription, setTogglingTranscription] = useState<boolean>(false);
  const [isLiveFollow, setIsLiveFollow] = useState<boolean>(true);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const isLiveFollowRef = useRef<boolean>(true);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const captionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch initial subtitles and transcription status
  const fetchSubtitles = useCallback(async () => {
    try {
      const data = await api.listSubtitles(eventId);
      setSubtitles(data);
    } catch {}
  }, [eventId]);

  const fetchTranscriptionStatus = useCallback(async () => {
    try {
      const status = await api.getSubtitleStatus(eventId);
      setIsTranscribing(status.is_active);
    } catch {}
  }, [eventId]);

  useEffect(() => {
    fetchSubtitles();
    fetchTranscriptionStatus();
    const interval = setInterval(() => {
      fetchTranscriptionStatus();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchSubtitles, fetchTranscriptionStatus]);

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
            if (data.type === 'connected') {
              setIsTranscribing(Boolean(data.is_transcribing));
            } else if (data.type === 'subtitle') {
              setActiveCaption(data.text);
              setActiveSubtitleId(data.id || data.text);
              setIsTranscribing(true);
              setSubtitles((prev) => {
                if (prev.some((p) => p.id === data.id)) return prev;
                return [data, ...prev].slice(0, 200);
              });

              if (isLiveFollowRef.current && transcriptContainerRef.current) {
                transcriptContainerRef.current.scrollTop = 0;
              } else {
                setUnreadCount((c) => c + 1);
              }

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

  const handleToggleTranscription = async () => {
    try {
      setTogglingTranscription(true);
      const res = await api.toggleTranscription(eventId);
      setIsTranscribing(res.is_active);
      toast.success(res.is_active ? 'Speech transcription activated' : 'Speech transcription paused');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle transcription');
    } finally {
      setTogglingTranscription(false);
    }
  };

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

  const handleCopyLine = (text: string, id: string) => {
    copyToClipboard(text);
    setCopiedId(id);
    toast.success('Spoken line copied');
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCopyAll = () => {
    if (subtitles.length === 0) return;
    const fullText = subtitles
      .slice()
      .reverse()
      .map((s) => {
        const time = s.created_at ? new Date(s.created_at).toLocaleTimeString() : '';
        return `[${time}] ${s.text}`;
      })
      .join('\n');
    copyToClipboard(fullText);
    setCopiedAll(true);
    toast.success('Full broadcast transcript copied');
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const filteredSubtitles = transcriptSearch.trim()
    ? subtitles.filter((s) => s.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
    : subtitles;

  return (
    <Card className={cn("flex flex-col border-border/70 shadow-sm relative overflow-hidden", className)}>
      {/* Active speaker backdrop glow */}
      {isTranscribing && (
        <div className="absolute inset-0 bg-emerald-500/5 pointer-events-none animate-pulse" />
      )}

      {/* Card Header */}
      <CardHeader className="pb-3 border-b border-border/40 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <CardTitle className="text-xs font-bold uppercase tracking-wider">
              Live Broadcast Transcription
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {isTranscribing ? (
              <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-500/15 border-emerald-500/30 text-emerald-400 font-semibold animate-pulse">
                <Mic className="w-2.5 h-2.5" />
                <span>LISTENING</span>
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                IDLE
              </Badge>
            )}
            {subtitles.length > 0 && (
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-mono">
                {subtitles.length}
              </Badge>
            )}
          </div>
        </div>

        <CardDescription className="text-xs flex items-center justify-between">
          <span>Real-time speech-to-text transcription powered by Malaysian Whisper.</span>
          <span className="text-[10px] text-muted-foreground font-mono">AI ASSISTED</span>
        </CardDescription>

        {/* Search & Actions Bar */}
        <div className="flex items-center justify-between gap-2 pt-2">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={transcriptSearch}
              onChange={(e) => setTranscriptSearch(e.target.value)}
              placeholder="Search broadcast dialogue..."
              className="pl-7 pr-7 h-7 text-xs w-full bg-background/50"
            />
            {transcriptSearch && (
              <button
                type="button"
                onClick={() => setTranscriptSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Auto-Follow Live Mode Toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !isLiveFollow;
                setIsLiveFollow(next);
                isLiveFollowRef.current = next;
                if (next) {
                  setUnreadCount(0);
                  transcriptContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              className={`h-7 text-[10px] px-2 rounded-lg border transition-colors flex items-center gap-1 font-mono ${
                isLiveFollow
                  ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10 font-bold'
                  : 'border-border/70 text-muted-foreground hover:text-foreground'
              }`}
              title={isLiveFollow ? 'Auto-following live speech. Click to browse history.' : 'Auto-follow paused. Click to jump to live speech.'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isLiveFollow ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{isLiveFollow ? 'Auto-Scroll: ON' : 'Paused'}</span>
            </button>

            {/* Copy All */}
            {subtitles.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={handleCopyAll}
                title="Copy entire transcript"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                {copiedAll ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            )}

            {/* SM / Admin Controls */}
            {isSMOrAdmin && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={handleToggleTranscription}
                  disabled={togglingTranscription}
                  className="h-7 text-[11px] px-2"
                >
                  {isTranscribing ? 'Pause AI' : 'Start AI'}
                </Button>
                {subtitles.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleClearSubtitles}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="Clear transcript"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 flex flex-col flex-1 min-h-0 relative">
        {/* Subtitles Feed Container */}
        <div className="flex-1 min-h-0 relative bg-muted/15 border border-border/40 rounded-xl">
          {/* Floating Go to Now button when user scrolled away */}
          {!isLiveFollow && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
              <Button
                type="button"
                size="xs"
                onClick={() => {
                  setIsLiveFollow(true);
                  isLiveFollowRef.current = true;
                  setUnreadCount(0);
                  transcriptContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="h-7 px-3 rounded-full text-[11px] font-semibold gap-1.5 shadow-lg shadow-primary/20 bg-primary text-primary-foreground hover:bg-primary/90 animate-in fade-in slide-in-from-top-1"
              >
                <ArrowDown className="w-3 h-3 animate-bounce" />
                <span>Go to Now</span>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 h-4 text-[10px] font-mono">
                    +{unreadCount}
                  </Badge>
                )}
              </Button>
            </div>
          )}

          <div
            ref={transcriptContainerRef}
            onScroll={() => {
              if (!transcriptContainerRef.current) return;
              const scrollTop = transcriptContainerRef.current.scrollTop;
              if (scrollTop > 35) {
                setIsLiveFollow(false);
                isLiveFollowRef.current = false;
              } else {
                setIsLiveFollow(true);
                isLiveFollowRef.current = true;
                setUnreadCount(0);
              }
            }}
            className="absolute inset-0 overflow-y-auto p-2 space-y-1.5 scroll-smooth"
          >
            {filteredSubtitles.length === 0 ? (
              <div className="h-full min-h-[140px] flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-border/60 bg-muted/10 text-center space-y-2">
                <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {transcriptSearch ? 'No matching dialogue lines' : 'Waiting for broadcast speech'}
                  </p>
                  <p className="text-[11px] text-muted-foreground max-w-xs mt-0.5">
                    {transcriptSearch
                      ? 'Try a different search term or clear the filter.'
                      : 'Audio from the live OBS broadcast is transcribed in real-time using Malaysian Whisper.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/30 border border-border/40 rounded-lg overflow-hidden bg-background/60">
                {filteredSubtitles.map((sub, idx) => {
                  const localTime = sub.created_at
                    ? new Date(sub.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : '--:--:--';

                  const isActive = Boolean(
                    (activeSubtitleId && (sub.id === activeSubtitleId || sub.text === activeCaption)) ||
                    (!activeSubtitleId && activeCaption && (sub.text === activeCaption || idx === 0))
                  );

                  return (
                    <div
                      key={sub.id || idx}
                      className={`group px-3 py-2 transition-colors flex items-start justify-between gap-2.5 text-xs ${
                        isActive
                          ? 'bg-primary/10 border-l-3 border-l-primary shadow-sm'
                          : 'border-l-3 border-l-transparent hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className={`shrink-0 flex items-center gap-1 font-mono text-[10px] select-none pt-0.5 ${
                          isActive ? 'text-primary font-semibold' : 'text-muted-foreground'
                        }`}>
                          <Clock className="w-3 h-3 text-muted-foreground/70" />
                          <span>{localTime}</span>
                        </span>

                        <div className="flex-1 min-w-0">
                          <p className={`leading-snug break-words transition-colors flex items-center gap-1.5 ${
                            isActive ? 'text-primary font-semibold' : 'text-foreground font-medium'
                          }`}>
                            {sub.is_music && (
                              <Music className="w-3 h-3 text-orange-400 shrink-0" />
                            )}
                            <span>{sub.text}</span>
                          </p>
                        </div>

                        {isActive && (
                          <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 font-mono font-bold shrink-0">
                            LIVE
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0 pt-0.5">
                        <Badge variant="outline" className="text-[9px] uppercase font-mono px-1 py-0 text-muted-foreground">
                          {sub.language || 'ms'}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleCopyLine(sub.text, sub.id || String(idx))}
                          className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 text-muted-foreground hover:text-foreground"
                          title="Copy line"
                        >
                          {copiedId === (sub.id || String(idx)) ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

