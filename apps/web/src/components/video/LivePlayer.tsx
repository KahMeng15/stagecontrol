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
  FileText,
  Sparkles,
  Mic,
  Search,
  ArrowDown,
  Music,
  Volume2,
  VolumeX,
  Play,
  Pause,
} from 'lucide-react';
import Hls from 'hls.js';
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
  isSpeaker?: boolean;
  isListener?: boolean;
  isPlayingCall?: boolean;
}

export function LivePlayer({
  eventId,
  isSMOrAdmin = false,
  onOpenStreamSetup,
  isSpeaker = false,
  isListener = false,
  isPlayingCall = false,
}: LivePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  // Default to HLS because standard OBS encoders output H.264 High Profile with B-frames and AAC audio
  const [playerMode, setPlayerMode] = useState<'hls' | 'webrtc'>('hls');
  const [reloadKey, setReloadKey] = useState(0);
  const [showBandwidthGuide, setShowBandwidthGuide] = useState(false);
  const [copiedRtmp, setCopiedRtmp] = useState(false);
  const [showBFrameHint, setShowBFrameHint] = useState(false);
  // User initiated live monitoring playback (prevents auto-play buffering & saves bandwidth)
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);

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
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null);
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
  const lastReadyTimeRef = useRef<string | null>(null);

  // Poll stream status every 3 seconds
  const fetchStatus = useCallback(async () => {
    try {
      const status = await api.getStreamStatus(eventId);
      setStreamStatus(status);
      setLoadingStatus(false);
      if (status.ready_time && lastReadyTimeRef.current && status.ready_time !== lastReadyTimeRef.current) {
        // Stream session restarted/reconnected in MediaMTX: reload iframe to avoid stale HLS 404s
        setReloadKey((k) => k + 1);
      }
      if (status.ready_time) {
        lastReadyTimeRef.current = status.ready_time;
      }
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
              setActiveSubtitleId(data.id || data.text);
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

              // Automatically clear active highlight after 5 seconds if speech pauses
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
      setActiveSubtitleId(null);
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

  // HLS stream URL (direct m3u8) for native <video> element
  const hlsManifestUrl = isLive && streamStatus?.hls_url
    ? `${streamStatus.hls_url.replace(/\/$/, '')}/index.m3u8`
    : null;

  // Active stream iframe URL depending on mode (only loaded if user started monitoring)
  const currentStreamUrl = isLive && streamStatus && hasStartedPlayback
    ? playerMode === 'webrtc'
      ? `${streamStatus.webrtc_url}/?controls=1&autoplay=1&muted=1`
      : `${streamStatus.hls_url}/?controls=1&autoplay=1&muted=1`
    : null;

  // Native HLS playback setup with hls.js (only initializes and buffers when user has clicked to play)
  useEffect(() => {
    if (playerMode !== 'hls' || !isLive || !hlsManifestUrl || !videoRef.current || !hasStartedPlayback) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const video = videoRef.current;

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(hlsManifestUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsManifestUrl;
      video.play().catch(() => {});
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playerMode, isLive, hlsManifestUrl, reloadKey, hasStartedPlayback]);

  // Audio ducking & muting for Live Player
  const originalAudioRef = useRef<{ volume: number; muted: boolean } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const shouldDuck = isListener || isPlayingCall;

    if (isSpeaker) {
      // SPEAKER: Mute completely to prevent microphone feedback
      if (!originalAudioRef.current) {
        originalAudioRef.current = { volume: video.volume, muted: video.muted };
      }
      video.muted = true;
    } else if (shouldDuck) {
      // LISTENER or CALL PLAYBACK: Duck volume down by 50%
      if (!originalAudioRef.current) {
        originalAudioRef.current = { volume: video.volume, muted: video.muted };
      }
      const orig = originalAudioRef.current;
      if (!orig.muted) {
        video.muted = false;
        video.volume = Math.max(0, Math.min(1, orig.volume * 0.5));
      }
    } else {
      // NORMAL: Restore original volume & muted state
      if (originalAudioRef.current) {
        video.muted = originalAudioRef.current.muted;
        video.volume = originalAudioRef.current.volume;
        originalAudioRef.current = null;
      }
    }
  }, [isSpeaker, isListener, isPlayingCall]);

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
          {/* 4G / Low Bandwidth OBS Guide Button */}
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => setShowBandwidthGuide(true)}
            className="gap-1.5 text-[11px] text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
            title="Recommended 500kbps 720p settings to prevent 4G lag"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">4G Preset (500kbps)</span>
          </Button>

          {/* Quick Reload Stream (re-syncs 4G drops) */}
          {isLive && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => {
                setReloadKey((prev) => prev + 1);
                toast.success('Reloading live stream feed...');
              }}
              title="Reload live stream feed (re-syncs video after network drop)"
              className="rounded"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          )}

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
            <Badge variant="destructive" className="font-mono text-[10px] uppercase font-bold tracking-wider">
              <span>LIVE • REC</span>
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground font-mono text-[10px]">
              <span>OFF AIR</span>
            </Badge>
          )}

          {/* Audio Ducking / Muting Indicators for Walkie-Talkie */}
          {isSpeaker && (
            <Badge variant="destructive" className="font-mono text-[10px] uppercase font-bold tracking-wider animate-pulse flex items-center gap-1 bg-red-600">
              <VolumeX className="w-3 h-3" />
              <span>MUTED</span>
            </Badge>
          )}
          {isListener && (
            <Badge variant="secondary" className="font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <Volume2 className="w-3 h-3 text-amber-400" />
              <span>DUCKED 50%</span>
            </Badge>
          )}
          {!isSpeaker && !isListener && isPlayingCall && (
            <Badge variant="secondary" className="font-mono text-[10px] uppercase font-bold tracking-wider flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <Volume2 className="w-3 h-3 text-amber-400" />
              <span>DUCKED 50%</span>
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

          {/* Quick Play / Pause Monitor Button to Save Bandwidth */}
          {isLive && (
            <Button
              type="button"
              size="xs"
              variant={hasStartedPlayback ? 'outline' : 'default'}
              onClick={() => setHasStartedPlayback((prev) => !prev)}
              className="gap-1.5 text-[11px]"
              title={hasStartedPlayback ? 'Pause live stream feed to save bandwidth' : 'Start watching live stream feed'}
            >
              {hasStartedPlayback ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Pause Feed</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span className="hidden sm:inline">Watch Live</span>
                </>
              )}
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
        {/* Active Stream: Native HLS Video or WebRTC Iframe (only when user clicked to play) */}
        {isLive && hasStartedPlayback ? (
          playerMode === 'hls' ? (
            <video
              ref={videoRef}
              key={`hls-${streamStatus?.ready_time || 'initial'}-${reloadKey}`}
              controls
              playsInline
              autoPlay
              muted
              className="w-full h-full object-contain bg-black absolute inset-0"
            />
          ) : currentStreamUrl ? (
            <iframe
              ref={iframeRef}
              key={`webrtc-${streamStatus?.ready_time || 'initial'}-${reloadKey}`}
              src={currentStreamUrl}
              title="StageControl Program Feed"
              className="w-full h-full border-0 bg-black absolute inset-0"
              allow="autoplay; fullscreen; picture-in-picture"
            />
          ) : null
        ) : null}

        {/* Live Broadcast Available - Idle to Save Bandwidth Overlay */}
        {isLive && !hasStartedPlayback && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-card/95 backdrop-blur-sm z-20">
            <h3 className="text-sm font-bold text-foreground">Live Program Stream Ready</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4 leading-relaxed">
              Auto-play is paused to save network bandwidth.
            </p>

            <Button
              type="button"
              onClick={() => setHasStartedPlayback(true)}
              className="font-semibold shadow-md text-xs h-8 px-5 rounded-full"
            >
              Watch Live Stream
            </Button>
          </div>
        )}

        {/* Off Air / Waiting for OBS Overlay */}
        {!isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-card/95 backdrop-blur-sm">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Radio className="w-8 h-8 text-primary" />
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-muted-foreground/60 rounded-full border-2 border-background" />
            </div>

            <h3 className="text-base font-bold text-foreground">Waiting for OBS Live Broadcast</h3>
            <p className="text-xs text-muted-foreground max-w-md mt-1 mb-6 leading-relaxed">
              Connect OBS Studio or any RTMP software to start streaming. The server will automatically start broadcasting live playback, fMP4 recording, and Malaysian Whisper speech transcription.
            </p>

            {isSMOrAdmin ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  onClick={onOpenStreamSetup}
                  className="gap-2 shadow-sm text-xs font-semibold"
                >
                  <Tv className="w-4 h-4" />
                  <span>View OBS Setup & Stream Key</span>
                </Button>
                {streamStatus?.rtmp_url && (
                  <Button
                    variant="outline"
                    onClick={handleCopyRtmp}
                    className="gap-1.5 text-xs font-medium"
                  >
                    {copiedRtmp ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedRtmp ? 'Copied RTMP URL' : 'Copy RTMP URL'}</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-lg bg-muted border border-border text-xs text-muted-foreground">
                Stage manager or stream operator has not started broadcast yet.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info Bar */}
      {isLive && streamStatus && (
        <div className="px-4 py-2 bg-muted/40 border-t border-border/60 flex flex-wrap items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono text-emerald-500 bg-emerald-500/10 border-emerald-500/20 text-[10px]">
              {playerMode === 'webrtc' ? 'Ultra-Low Latency (~200ms)' : 'Buffered HLS (Stereo Audio)'}
            </Badge>
            {streamStatus.tracks.length > 0 && (
              <span>
                Codecs: <strong className="text-foreground">{streamStatus.tracks.join(' + ')}</strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-foreground">
              <Sparkles className="w-3 h-3 text-primary" />
              <span>AI Subtitles:</span>
              <Badge variant={isTranscribing ? "secondary" : "outline"} className={`text-[10px] ${isTranscribing ? 'text-emerald-500 font-bold' : 'text-muted-foreground'}`}>
                {isTranscribing ? 'Active' : 'Idle'}
              </Badge>
            </span>
            <span>
              Bytes Ingested: <strong className="font-mono text-foreground">{(streamStatus.bytes_received / (1024 * 1024)).toFixed(1)} MB</strong>
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
          className="bg-card border-t border-border/60 p-4 max-h-72 overflow-y-auto relative"
        >
          {/* Floating Go to Now button when user scrolled away */}
          {!isLiveFollow && (
            <div className="sticky top-0 z-30 flex justify-center pb-2 pointer-events-none">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setIsLiveFollow(true);
                  isLiveFollowRef.current = true;
                  setUnreadCount(0);
                  transcriptContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="pointer-events-auto h-7 px-3 rounded-full text-[11px] font-semibold gap-1.5 shadow-lg shadow-primary/20 animate-in fade-in slide-in-from-top-1"
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

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                Live Transcript ({subtitles.length})
              </span>
              <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
                <Sparkles className="w-3 h-3 text-primary" />
                <span>Mesolitica Malaysian Whisper</span>
              </Badge>
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

              {/* Auto-Follow Live Mode Indicator / Toggle */}
              <Button
                type="button"
                variant={isLiveFollow ? "outline" : "secondary"}
                size="sm"
                onClick={() => {
                  const next = !isLiveFollow;
                  setIsLiveFollow(next);
                  isLiveFollowRef.current = next;
                  if (next) {
                    setUnreadCount(0);
                    transcriptContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                className="h-6 text-[10px] px-2.5 rounded-full gap-1.5 font-medium"
                title={isLiveFollow ? 'Auto-following live speech. Click to browse history.' : 'Auto-follow paused. Click to jump to live speech.'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isLiveFollow ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span>{isLiveFollow ? 'Live Follow: ON' : 'Paused (Scrolled)'}</span>
              </Button>
            </div>

            <div className="flex items-center gap-2">
              {/* Search input */}
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  placeholder="Search spoken lines..."
                  className="pl-6 pr-2 h-7 text-[11px] w-36 focus:w-48 transition-all"
                />
              </div>

              {/* SM / Admin controls */}
              {isSMOrAdmin && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleTranscription}
                    disabled={togglingTranscription}
                    className="h-7 text-[11px] px-2.5"
                  >
                    {isTranscribing ? 'Pause AI' : 'Start AI'}
                  </Button>
                  {subtitles.length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleClearSubtitles}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Clear transcript"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </>
              )}

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowTranscriptLog(false)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {subtitles.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl bg-muted/10">
              No spoken lines transcribed yet. Audio from the live OBS broadcast is processed on the server using Malaysian Whisper.
            </div>
          ) : (
            <div className="divide-y divide-border/40 border border-border/60 rounded-xl overflow-hidden bg-card">
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
                    className={`group px-3 py-1.5 transition-colors flex items-center justify-between gap-3 text-xs ${
                      isActive
                        ? 'bg-primary/10 border-l-4 border-l-primary shadow-sm'
                        : 'border-l-4 border-l-transparent hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className={`shrink-0 flex items-center gap-1 font-mono text-[11px] select-none ${
                        isActive ? 'text-primary font-semibold' : 'text-muted-foreground'
                      }`}>
                        <Clock className="w-3 h-3 text-muted-foreground/70" />
                        <span>{localTime}</span>
                      </span>
                      <p className={`leading-normal flex-1 break-words transition-colors flex items-center gap-1.5 ${
                        isActive ? 'text-primary font-semibold' : 'text-foreground font-medium'
                      }`}>
                        {sub.is_music && (
                          <Music className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                        )}
                        <span>{sub.text}</span>
                      </p>
                      {isActive && (
                        <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 font-mono font-bold shrink-0">
                          LIVE
                        </Badge>
                      )}
                    </div>

                    <Badge variant="outline" className="text-[9px] uppercase font-mono px-1.5 py-0 text-muted-foreground shrink-0">
                      {sub.language || 'ms'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Live Markers & Cues Drawer */}
      {showMarkerLog && markers.length > 0 && (
        <div className="bg-card border-t border-border/60 p-3 max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
              <Bookmark className="w-3 h-3 text-primary" />
              <span>Live Show Cue & Moment Marks ({markers.length})</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowMarkerLog(false)}
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="divide-y divide-border/40 border border-border/60 rounded-xl overflow-hidden bg-card">
            {markers.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-muted/40 text-xs transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      m.color === 'emerald'
                        ? 'bg-emerald-500'
                        : m.color === 'amber'
                        ? 'bg-amber-500'
                        : m.color === 'rose'
                        ? 'bg-rose-500'
                        : m.color === 'blue'
                        ? 'bg-blue-500'
                        : 'bg-primary'
                    }`}
                  />
                  <span className="font-semibold text-foreground break-words">{m.title}</span>
                  {m.creator_callsign && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground px-1 py-0">
                      {m.creator_callsign}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  {isSMOrAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteMarker(m.id)}
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      title="Delete mark"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
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

      {/* 4G / Low Bandwidth Optimization Modal */}
      <Dialog open={showBandwidthGuide} onOpenChange={setShowBandwidthGuide}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">4G Multi-Viewer Stream Optimization</DialogTitle>
                <DialogDescription className="text-xs">
                  Max 500kbps 720p profile to prevent mobile buffering and lag.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="p-3 rounded-lg bg-muted/40 border border-border/60 text-muted-foreground leading-relaxed text-[11px]">
              OBS defaults to <strong className="text-foreground">6,000 kbps (1080p)</strong>. When multiple viewers watch on 4G/LTE mobile networks, every viewer pulls 6 Mbps. 4G networks quickly drop frames and buffer.
              Applying this <strong className="text-primary">720p @ 500kbps preset</strong> reduces server outbound bandwidth by 90% so all viewers stream smoothly.
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-muted/20 p-3 rounded-xl border border-border/50">
              <div>
                <span className="text-muted-foreground text-[10px] block">OUTPUT RESOLUTION</span>
                <span className="font-bold text-foreground">1280x720 (720p)</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] block">VIDEO BITRATE</span>
                <span className="font-bold text-emerald-400">500 kbps (CBR)</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] block">AUDIO BITRATE</span>
                <span className="font-bold text-foreground">64 kbps (AAC)</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] block">KEYFRAME INTERVAL</span>
                <span className="font-bold text-foreground">2 seconds</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] block">MAX B-FRAMES</span>
                <span className="font-bold text-foreground">0 (Zero Latency)</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] block">EST. BANDWIDTH / VIEWER</span>
                <span className="font-bold text-emerald-400">~0.56 Mbps</span>
              </div>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const obsConfig = `OBS Studio 4G Low-Bandwidth Preset:
• Base Canvas: 1920x1080 -> Output Resolution: 1280x720 (720p)
• Rate Control: CBR
• Video Bitrate: 500 Kbps (Max 800 Kbps)
• Keyframe Interval: 2s
• CPU Usage: veryfast
• Profile: Main
• Tune: zerolatency
• Max B-frames: 0
• Audio Bitrate: 64 Kbps AAC`;
                navigator.clipboard.writeText(obsConfig);
                toast.success('OBS 500kbps 720p preset copied to clipboard');
              }}
              className="gap-1.5 text-xs"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy OBS Preset</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowBandwidthGuide(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
