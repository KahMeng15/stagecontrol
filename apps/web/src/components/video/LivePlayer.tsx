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
import { copyToClipboard, cn } from '@/lib/utils';

interface LivePlayerProps {
  eventId: string;
  streamKey?: string | null;
  isSMOrAdmin?: boolean;
  onOpenStreamSetup?: () => void;
  isSpeaker?: boolean;
  isListener?: boolean;
  isPlayingCall?: boolean;
  className?: string;
}

export function LivePlayer({
  eventId,
  isSMOrAdmin = false,
  onOpenStreamSetup,
  isSpeaker = false,
  isListener = false,
  isPlayingCall = false,
  className,
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
  const [copiedRtmp, setCopiedRtmp] = useState(false);
  const [showBFrameHint, setShowBFrameHint] = useState(false);
  // User initiated live monitoring playback (prevents auto-play buffering & saves bandwidth)
  const [hasStartedPlayback, setHasStartedPlayback] = useState(false);
  // Stream Quality: 'auto' (720p on mobile, 1080p on desktop), 'low' (720p @ 800k), 'source' (1080p Master)
  const [streamQuality, setStreamQuality] = useState<'auto' | 'low' | 'source'>('auto');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
      if (mobile) {
        setStreamQuality('low');
      }
    }
  }, []);

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
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const captionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastReadyTimeRef = useRef<string | null>(null);
  const [incomingBitrateKbps, setIncomingBitrateKbps] = useState<number | null>(null);
  const lastBytesRef = useRef<{ bytes: number; timestamp: number } | null>(null);

  // Poll stream status every 3 seconds
  const fetchStatus = useCallback(async () => {
    try {
      const status = await api.getStreamStatus(eventId);
      setStreamStatus(status);
      setLoadingStatus(false);

      if (status.bytes_received && status.is_live) {
        const now = Date.now();
        if (lastBytesRef.current && lastBytesRef.current.bytes > 0 && status.bytes_received >= lastBytesRef.current.bytes) {
          const deltaBytes = status.bytes_received - lastBytesRef.current.bytes;
          const deltaSeconds = (now - lastBytesRef.current.timestamp) / 1000;
          if (deltaSeconds >= 2) {
            const kbps = Math.round((deltaBytes * 8) / (deltaSeconds * 1000));
            setIncomingBitrateKbps(kbps);
            lastBytesRef.current = { bytes: status.bytes_received, timestamp: now };
          }
        } else {
          lastBytesRef.current = { bytes: status.bytes_received, timestamp: now };
        }
      } else if (!status.is_live) {
        lastBytesRef.current = null;
        setIncomingBitrateKbps(null);
      }

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

  const handleCopyRtmp = () => {
    if (!streamStatus) return;
    copyToClipboard(streamStatus.rtmp_url);
    setCopiedRtmp(true);
    setTimeout(() => setCopiedRtmp(false), 2000);
  };

  const isLive = Boolean(streamStatus?.is_live);
  const effectiveQuality = streamQuality === 'auto' ? (isMobile ? 'low' : 'source') : streamQuality;

  // HLS stream URL (direct m3u8) for native <video> element
  const hlsManifestUrl = isLive && streamStatus
    ? effectiveQuality === 'low' && streamStatus.hls_low_playlist_url
      ? streamStatus.hls_low_playlist_url
      : effectiveQuality === 'low' && streamStatus.hls_low_url
        ? `${streamStatus.hls_low_url.replace(/\/$/, '')}/index.m3u8`
        : streamStatus.hls_playlist_url || `${streamStatus.hls_url.replace(/\/$/, '')}/index.m3u8`
    : null;

  // Active stream iframe URL depending on mode (only loaded if user started monitoring)
  const currentStreamUrl = isLive && streamStatus && hasStartedPlayback
    ? playerMode === 'webrtc'
      ? effectiveQuality === 'low' && streamStatus.webrtc_low_url
        ? `${streamStatus.webrtc_low_url.replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
        : `${(streamStatus.webrtc_url || '').replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
      : effectiveQuality === 'low' && streamStatus.hls_low_url
        ? `${streamStatus.hls_low_url.replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
        : `${(streamStatus.hls_url || '').replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
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
        lowLatencyMode: false,
        backBufferLength: 30,
        liveSyncDurationCount: 4,         // Stay 4 segments (~8s) behind live edge for stability
        liveMaxLatencyDurationCount: 10,  // Allow up to 20s drift before forcing a seek
        maxBufferLength: 20,              // Keep up to 20s of video forward-buffered
        maxMaxBufferLength: 40,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
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
  }, [playerMode, isLive, hlsManifestUrl, reloadKey, hasStartedPlayback, streamQuality]);

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

  return (
    <div
      ref={containerRef}
      className={cn(
        "bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col relative group shadow-2xl text-card-foreground",
        className
      )}
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

          {/* Live Quality Selector Pill */}
          {isLive && (
            <div className="flex items-center bg-muted p-0.5 rounded-lg border border-border/50 text-xs">
              <Button
                size="xs"
                variant={effectiveQuality === 'low' ? 'default' : 'ghost'}
                onClick={() => setStreamQuality('low')}
                className="gap-1 text-[11px]"
                title="720p @ 800kbps: Saves 85% bandwidth for 4G, remote, and mobile devices"
              >
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>720p (Low)</span>
              </Button>
              <Button
                size="xs"
                variant={effectiveQuality === 'source' ? 'default' : 'ghost'}
                onClick={() => setStreamQuality('source')}
                className="gap-1 text-[11px]"
                title="1080p Master Source: Full bitrate feed for fiber/LAN"
              >
                <Tv className="w-3 h-3 text-primary" />
                <span>1080p (Source)</span>
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
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

      {/* High Bitrate Advisory Banner (>3,500 kbps) */}
      {isLive && incomingBitrateKbps !== null && incomingBitrateKbps > 3500 && (
        <div className="px-4 py-2 bg-amber-950/60 border-b border-amber-500/40 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span className="text-[11px]">
              High Bitrate Stream (<strong>{(incomingBitrateKbps / 1000).toFixed(1)} Mbps</strong>) — Remote and mobile viewers may experience buffering. Consider switching OBS to the 720p preset or switching this player to <strong>720p (Low)</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {effectiveQuality === 'source' && (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setStreamQuality('low')}
                className="text-[10px] h-6 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 font-semibold"
              >
                Switch Player to 720p
              </Button>
            )}
            {onOpenStreamSetup && (
              <Button
                size="xs"
                variant="outline"
                onClick={onOpenStreamSetup}
                className="text-[10px] h-6 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              >
                OBS Settings
              </Button>
            )}
          </div>
        </div>
      )}

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
      <div className="aspect-video bg-black relative flex items-center justify-center overflow-hidden flex-1">
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
              key={`webrtc-${effectiveQuality}-${streamStatus?.ready_time || 'initial'}-${reloadKey}`}
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
    </div>
  );
}
