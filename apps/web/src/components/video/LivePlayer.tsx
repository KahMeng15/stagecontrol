'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Tv,
  Radio,
  ExternalLink,
  Flag,
  Bookmark,
  Plus,
  Trash2,
  X,
  Volume2,
  VolumeX,
  Settings,
  Copy,
  Check,
} from 'lucide-react';
import Hls from 'hls.js';
import { api, StreamStatus, VideoMarker } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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

  // Playback mode: Standard (HLS) or Low Latency (WebRTC) - persisted in localStorage
  const [playerMode, setPlayerMode] = useState<'hls' | 'webrtc'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('stagecontrol_video_mode');
        if (saved === 'hls' || saved === 'webrtc') return saved;
      } catch {}
    }
    return 'hls';
  });

  // Resolution: 1080p or 720p - persisted in localStorage (defaults to 720p on mobile devices)
  const [resolution, setResolution] = useState<'1080p' | '720p'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('stagecontrol_video_resolution');
        if (saved === '1080p' || saved === '720p') return saved;
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobileDevice) return '720p';
      } catch {}
    }
    return '1080p';
  });

  // Persist video settings across page refreshes
  useEffect(() => {
    try {
      localStorage.setItem('stagecontrol_video_mode', playerMode);
    } catch {}
  }, [playerMode]);

  useEffect(() => {
    try {
      localStorage.setItem('stagecontrol_video_resolution', resolution);
    } catch {}
  }, [resolution]);

  const [reloadKey, setReloadKey] = useState(0);
  const [copiedRtmp, setCopiedRtmp] = useState(false);

  // Live moment markers state
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [showMarkModal, setShowMarkModal] = useState(false);
  const [markTitle, setMarkTitle] = useState('');
  const [markColor, setMarkColor] = useState('purple');
  const [savingMark, setSavingMark] = useState(false);
  const [showMarkerLog, setShowMarkerLog] = useState(false);

  // Speeds (kbps)
  const [incomingBitrateKbps, setIncomingBitrateKbps] = useState<number | null>(null);
  const [measuredHlsBitrateKbps, setMeasuredHlsBitrateKbps] = useState<number | null>(null);
  const lastBytesRef = useRef<{ bytes: number; timestamp: number } | null>(null);
  const lastReadyTimeRef = useRef<string | null>(null);

  // Poll stream status and markers every 3 seconds
  useEffect(() => {
    let isDisposed = false;

    const poll = async () => {
      try {
        const [status, markerList] = await Promise.all([
          api.getStreamStatus(eventId),
          api.listMarkers(eventId).catch(() => []),
        ]);

        if (isDisposed) return;

        setStreamStatus(status);
        if (markerList) setMarkers(markerList);

        if (status.bytes_received && status.is_live) {
          const now = Date.now();
          if (lastBytesRef.current && lastBytesRef.current.bytes > 0 && status.bytes_received >= lastBytesRef.current.bytes) {
            const deltaBytes = status.bytes_received - lastBytesRef.current.bytes;
            const deltaSeconds = (now - lastBytesRef.current.timestamp) / 1000;
            if (deltaSeconds >= 1.5) {
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
          setMeasuredHlsBitrateKbps(null);
        }

        if (status.ready_time && lastReadyTimeRef.current && status.ready_time !== lastReadyTimeRef.current) {
          setReloadKey((k) => k + 1);
        }
        if (status.ready_time) {
          lastReadyTimeRef.current = status.ready_time;
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      isDisposed = true;
      clearInterval(interval);
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
  const is720p = resolution === '720p';

  // HLS stream URL (direct m3u8) for native <video> element
  const hlsManifestUrl = isLive && streamStatus
    ? is720p && streamStatus.hls_low_playlist_url
      ? streamStatus.hls_low_playlist_url
      : is720p && streamStatus.hls_low_url
        ? `${streamStatus.hls_low_url.replace(/\/$/, '')}/index.m3u8`
        : streamStatus.hls_playlist_url || `${streamStatus.hls_url.replace(/\/$/, '')}/index.m3u8`
    : null;

  // Active stream iframe URL for WebRTC
  const currentStreamUrl = isLive && streamStatus
    ? playerMode === 'webrtc'
      ? is720p && streamStatus.webrtc_low_url
        ? `${streamStatus.webrtc_low_url.replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
        : `${(streamStatus.webrtc_url || '').replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
      : is720p && streamStatus.hls_low_url
        ? `${streamStatus.hls_low_url.replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
        : `${(streamStatus.hls_url || '').replace(/\/$/, '')}/?controls=1&autoplay=1&muted=1`
    : null;

  // Direct standalone stream URL for popout button
  const currentDirectUrl = isLive && streamStatus
    ? playerMode === 'webrtc'
      ? `${(is720p && streamStatus.webrtc_low_url ? streamStatus.webrtc_low_url : streamStatus.webrtc_url).replace(/\/$/, '')}/`
      : `${(is720p && streamStatus.hls_low_url ? streamStatus.hls_low_url : streamStatus.hls_url).replace(/\/$/, '')}/`
    : null;

  // Calculate speed from server to frontend user
  const effectiveClientBitrateKbps: number | null = !isLive
    ? null
    : playerMode === 'webrtc'
      ? (is720p ? 864 : incomingBitrateKbps)
      : (measuredHlsBitrateKbps ?? (is720p ? 864 : incomingBitrateKbps));

  // Native HLS playback setup with hls.js
  useEffect(() => {
    if (playerMode !== 'hls' || !isLive || !hlsManifestUrl || !videoRef.current) {
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
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 20,
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

      // Calculate real-time segment playback bitrate (server to front end user)
      hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
        if (data?.frag) {
          const duration = data.frag.duration;
          const total = data.frag.stats?.total;
          if (duration > 0 && total && total > 0) {
            const kbps = Math.round((total * 8) / (duration * 1000));
            setMeasuredHlsBitrateKbps(kbps);
          }
        }
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
  }, [playerMode, isLive, hlsManifestUrl, reloadKey, resolution]);

  // Audio ducking & muting for Live Player
  const originalAudioRef = useRef<{ volume: number; muted: boolean } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const shouldDuck = isListener || isPlayingCall;

    if (isSpeaker) {
      if (!originalAudioRef.current) {
        originalAudioRef.current = { volume: video.volume, muted: video.muted };
      }
      video.muted = true;
    } else if (shouldDuck) {
      if (!originalAudioRef.current) {
        originalAudioRef.current = { volume: video.volume, muted: video.muted };
      }
      const orig = originalAudioRef.current;
      if (!orig.muted) {
        video.muted = false;
        video.volume = Math.max(0, Math.min(1, orig.volume * 0.5));
      }
    } else {
      if (originalAudioRef.current) {
        video.muted = originalAudioRef.current.muted;
        video.volume = originalAudioRef.current.volume;
        originalAudioRef.current = null;
      }
    }
  }, [isSpeaker, isListener, isPlayingCall]);

  // Format speed nicely in Mbps or kbps
  const formatSpeed = useCallback((kbps: number | null) => {
    if (kbps === null || kbps === undefined || isNaN(kbps) || kbps <= 0) return '--';
    if (kbps >= 1000) {
      return `${(kbps / 1000).toFixed(1)} Mbps`;
    }
    return `${Math.round(kbps)} kbps`;
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col relative group shadow-2xl text-card-foreground",
        className
      )}
    >
      {/* Player Header Bar */}
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3 bg-muted/30 z-10">
        <div className="flex items-center gap-2.5">
          <Tv className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
            Live Program Feed
          </span>

          {/* Audio Ducking / Muting Indicators for Walkie-Talkie */}
          {isSpeaker && (
            <Badge variant="destructive" className="font-mono text-[9px] uppercase font-bold tracking-wider animate-pulse flex items-center gap-1 bg-red-600 h-5 px-1.5">
              <VolumeX className="w-2.5 h-2.5" />
              <span>MUTED</span>
            </Badge>
          )}
          {isListener && (
            <Badge variant="secondary" className="font-mono text-[9px] uppercase font-bold tracking-wider flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 h-5 px-1.5">
              <Volume2 className="w-2.5 h-2.5 text-amber-400" />
              <span>DUCKED 50%</span>
            </Badge>
          )}
          {!isSpeaker && !isListener && isPlayingCall && (
            <Badge variant="secondary" className="font-mono text-[9px] uppercase font-bold tracking-wider flex items-center gap-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 h-5 px-1.5">
              <Volume2 className="w-2.5 h-2.5 text-amber-400" />
              <span>DUCKED 50%</span>
            </Badge>
          )}
        </div>

        {/* Right Action Controls: Video Settings, Mark Moment, Popout */}
        <div className="flex items-center gap-2">
          {/* Video Settings Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="xs"
                className="gap-1.5 text-[11px] h-7 px-2.5 font-medium"
                title="Configure stream mode & resolution"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Video Settings</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Playback Mode
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={playerMode}
                onValueChange={(val) => setPlayerMode(val as 'hls' | 'webrtc')}
              >
                <DropdownMenuRadioItem value="hls" className="text-xs cursor-pointer">
                  Standard (HLS)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="webrtc" className="text-xs cursor-pointer">
                  Low Latency (WebRTC)
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Resolution
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={resolution}
                onValueChange={(val) => setResolution(val as '1080p' | '720p')}
              >
                <DropdownMenuRadioItem value="1080p" className="text-xs cursor-pointer">
                  1080p
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="720p" className="text-xs cursor-pointer">
                  720p
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mark Moment Button */}
          <Button
            size="xs"
            variant="secondary"
            onClick={() => setShowMarkModal(true)}
            disabled={!isLive}
            className="gap-1.5 text-[11px] h-7 px-2.5 font-medium"
            title={isLive ? "Add a chapter / moment mark at current live time" : "Mark moment (stream is offline)"}
          >
            <Flag className="w-3.5 h-3.5 text-primary" />
            <span>Mark Moment</span>
          </Button>

          {/* Popout Button to Very Right Corner */}
          {isLive && currentDirectUrl ? (
            <Button
              asChild
              variant="ghost"
              size="icon-xs"
              className="h-7 w-7 rounded"
              title="Pop out stream in new window"
            >
              <a href={currentDirectUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled
              className="h-7 w-7 rounded"
              title="Pop out stream (stream is offline)"
            >
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      {/* Video Viewport Container */}
      <div className="aspect-video bg-black relative flex items-center justify-center overflow-hidden flex-1">
        {/* Active Stream: Native HLS Video or WebRTC Iframe */}
        {isLive ? (
          playerMode === 'hls' ? (
            <video
              ref={videoRef}
              key={`hls-${resolution}-${streamStatus?.ready_time || 'initial'}-${reloadKey}`}
              controls
              playsInline
              autoPlay
              muted
              className="w-full h-full object-contain bg-black absolute inset-0"
            />
          ) : currentStreamUrl ? (
            <iframe
              ref={iframeRef}
              key={`webrtc-${resolution}-${streamStatus?.ready_time || 'initial'}-${reloadKey}`}
              src={currentStreamUrl}
              title="StageControl Program Feed"
              className="w-full h-full border-0 bg-black absolute inset-0"
              allow="autoplay; fullscreen; picture-in-picture"
            />
          ) : null
        ) : (
          /* Off Air / Waiting for OBS Overlay */
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-card/95 backdrop-blur-sm">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Radio className="w-8 h-8 text-primary" />
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-muted-foreground/60 rounded-full border-2 border-background" />
            </div>

            <h3 className="text-base font-bold text-foreground">Waiting for OBS Live Broadcast</h3>
            <p className="text-xs text-muted-foreground max-w-md mt-1 mb-6 leading-relaxed">
              Connect OBS Studio or any RTMP software to start streaming. The server will automatically broadcast live playback and recordings.
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
        <div className="px-4 py-2.5 bg-muted/40 border-t border-border/60 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Codecs:</span>
            <strong className="text-foreground font-semibold">
              {streamStatus.tracks.length > 0 ? streamStatus.tracks.join(' + ') : 'H.264 + AAC'}
            </strong>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span>OBS to Server:</span>
              <strong className="font-mono text-foreground font-semibold">
                {formatSpeed(incomingBitrateKbps)}
              </strong>
            </div>
            <span className="text-border">|</span>
            <div className="flex items-center gap-1.5">
              <span>Server to User:</span>
              <strong className="font-mono text-foreground font-semibold">
                {formatSpeed(effectiveClientBitrateKbps)}
              </strong>
            </div>
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

            <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2 pt-2">
              <div>
                {markers.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setShowMarkModal(false);
                      setShowMarkerLog(true);
                    }}
                    className="text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>View Marks ({markers.length})</span>
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
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
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
