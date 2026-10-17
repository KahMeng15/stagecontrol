'use client';

import React, { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, EventDetail } from '@/lib/api';
import {
  Camera,
  Mic,
  MicOff,
  Video,
  VideoOff,
  RefreshCw,
  Zap,
  Radio,
  ArrowLeft,
  Settings,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  useBrowserBroadcast,
  QUALITY_PRESETS,
  QualityPreset,
} from '@/components/video/useBrowserBroadcast';

function MobileBroadcastContent() {
  const router = useRouter();
  const params = useParams();
  const eventId = params.id as string;
  const { user, isLoading: authLoading } = useAuth();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load event details
  useEffect(() => {
    if (!eventId) return;
    const fetchEvent = async () => {
      try {
        const data = await api.getEvent(eventId);
        setEvent(data);
      } catch (err: any) {
        toast.error('Failed to load event details');
      } finally {
        setLoadingEvent(false);
      }
    };
    fetchEvent();
  }, [eventId]);

  const {
    status,
    isLive,
    error,
    mediaStream,
    videoDevices,
    audioDevices,
    selectedVideoDeviceId,
    selectedAudioDeviceId,
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
    streamKey: event?.stream_key,
    onLiveChange: (live) => {
      if (live) {
        toast.success('Live broadcast started via WebRTC!');
      } else {
        toast.info('Broadcast ended');
      }
    },
  });

  // Attach local media stream to video element
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  // Request preview on load
  useEffect(() => {
    initPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (authLoading || loadingEvent) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 text-white">
        <RefreshCw className="w-8 h-8 text-primary animate-spin mb-3" />
        <p className="text-xs font-mono text-zinc-400">Loading broadcast studio...</p>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-dvh bg-black overflow-hidden flex flex-col select-none touch-none">
      {/* 1. Camera Viewport (Fills entire screen background) */}
      <div className="absolute inset-0 z-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />

        {/* Inactive or Permission State */}
        {!mediaStream && status !== 'requesting_permissions' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-zinc-950/90 text-center text-white z-10">
            <Camera className="w-16 h-16 text-zinc-600 mb-4 animate-pulse" />
            <h2 className="text-base font-bold mb-1">Mobile Camera Inactive</h2>
            <p className="text-xs text-zinc-400 max-w-xs mb-6 leading-relaxed">
              Enable camera and microphone permissions to use this mobile device as the stage camera.
            </p>
            <Button
              size="lg"
              onClick={() => initPreview()}
              className="gap-2 font-bold bg-primary hover:bg-primary/90 text-white"
            >
              <Sparkles className="w-4 h-4" />
              <span>Allow Camera & Mic</span>
            </Button>
          </div>
        )}

        {status === 'requesting_permissions' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-black/80 text-center text-white z-10">
            <RefreshCw className="w-10 h-10 text-primary animate-spin mb-4" />
            <p className="text-sm font-semibold">Prompting for Camera Access...</p>
            <p className="text-xs text-zinc-400 mt-1">Please tap &ldquo;Allow&rdquo; in your browser.</p>
          </div>
        )}
      </div>

      {/* 2. Top Header Bar (HUD overlay) */}
      <header className="relative z-20 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={() => router.push(`/events/${eventId}`)}
            className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>

          <div className="max-w-[160px] sm:max-w-xs truncate">
            <span className="text-[10px] text-zinc-400 block font-mono uppercase tracking-wider">
              Stage Camera
            </span>
            <h1 className="text-xs font-bold text-white truncate">
              {event?.name || 'Live Event'}
            </h1>
          </div>
        </div>

        {/* Live Status Badge & Duration */}
        <div className="flex items-center gap-2">
          {isLive ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-600/90 backdrop-blur-md text-white font-mono text-xs font-bold shadow-lg shadow-rose-600/30 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-white" />
              <span>LIVE</span>
              <span className="ml-1 opacity-90">{formatDuration(streamDuration)}</span>
            </div>
          ) : status === 'connecting' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/80 backdrop-blur-md text-white font-mono text-xs font-semibold">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>CONNECTING</span>
            </div>
          ) : (
            <Badge variant="outline" className="bg-black/60 backdrop-blur-md border-white/20 text-white text-[10px]">
              STANDBY
            </Badge>
          )}

          {/* Settings Trigger */}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white hover:bg-black/80"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* 3. Middle Floating Actions (Torch, Errors) */}
      <div className="relative z-20 flex-1 p-4 flex flex-col justify-between pointer-events-none">
        {/* Error notification banner */}
        {error ? (
          <div className="pointer-events-auto p-3 rounded-xl bg-rose-950/90 border border-rose-500/50 backdrop-blur-md text-white text-xs flex items-start gap-2 shadow-xl">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold text-rose-200">Broadcast Notice</span>
              <p className="text-[11px] text-zinc-300 mt-0.5">{error}</p>
            </div>
          </div>
        ) : <div />}

        {/* Side Floating Controls */}
        <div className="flex flex-col items-end gap-3 pointer-events-auto">
          {/* Torch Toggle if available on mobile */}
          {isTorchSupported && (
            <Button
              type="button"
              size="icon"
              variant={isTorchOn ? 'default' : 'secondary'}
              onClick={toggleTorch}
              className={`w-11 h-11 rounded-full shadow-lg backdrop-blur-md border border-white/10 ${
                isTorchOn
                  ? 'bg-amber-400 text-black hover:bg-amber-300'
                  : 'bg-black/60 text-white hover:bg-black/80'
              }`}
            >
              <Zap className={`w-5 h-5 ${isTorchOn ? 'fill-current' : ''}`} />
            </Button>
          )}
        </div>
      </div>

      {/* 4. Bottom Control Deck (Thumb friendly) */}
      <footer className="relative z-20 p-4 pb-8 bg-gradient-to-t from-black/95 via-black/80 to-transparent space-y-4">
        {/* Real-time Audio VU Meter */}
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 max-w-sm mx-auto">
          <Mic className={`w-3.5 h-3.5 shrink-0 ${isAudioMuted ? 'text-rose-400' : 'text-emerald-400'}`} />
          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden relative">
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
          <span className="text-[10px] font-mono font-bold text-zinc-300 w-8 text-right">
            {isAudioMuted ? 'MUTE' : `${audioLevel}%`}
          </span>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center justify-around max-w-sm mx-auto gap-4">
          {/* Flip Camera */}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={flipCamera}
            className="w-13 h-13 rounded-full bg-zinc-900/80 border border-zinc-700 text-white hover:bg-zinc-800 shadow-md active:scale-95 transition-transform"
            title="Switch front and back camera"
          >
            <RefreshCw className="w-5 h-5" />
          </Button>

          {/* Master Start / Stop Button */}
          {isLive ? (
            <button
              type="button"
              onClick={stopBroadcast}
              className="w-20 h-20 rounded-full bg-rose-600 border-4 border-white/80 shadow-2xl shadow-rose-600/50 flex flex-col items-center justify-center text-white active:scale-95 transition-transform"
            >
              <div className="w-6 h-6 rounded-sm bg-white" />
              <span className="text-[9px] font-bold mt-1 tracking-wider">STOP</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={status === 'connecting' || !mediaStream}
              onClick={startBroadcast}
              className="w-20 h-20 rounded-full bg-emerald-600 hover:bg-emerald-500 border-4 border-white/80 shadow-2xl shadow-emerald-600/50 flex flex-col items-center justify-center text-white active:scale-95 transition-transform disabled:opacity-50"
            >
              <Radio className="w-6 h-6" />
              <span className="text-[9px] font-bold mt-1 tracking-wider">
                {status === 'connecting' ? 'WAIT' : 'GO LIVE'}
              </span>
            </button>
          )}

          {/* Mic Mute Toggle */}
          <Button
            type="button"
            size="icon"
            variant={isAudioMuted ? 'destructive' : 'secondary'}
            onClick={toggleAudioMute}
            className={`w-13 h-13 rounded-full border shadow-md active:scale-95 transition-transform ${
              isAudioMuted
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-zinc-900/80 text-white border-zinc-700 hover:bg-zinc-800'
            }`}
          >
            {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-emerald-400" />}
          </Button>
        </div>
      </footer>

      {/* 5. Settings & Device Selectors Modal */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-xs sm:max-w-md bg-zinc-950 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" />
              <span>Broadcast Device Settings</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              Configure camera, microphone, and streaming resolution.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Video Input Device */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                Camera Device ({videoDevices.length})
              </label>
              <select
                value={selectedVideoDeviceId}
                onChange={(e) => selectVideoDevice(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
              >
                {videoDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Audio Input Device */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                Microphone Device ({audioDevices.length})
              </label>
              <select
                value={selectedAudioDeviceId}
                onChange={(e) => selectAudioDevice(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-white text-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
              >
                {audioDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Quality Preset */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block">
                Video Resolution & Bitrate
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((key) => {
                  const isSelected = qualityPreset === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQualityPreset(key)}
                      className={`p-2 rounded-lg border text-left transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/20 text-white font-bold'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                      }`}
                    >
                      <div className="text-xs">{key.toUpperCase()}</div>
                      <div className="text-[10px] opacity-75 mt-0.5">
                        {key === '1080p' ? '1080p' : key === '720p' ? '720p' : '480p'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MobileBroadcastPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 text-white">
          <RefreshCw className="w-8 h-8 text-primary animate-spin mb-3" />
          <p className="text-xs font-mono text-zinc-400">Loading broadcast studio...</p>
        </div>
      }
    >
      <MobileBroadcastContent />
    </Suspense>
  );
}
