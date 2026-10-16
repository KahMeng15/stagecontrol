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
} from 'lucide-react';
import { api, StreamStatus, VideoMarker } from '@/lib/api';

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

  useEffect(() => {
    fetchStatus();
    fetchMarkers();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchMarkers]);

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
          {/* Mark Live Moment Button */}
          {isLive && (
            <button
              onClick={() => setShowMarkModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition-colors shadow-sm"
              title="Add a chapter / moment mark at current live time"
            >
              <Flag className="w-3.5 h-3.5 text-purple-400" />
              <span>Mark Moment</span>
            </button>
          )}

          {/* Toggle Live Marker Log Button */}
          {markers.length > 0 && (
            <button
              onClick={() => setShowMarkerLog((prev) => !prev)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                showMarkerLog
                  ? 'bg-purple-600 text-white'
                  : 'bg-[#161c2c] text-slate-300 hover:text-slate-100 border border-[#232d44]'
              }`}
              title="View live marks & cues"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Marks ({markers.length})</span>
            </button>
          )}

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
                  <span className="font-semibold text-slate-200 truncate">{m.title}</span>
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

      {/* Mark Moment Modal */}
      {showMarkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-[#11141f] border border-[#1e2638] rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-slate-100">Mark Live Moment</h3>
              </div>
              <button
                onClick={() => setShowMarkModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMarker} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Moment Label / Cue Note
                </label>
                <input
                  type="text"
                  value={markTitle}
                  onChange={(e) => setMarkTitle(e.target.value)}
                  placeholder="e.g. Act 1 Starts, Mic 2 Issue, Solo"
                  className="w-full px-3 py-2 text-xs bg-[#0b0e17] border border-[#1e2638] focus:border-purple-500 rounded-xl text-slate-100 outline-none"
                  autoFocus
                  required
                />
              </div>

              {/* Quick Preset Buttons */}
              <div>
                <label className="block text-[11px] text-slate-400 mb-1.5">Quick Presets</label>
                <div className="flex flex-wrap gap-1.5">
                  {['Act 1 Begins', 'Act 2 Begins', 'Intermission', 'Key Cue', 'Issue / Glitch', 'Finale'].map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      onClick={() => setMarkTitle(preset)}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-[#161c2c] hover:bg-[#202940] text-slate-300 border border-[#232d44] transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color selector */}
              <div>
                <label className="block text-[11px] text-slate-400 mb-1.5">Marker Color</label>
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
                        markColor === c.id ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2638]">
                <button
                  type="button"
                  onClick={() => setShowMarkModal(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingMark || !markTitle.trim()}
                  className="px-4 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors shadow-lg shadow-purple-600/30 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{savingMark ? 'Saving...' : 'Drop Mark'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
