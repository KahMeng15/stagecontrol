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
} from 'lucide-react';
import { api, StreamStatus } from '@/lib/api';

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

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

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

  return (
    <div
      ref={containerRef}
      className="bg-[#11141f] border border-[#1e2638] rounded-2xl overflow-hidden flex flex-col relative group shadow-2xl"
    >
      {/* Player Header Bar */}
      <div className="px-4 py-3 border-b border-[#1e2638] flex flex-wrap items-center justify-between gap-3 bg-[#0e111a] z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Tv className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Live Program Feed
            </span>
          </div>

          {/* Mode Switcher Pill */}
          {isLive && (
            <div className="flex items-center bg-[#161c2c] p-0.5 rounded-lg border border-[#232d44]">
              <button
                onClick={() => setPlayerMode('hls')}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                  playerMode === 'hls'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Buffered HLS with full stereo audio & standard encoder compatibility"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>HLS (Standard)</span>
              </button>

              <button
                onClick={() => setPlayerMode('webrtc')}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                  playerMode === 'webrtc'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Ultra-low latency (~200ms). Requires OBS Max B-frames: 0"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>⚡ WebRTC (Low Latency)</span>
              </button>

              {/* WebRTC tips toggle */}
              {playerMode === 'webrtc' && (
                <button
                  type="button"
                  onClick={() => setShowBFrameHint((prev) => !prev)}
                  title="WebRTC encoder & audio tips"
                  className={`px-1.5 py-1 text-[11px] rounded transition-colors ${
                    showBFrameHint
                      ? 'text-amber-300 bg-amber-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Live / Offline Status Badge */}
          {isLive ? (
            <div className="flex items-center gap-1.5 bg-red-500/20 border border-red-500/40 text-red-400 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse-live" />
              <span>LIVE • REC</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-slate-800 text-slate-400 border border-slate-700 px-2.5 py-0.5 rounded-full text-[10px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              <span>OFF AIR</span>
            </div>
          )}

          {/* Direct Stream Link in New Window */}
          {currentDirectUrl && (
            <a
              href={currentDirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open stream in clean standalone tab"
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] rounded-md transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          {/* Refresh stream button */}
          <button
            onClick={fetchStatus}
            disabled={loadingStatus}
            title="Refresh stream status"
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] rounded-md transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* WebRTC Tips / Notice Banner (only shown if user toggles help icon) */}
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
              Connect OBS Studio or any RTMP software to start streaming. The player will automatically switch on air with live playback and automatic fMP4 recording.
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
              {playerMode === 'webrtc' ? '⚡ Ultra-Low Latency (~200ms)' : '📼 Buffered HLS (Stereo Audio)'}
            </span>
            {streamStatus.tracks.length > 0 && (
              <span className="text-slate-500">
                Codecs: <strong className="text-slate-300">{streamStatus.tracks.join(' + ')}</strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span>
              Bytes Ingested: <strong className="font-mono text-slate-300">{(streamStatus.bytes_received / (1024 * 1024)).toFixed(1)} MB</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
