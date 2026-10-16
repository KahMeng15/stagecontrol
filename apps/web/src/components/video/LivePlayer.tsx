'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Tv,
  RefreshCw,
  Radio,
  Zap,
  Layers,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  HelpCircle,
  X,
  Flag,
  Bookmark,
  Clock,
  Plus,
  Trash2,
  Subtitles,
  FileText,
  Sparkles,
  Mic,
  Search,
  ArrowDown,
} from 'lucide-react';
import { api, API_BASE, getWebSocketUrl, StreamStatus, VideoMarker, SubtitleItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface LivePlayerProps {
  eventId: string;
  streamKey?: string | null;
  isSMOrAdmin?: boolean;
  onOpenStreamSetup?: () => void;
}

export function LivePlayer({
  eventId,
  isSMOrAdmin = false,
  onOpenStreamSetup,
}: LivePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  // Default to HLS because standard OBS encoders output H.264 High Profile with B-frames and AAC audio
  const [playerMode, setPlayerMode] = useState<'hls' | 'webrtc'>('hls');
  const [copiedRtmp, setCopiedRtmp] = useState(false);
  const [showBFrameHint, setShowBFrameHint] = useState(false);

  // Live moment markers state
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [showMarkModal, setShowMarkModal] = useState(false);
  const [markTitle, setMarkTitle] = useState('');
  const [markColor, setMarkColor] = useState('purple');
  const [savingMark, setSavingMark] = useState(false);
  const [showMarkerLog, setShowMarkerLog] = useState(false);

  // Live Subtitles & Closed Captions (Mesolitica Malaysian Whisper)
  const [subtitles, setSubtitles] = useState<SubtitleItem[]>([]);
  const [activeCaption, setActiveCaption] = useState<string | null>(null);
  const [showCC, setShowCC] = useState<boolean>(true);
  const [showTranscriptLog, setShowTranscriptLog] = useState<boolean>(true);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcriptSearch, setTranscriptSearch] = useState<string>('');
  const [togglingTranscription, setTogglingTranscription] = useState<boolean>(false);
  const [isLiveFollow, setIsLiveFollow] = useState<boolean>(true);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const isLiveFollowRef = useRef<boolean>(true);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const captionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Poll stream status every 3 seconds
  const fetchStatus = useCallback(async () => {
    try {
      const status = await api.getStreamStatus(eventId);
      setStreamStatus(status);
      setLoadingStatus(false);
    } catch {
      setLoadingStatus(false);
    }
  }, [eventId]);

  const fetchMarkers = useCallback(async () => {
    try {
      const data = await api.listMarkers(eventId);
      setMarkers(data);
    } catch {}
  }, [eventId]);

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
    fetchStatus();
    fetchMarkers();
    fetchSubtitles();
    fetchTranscriptionStatus();
    const interval = setInterval(() => {
      fetchStatus();
      fetchTranscriptionStatus();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchMarkers, fetchSubtitles, fetchTranscriptionStatus]);

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

        ws.onopen = () => {
          // Connected to live subtitles channel
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'connected') {
              setIsTranscribing(Boolean(data.is_transcribing));
            } else if (data.type === 'subtitle') {
              setActiveCaption(data.text);
              setIsTranscribing(true);
              setSubtitles((prev) => {
                // Top newest, bottom oldest: prepend data to front
                if (prev.some((p) => p.id === data.id)) return prev;
                return [data, ...prev].slice(0, 200);
              });

              // If user is following live, keep view anchored to top (newest)
              if (isLiveFollowRef.current) {
                transcriptContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              } else {
                setUnreadCount((c) => c + 1);
              }

              // Automatically clear caption after 4.5 seconds if speech pauses
              if (captionTimeoutRef.current) {
                clearTimeout(captionTimeoutRef.current);
              }
              captionTimeoutRef.current = setTimeout(() => {
                setActiveCaption(null);
              }, 4500);
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
      } catch {}
    };

    connectWebSocket();

    return () => {
      isDisposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (captionTimeoutRef.current) clearTimeout(captionTimeoutRef.current);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            try { ws?.close(); } catch {}
          };
        }
      }
    };
  }, [eventId]);

  const handleCreateMarker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!markTitle.trim()) return;
    setSavingMark(true);
    try {
      const newMarker = await api.createMarker(eventId, {
        title: markTitle.trim(),
        color: markColor,
      });
      setMarkers((prev) => [...prev, newMarker]);
      setMarkTitle('');
      setShowMarkModal(false);
      setShowMarkerLog(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save moment mark');
    } finally {
      setSavingMark(false);
    }
  };

  const handleDeleteMarker = async (markerId: string) => {
    try {
      await api.deleteMarker(eventId, markerId);
      setMarkers((prev) => prev.filter((m) => m.id !== markerId));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete mark');
    }
  };

  const handleToggleTranscription = async () => {
    setTogglingTranscription(true);
    try {
      const res = await api.toggleTranscription(eventId);
      setIsTranscribing(res.is_active);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to toggle transcription');
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
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to clear subtitles');
    }
  };

  const handleCopyRtmp = () => {
    if (!streamStatus) return;
    navigator.clipboard.writeText(streamStatus.rtmp_url);
    setCopiedRtmp(true);
    setTimeout(() => setCopiedRtmp(false), 2000);
  };

  const isLive = Boolean(streamStatus?.is_live);

  // Active stream iframe URL depending on mode
  const currentStreamUrl = isLive && streamStatus
    ? playerMode === 'webrtc'
      ? `${streamStatus.webrtc_url}/?controls=1&autoplay=1&muted=1`
      : `${streamStatus.hls_url}/?controls=1&autoplay=1&muted=1`
    : null;

  const currentDirectUrl = isLive && streamStatus
    ? playerMode === 'webrtc'
      ? `${streamStatus.webrtc_url}/`
      : `${streamStatus.hls_url}/`
    : null;

  const filteredSubtitles = transcriptSearch.trim()
    ? subtitles.filter((s) => s.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
    : subtitles;

  return (
    <div
      ref={containerRef}
      className="bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col relative group shadow-2xl text-card-foreground"
    >
      {/* Player Header Bar */}
      <div className="px-4 py-3 border-b border-border/60 flex flex-wrap items-center justify-between gap-3 bg-muted/30 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Tv className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">
              Live Program Feed
            </span>
          </div>

          {/* Mode Switcher Pill */}
          {isLive && (
            <div className="flex items-center bg-muted p-0.5 rounded-lg border border-border/50">
              <Button
                size="xs"
                variant={playerMode === 'hls' ? 'default' : 'ghost'}
                onClick={() => setPlayerMode('hls')}
                className="gap-1 text-[11px]"
                title="Buffered HLS with full stereo audio & standard encoder compatibility"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>HLS (Standard)</span>
              </Button>

              <Button
                size="xs"
                variant={playerMode === 'webrtc' ? 'default' : 'ghost'}
                onClick={() => setPlayerMode('webrtc')}
                className="gap-1 text-[11px]"
                title="Ultra-low latency (~200ms). Requires OBS Max B-frames: 0"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>WebRTC (Low Latency)</span>
              </Button>

              {/* WebRTC tips toggle */}
              {playerMode === 'webrtc' && (
                <Button
                  type="button"
                  size="icon-xs"
                  variant={showBFrameHint ? 'default' : 'ghost'}
                  onClick={() => setShowBFrameHint((prev) => !prev)}
                  title="WebRTC encoder & audio tips"
                  className="rounded"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Subtitles / CC Button */}
          <Button
            type="button"
            size="xs"
            variant={showCC ? 'default' : 'outline'}
            onClick={() => setShowCC(!showCC)}
            className="gap-1 text-[11px]"
            title={showCC ? 'Hide Subtitles (CC)' : 'Show Live Subtitles (CC)'}
          >
            <Subtitles className="w-3.5 h-3.5" />
            <span>CC</span>
            {isTranscribing && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </Button>

          {/* Transcript Feed Drawer Toggle */}
          <Button
            type="button"
            size="xs"
            variant={showTranscriptLog ? 'default' : 'outline'}
            onClick={() => {
              setShowTranscriptLog(!showTranscriptLog);
              if (!showTranscriptLog) setShowMarkerLog(false);
            }}
            className="gap-1.5 text-xs"
            title="Open Live Transcript & Closed Captions feed"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Transcript</span>
            {subtitles.length > 0 && (
              <span className="text-[10px] px-1.5 bg-primary-foreground/20 rounded font-mono font-bold">
                {subtitles.length}
              </span>
            )}
          </Button>

          {/* Mark Live Moment Button */}
          {isLive && (
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setShowMarkModal(true)}
              className="gap-1.5 text-[11px]"
              title="Add a chapter / moment mark at current live time"
            >
              <Flag className="w-3.5 h-3.5 text-primary" />
              <span>Mark Moment</span>
            </Button>
          )}

          {/* Toggle Live Marker Log Button */}
          {markers.length > 0 && (
            <Button
              size="xs"
              variant={showMarkerLog ? 'default' : 'outline'}
              onClick={() => {
                setShowMarkerLog((prev) => !prev);
                if (!showMarkerLog) setShowTranscriptLog(false);
              }}
              className="gap-1 text-[11px]"
              title="View live marks & cues"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Marks ({markers.length})</span>
            </Button>
          )}

          {/* Live / Offline Status Badge */}
          {isLive ? (
            <Badge variant="destructive" className="gap-1.5 font-mono text-[10px] uppercase font-bold tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse-live" />
              <span>LIVE • REC</span>
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-muted-foreground font-mono text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
              <span>OFF AIR</span>
            </Badge>
          )}

          {/* Direct Stream Link in New Window */}
          {currentDirectUrl && (
            <Button
              asChild
              variant="ghost"
              size="icon-xs"
              title="Open stream in clean standalone tab"
            >
              <a href={currentDirectUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          )}

          {/* Refresh stream button */}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={fetchStatus}
            disabled={loadingStatus}
            title="Refresh stream status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* WebRTC Tips / Notice Banner */}
      {isLive && playerMode === 'webrtc' && showBFrameHint && (
        <div className="px-4 py-2 bg-amber-950/40 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span className="text-[11px]">
              {streamStatus?.tracks.some((t: string) => t.toLowerCase().includes('mpeg') || t.toLowerCase().includes('aac')) ? (
                <>
                  <strong>No audio in WebRTC?</strong> RTMP uses AAC audio, which browsers cannot decode over WebRTC (only Opus is supported). Switch to <strong>HLS</strong> for audio or stream via <strong>WHIP</strong>.
                </>
              ) : (
                <>
                  WebRTC requires <strong>Max B-frames: 0</strong> in OBS. If video is paused or blank, switch to <strong>HLS</strong> mode above.
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setPlayerMode('hls');
                setShowBFrameHint(false);
              }}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-black font-bold text-[10px] rounded transition-colors"
            >
              Switch to HLS (Audio Enabled)
            </button>
            <button
              onClick={() => setShowBFrameHint(false)}
              className="p-1 text-amber-400/80 hover:text-amber-200 rounded transition-colors"
              title="Hide warning"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Video Viewport Container */}
      <div className="aspect-video bg-black relative flex items-center justify-center overflow-hidden">
        {/* Active Stream Iframe */}
        {isLive && currentStreamUrl ? (
          <iframe
            key={`${playerMode}-${currentStreamUrl}`}
            src={currentStreamUrl}
            title="StageControl Program Feed"
            className="w-full h-full border-0 bg-black absolute inset-0"
            allow="autoplay; fullscreen; picture-in-picture"
          />
        ) : null}

        {/* Closed Captions Live Overlay Pill */}
        {showCC && activeCaption && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 max-w-[90%] md:max-w-[80%] pointer-events-none transition-all duration-200 animate-in fade-in slide-in-from-bottom-2">
            <div className="bg-black/90 backdrop-blur-md border border-purple-500/40 text-white px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2.5 text-center">
              <span className={`w-2 h-2 rounded-full shrink-0 ${activeCaption.includes('♪') ? 'bg-indigo-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
              <span className={`text-xs sm:text-sm md:text-base font-semibold tracking-wide drop-shadow-md select-none ${activeCaption.includes('♪') ? 'text-indigo-200 italic' : 'text-slate-100'}`}>
                {activeCaption}
              </span>
            </div>
          </div>
        )}

        {/* Off Air / Waiting for OBS Overlay */}
        {!isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#0a0d14] to-[#040608]">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-3xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Radio className="w-8 h-8 animate-pulse text-blue-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-slate-600 rounded-full border-2 border-[#090b10]" />
            </div>

            <h3 className="text-base font-bold text-slate-100">Waiting for OBS Live Broadcast</h3>
            <p className="text-xs text-slate-400 max-w-md mt-1 mb-6">
              Connect OBS Studio or any RTMP software to start streaming. The server will automatically start broadcasting live playback, fMP4 recording, and Malaysian Whisper speech transcription.
            </p>

            {isSMOrAdmin ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={onOpenStreamSetup}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors shadow-lg shadow-blue-600/20 flex items-center gap-2"
                >
                  <Tv className="w-4 h-4" />
                  <span>View OBS Setup & Stream Key</span>
                </button>
                {streamStatus?.rtmp_url && (
                  <button
                    onClick={handleCopyRtmp}
                    className="px-3 py-2 text-xs font-medium bg-[#1a2030] hover:bg-[#222b40] text-slate-300 rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    {copiedRtmp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedRtmp ? 'Copied RTMP URL' : 'Copy RTMP URL'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-lg bg-[#11141f] border border-[#1e2638] text-[11px] text-slate-400">
                Stage manager or stream operator has not started broadcast yet.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info Bar */}
      {isLive && streamStatus && (
        <div className="px-4 py-2 bg-[#0e111a] border-t border-[#1e2638] flex flex-wrap items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-mono text-emerald-400">
              {playerMode === 'webrtc' ? 'Ultra-Low Latency (~200ms)' : 'Buffered HLS (Stereo Audio)'}
            </span>
            {streamStatus.tracks.length > 0 && (
              <span className="text-slate-500">
                Codecs: <strong className="text-slate-300">{streamStatus.tracks.join(' + ')}</strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-purple-300">
              <Sparkles className="w-3 h-3 text-purple-400" />
              <span>AI Subtitles:</span>
              <strong className={isTranscribing ? 'text-emerald-400' : 'text-slate-400'}>
                {isTranscribing ? 'Active' : 'Idle'}
              </strong>
            </span>
            <span>
              Bytes Ingested: <strong className="font-mono text-slate-300">{(streamStatus.bytes_received / (1024 * 1024)).toFixed(1)} MB</strong>
            </span>
          </div>
        </div>
      )}

      {/* Live Transcript & Closed Captions Drawer */}
      {showTranscriptLog && (
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
          className="bg-[#0b0e17] border-t border-[#1e2638] p-4 max-h-72 overflow-y-auto relative"
        >
          {/* Floating Go to Now button when user scrolled away */}
          {!isLiveFollow && (
            <div className="sticky top-0 z-30 flex justify-center pb-2 pointer-events-none">
              <button
                type="button"
                onClick={() => {
                  setIsLiveFollow(true);
                  isLiveFollowRef.current = true;
                  setUnreadCount(0);
                  transcriptContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-full shadow-xl shadow-purple-950/80 text-[11px] font-bold border border-purple-400/40 transition-all hover:scale-105 animate-in fade-in slide-in-from-top-1"
              >
                <ArrowDown className="w-3 h-3 text-white animate-bounce" />
                <span>Go to Now</span>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.2 bg-white/20 text-white rounded-full font-mono text-[10px]">
                    +{unreadCount}
                  </span>
                )}
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                Live Transcript ({subtitles.length})
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" />
                <span>Mesolitica Malaysian Whisper</span>
              </span>
              {isTranscribing ? (
                <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded font-semibold flex items-center gap-1 animate-pulse">
                  <Mic className="w-2.5 h-2.5" />
                  <span>LISTENING</span>
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
                  IDLE
                </span>
              )}

              {/* Auto-Follow Live Mode Indicator / Toggle */}
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
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 ${
                  isLiveFollow
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                }`}
                title={isLiveFollow ? 'Auto-following live speech. Click to browse history.' : 'Auto-follow paused. Click to jump to live speech.'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isLiveFollow ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span>{isLiveFollow ? 'Live Follow: ON' : 'Paused (Scrolled)'}</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Search input */}
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  placeholder="Search spoken lines..."
                  className="pl-6 pr-2 py-1 text-[11px] bg-[#111624] border border-[#1e2638] rounded-md text-slate-200 outline-none w-36 focus:w-48 transition-all"
                />
              </div>

              {/* SM / Admin controls */}
              {isSMOrAdmin && (
                <>
                  <button
                    onClick={handleToggleTranscription}
                    disabled={togglingTranscription}
                    className="text-[10px] px-2 py-1 rounded bg-[#161c2c] hover:bg-[#202940] text-purple-300 border border-[#232d44] transition-colors"
                  >
                    {isTranscribing ? 'Pause AI' : 'Start AI'}
                  </button>
                  {subtitles.length > 0 && (
                    <button
                      onClick={handleClearSubtitles}
                      className="text-[10px] px-1.5 py-1 text-slate-500 hover:text-red-400 rounded transition-colors"
                      title="Clear transcript"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </>
              )}

              <button
                onClick={() => setShowTranscriptLog(false)}
                className="text-slate-500 hover:text-slate-300 text-xs p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {subtitles.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">
              No spoken lines transcribed yet. Audio from the live OBS broadcast is processed on the server using Malaysian Whisper.
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredSubtitles.map((sub, idx) => (
                <div
                  key={sub.id || idx}
                  className="flex items-start gap-2.5 p-2 rounded-lg bg-[#111624] border border-[#1b2337] text-xs hover:border-[#283552] transition-colors"
                >
                  <div className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-purple-400 bg-[#171c2c] px-1.5 py-0.5 rounded border border-[#20283c]">
                    <Clock className="w-2.5 h-2.5" />
                    <span>
                      {sub.start_seconds !== null && sub.start_seconds !== undefined
                        ? `${Math.floor(sub.start_seconds / 60)}:${String(Math.floor(sub.start_seconds % 60)).padStart(2, '0')}`
                        : new Date(sub.created_at).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-200 font-medium leading-relaxed">{sub.text}</p>
                  </div>
                  <span className="text-[9px] uppercase font-mono px-1 py-0.2 bg-[#1b2234] text-slate-400 rounded shrink-0">
                    {sub.language || 'ms'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live Markers & Cues Drawer */}
      {showMarkerLog && markers.length > 0 && (
        <div className="bg-[#0b0e17] border-t border-[#1e2638] p-3 max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
              <Bookmark className="w-3 h-3 text-purple-400" />
              <span>Live Show Cue & Moment Marks ({markers.length})</span>
            </span>
            <button
              onClick={() => setShowMarkerLog(false)}
              className="text-slate-500 hover:text-slate-300 text-xs p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {markers.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-[#111624] border border-[#1b2337] text-xs hover:border-[#283552] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      m.color === 'emerald'
                        ? 'bg-emerald-400'
                        : m.color === 'amber'
                        ? 'bg-amber-400'
                        : m.color === 'rose'
                        ? 'bg-rose-400'
                        : m.color === 'blue'
                        ? 'bg-blue-400'
                        : 'bg-purple-400'
                    }`}
                  />
                  <span className="font-semibold text-slate-200 break-words">{m.title}</span>
                  {m.creator_callsign && (
                    <span className="text-[10px] text-slate-500 bg-[#161d2e] px-1.5 py-0.2 rounded border border-[#232f48]">
                      {m.creator_callsign}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono text-slate-400">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {isSMOrAdmin && (
                    <button
                      onClick={() => handleDeleteMarker(m.id)}
                      className="text-slate-500 hover:text-red-400 p-0.5 rounded transition-colors"
                      title="Delete mark"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mark Moment Dialog using shadcn/ui */}
      <Dialog open={showMarkModal} onOpenChange={setShowMarkModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-primary" />
              <span>Mark Live Moment</span>
            </DialogTitle>
            <DialogDescription>
              Drop a timestamped cue mark into the live production log.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateMarker} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                Moment Label / Cue Note *
              </label>
              <Input
                type="text"
                value={markTitle}
                onChange={(e) => setMarkTitle(e.target.value)}
                placeholder="e.g. Act 1 Starts, Mic 2 Issue, Solo"
                autoFocus
                required
              />
            </div>

            {/* Quick Preset Buttons */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Quick Presets</label>
              <div className="flex flex-wrap gap-1.5">
                {['Act 1 Begins', 'Act 2 Begins', 'Intermission', 'Key Cue', 'Issue / Glitch', 'Finale'].map((preset) => (
                  <Button
                    type="button"
                    key={preset}
                    size="xs"
                    variant="outline"
                    onClick={() => setMarkTitle(preset)}
                    className="text-[10px]"
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            </div>

            {/* Color selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Marker Color</label>
              <div className="flex items-center gap-2">
                {[
                  { id: 'purple', bg: 'bg-purple-500' },
                  { id: 'blue', bg: 'bg-blue-500' },
                  { id: 'emerald', bg: 'bg-emerald-500' },
                  { id: 'amber', bg: 'bg-amber-500' },
                  { id: 'rose', bg: 'bg-rose-500' },
                ].map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setMarkColor(c.id)}
                    className={`w-6 h-6 rounded-full ${c.bg} transition-transform ${
                      markColor === c.id ? 'ring-2 ring-foreground scale-110' : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowMarkModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingMark || !markTitle.trim()}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{savingMark ? 'Saving...' : 'Drop Mark'}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
