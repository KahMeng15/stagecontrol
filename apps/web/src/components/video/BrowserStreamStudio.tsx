'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Mic,
  MicOff,
  Video,
  VideoOff,
  RefreshCw,
  Zap,
  Radio,
  QrCode,
  Copy,
  ExternalLink,
  Check,
  AlertCircle,
  Sliders,
  Sparkles,
  Smartphone,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import { QRCodeDisplay } from './QRCodeDisplay';
import {
  useBrowserBroadcast,
  QUALITY_PRESETS,
  QualityPreset,
} from './useBrowserBroadcast';

interface BrowserStreamStudioProps {
  eventId: string;
  streamKey?: string | null;
  eventName?: string;
  standalone?: boolean;
}

export function BrowserStreamStudio({
  eventId,
  streamKey,
  eventName,
  standalone = false,
}: BrowserStreamStudioProps) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [mobileUrl, setMobileUrl] = useState('');
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  const {
    status,
    isLive,
    error,
    mediaStream,
    videoDevices,
    audioDevices,
    selectedVideoDeviceId,
    selectedAudioDeviceId,
    facingMode,
    qualityPreset,
    isAudioMuted,
    isVideoMuted,
    isTorchOn,
    isTorchSupported,
    audioLevel,
    streamDuration,
    initPreview,
    startBroadcast,
    stopBroadcast,
    selectVideoDevice,
    selectAudioDevice,
    flipCamera,
    toggleTorch,
    toggleAudioMute,
    toggleVideoMute,
    setQualityPreset,
  } = useBrowserBroadcast({
    eventId,
    streamKey,
    onLiveChange: (live) => {
      if (live) {
        toast.success('Live broadcast started via WebRTC WHIP!');
      } else {
        toast.info('Broadcast stopped');
      }
    },
  });

  // Calculate mobile broadcast URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      setMobileUrl(`${origin}/events/${eventId}/broadcast`);
    }
  }, [eventId]);

  // Connect local MediaStream to the preview video element
  useEffect(() => {
    if (videoPreviewRef.current && mediaStream) {
      videoPreviewRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  // Initial preview start on mount
  useEffect(() => {
    initPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopyMobileLink = () => {
    if (!mobileUrl) return;
    copyToClipboard(mobileUrl);
    setCopiedLink(true);
    toast.success('Mobile broadcast link copied to clipboard');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Studio Banner / Overview */}
      {!standalone && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-purple-500/10 border border-blue-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Browser & Mobile Camera Studio</h3>
                <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
                  WHIP WebRTC
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Stream live video and audio directly from any phone, tablet, or webcam without OBS Studio.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open(mobileUrl, '_blank')}
              className="gap-1.5 text-xs h-8"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Mobile View</span>
            </Button>
          </div>
        </div>
      )}

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Live Camera Viewport (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/90 border border-border/80 shadow-xl group">
            {/* Live Video Element */}
            <video
              ref={videoPreviewRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Inactive Overlay if no stream */}
            {!mediaStream && status !== 'requesting_permissions' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-background/80 backdrop-blur-sm text-center">
                <Camera className="w-12 h-12 text-muted-foreground/50 mb-3 animate-pulse" />
                <h4 className="text-sm font-bold text-foreground mb-1">Camera Inactive</h4>
                <p className="text-xs text-muted-foreground max-w-xs mb-4">
                  Enable camera and microphone permissions to preview your device feed.
                </p>
                <Button size="sm" onClick={() => initPreview()} className="gap-2 text-xs">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Enable Camera & Mic</span>
                </Button>
              </div>
            )}

            {/* Requesting Permissions Indicator */}
            {status === 'requesting_permissions' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-black/70 backdrop-blur-xs text-center text-white">
                <RefreshCw className="w-8 h-8 text-primary animate-spin mb-3" />
                <p className="text-xs font-semibold">Requesting Camera & Mic Access...</p>
                <p className="text-[11px] text-white/70 mt-1">Please allow browser permissions when prompted.</p>
              </div>
            )}

            {/* Top Overlay: Live Status & Duration */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2">
                {isLive ? (
                  <Badge className="bg-rose-500 hover:bg-rose-500 text-white font-mono text-[11px] gap-1.5 px-2.5 py-1 shadow-lg shadow-rose-500/40 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                    <span>LIVE ON AIR</span>
                  </Badge>
                ) : status === 'connecting' ? (
                  <Badge variant="secondary" className="bg-amber-500/90 text-white text-[11px] gap-1.5 px-2.5 py-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>CONNECTING...</span>
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-black/60 backdrop-blur-md text-white text-[11px] border border-white/10 gap-1.5">
                    <Eye className="w-3 h-3 text-muted-foreground" />
                    <span>LOCAL PREVIEW</span>
                  </Badge>
                )}

                {isLive && (
                  <div className="px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white font-mono text-xs font-semibold">
                    {formatDuration(streamDuration)}
                  </div>
                )}
              </div>

              {/* Torch indicator if active */}
              {isTorchOn && (
                <Badge className="bg-amber-400 text-black font-bold text-[10px] gap-1">
                  <Zap className="w-3 h-3 fill-black" />
                  <span>TORCH ON</span>
                </Badge>
              )}
            </div>

            {/* Bottom Overlay: Audio VU Meter bar across viewport bottom */}
            {mediaStream && (
              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-md p-2 rounded-xl border border-white/10">
                <Mic className={`w-3.5 h-3.5 shrink-0 ${isAudioMuted ? 'text-destructive' : 'text-emerald-400'}`} />
                <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden relative">
                  <div
                    className={`h-full transition-all duration-75 rounded-full ${
                      isAudioMuted
                        ? 'bg-transparent'
                        : audioLevel > 75
                        ? 'bg-rose-500'
                        : audioLevel > 45
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${isAudioMuted ? 0 : audioLevel}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono font-semibold text-white/80 w-8 text-right">
                  {isAudioMuted ? 'MUTED' : `${audioLevel}%`}
                </span>
              </div>
            )}
          </div>

          {/* Quick Action Buttons Below Viewport */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-card border border-border/80">
            <div className="flex items-center gap-2">
              {/* Audio Mute Button */}
              <Button
                type="button"
                size="sm"
                variant={isAudioMuted ? 'destructive' : 'secondary'}
                onClick={toggleAudioMute}
                className="gap-1.5 text-xs h-9"
              >
                {isAudioMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-400" />}
                <span>{isAudioMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
              </Button>

              {/* Video Pause Button */}
              <Button
                type="button"
                size="sm"
                variant={isVideoMuted ? 'destructive' : 'secondary'}
                onClick={toggleVideoMute}
                className="gap-1.5 text-xs h-9"
              >
                {isVideoMuted ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                <span>{isVideoMuted ? 'Resume Cam' : 'Pause Cam'}</span>
              </Button>

              {/* Flip Camera button (for mobile or multi-cam devices) */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={flipCamera}
                title="Flip to next camera or switch front/back"
                className="gap-1.5 text-xs h-9"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Flip Cam</span>
              </Button>

              {/* Torch button if supported by hardware */}
              {isTorchSupported && (
                <Button
                  type="button"
                  size="sm"
                  variant={isTorchOn ? 'default' : 'outline'}
                  onClick={toggleTorch}
                  title="Toggle device flashlight/torch"
                  className="gap-1.5 text-xs h-9 text-amber-400"
                >
                  <Zap className={`w-3.5 h-3.5 ${isTorchOn ? 'fill-current' : ''}`} />
                  <span>Torch</span>
                </Button>
              )}
            </div>

            {/* Big Go Live / Stop Button */}
            <div>
              {isLive ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={stopBroadcast}
                  className="gap-2 text-xs font-bold px-5 h-9 shadow-lg shadow-destructive/30 hover:shadow-destructive/50"
                >
                  <Radio className="w-4 h-4 animate-pulse" />
                  <span>END BROADCAST</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={startBroadcast}
                  disabled={status === 'connecting' || !mediaStream}
                  className="gap-2 text-xs font-bold px-5 h-9 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30"
                >
                  <Radio className="w-4 h-4" />
                  <span>{status === 'connecting' ? 'CONNECTING...' : 'START STREAMING'}</span>
                </Button>
              )}
            </div>
          </div>

          {/* Error Notice */}
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/10 border border-destructive/25 text-destructive text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Stream Error</p>
                <p className="text-[11px] opacity-90 mt-0.5">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Device Selectors & Mobile Pairing (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Hardware & Device Configuration Card */}
          <Card className="border-border/80">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-primary" />
                <CardTitle className="text-sm font-bold">Input Device Selectors</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Select your camera, microphone, and streaming quality preset.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 text-xs">
              {/* Camera Input Selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                  <span>Camera Device ({videoDevices.length})</span>
                  <span className="text-[10px] lowercase text-primary font-normal">
                    {facingMode === 'environment' ? 'back camera' : 'front camera'}
                  </span>
                </label>
                <select
                  value={selectedVideoDeviceId}
                  onChange={(e) => selectVideoDevice(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/80 text-foreground text-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
                >
                  {videoDevices.length === 0 && (
                    <option value="">Default Camera / Initializing...</option>
                  )}
                  {videoDevices.map((dev, idx) => (
                    <option key={dev.deviceId || idx} value={dev.deviceId}>
                      {dev.label || `Camera ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Microphone Input Selector */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                  <span>Audio Device ({audioDevices.length})</span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    Echo cancellation enabled
                  </span>
                </label>
                <select
                  value={selectedAudioDeviceId}
                  onChange={(e) => selectAudioDevice(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-background border border-border/80 text-foreground text-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
                >
                  {audioDevices.length === 0 && (
                    <option value="">Default Microphone / Initializing...</option>
                  )}
                  {audioDevices.map((dev, idx) => (
                    <option key={dev.deviceId || idx} value={dev.deviceId}>
                      {dev.label || `Microphone ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quality & Bitrate Preset */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                  Broadcast Quality Preset
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((key) => {
                    const preset = QUALITY_PRESETS[key];
                    const isSelected = qualityPreset === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setQualityPreset(key)}
                        className={`p-2 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                            : 'border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40'
                        }`}
                      >
                        <div className="text-xs font-semibold">{key.toUpperCase()}</div>
                        <div className="text-[10px] opacity-80 mt-0.5">
                          {key === '1080p' ? 'Full HD' : key === '720p' ? 'Balanced' : 'Data Saver'}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Preset: <strong>{QUALITY_PRESETS[qualityPreset].label}</strong>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Mobile Camera Pairing & QR Code Card */}
          <Card className="border-border/80 bg-gradient-to-br from-card via-card to-purple-500/5">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-purple-400" />
                <CardTitle className="text-sm font-bold">Use Mobile Phone as Camera</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Scan this QR code with any smartphone to stream live without installing any software.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {/* QR Code */}
                <div className="shrink-0">
                  <QRCodeDisplay value={mobileUrl} size={110} />
                </div>

                <div className="space-y-2 text-xs">
                  <div className="space-y-1">
                    <span className="font-semibold text-foreground block">
                      1. Scan QR with iPhone / Android
                    </span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Opens the mobile broadcast interface with camera flip & audio controls.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="font-semibold text-foreground block">
                      2. Instant WebRTC Ingest
                    </span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Crew members and Stage Managers will immediately see the feed on stage.
                    </p>
                  </div>
                </div>
              </div>

              {/* Direct Link Input */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={mobileUrl}
                    className="flex-1 h-8 px-2.5 rounded-lg bg-background border border-border/80 font-mono text-[11px] text-muted-foreground select-all"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleCopyMobileLink}
                    className="gap-1.5 text-xs h-8 shrink-0"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
