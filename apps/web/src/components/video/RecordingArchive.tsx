'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Film,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Download,
  Trash2,
  Edit2,
  Check,
  X,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RefreshCw,
  Calendar,
  HardDrive,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { api, Recording } from '@/lib/api';

interface RecordingArchiveProps {
  eventId: string;
  isAdmin?: boolean;
  isSMOrAdmin?: boolean;
}

export function RecordingArchive({
  eventId,
  isAdmin = false,
  isSMOrAdmin = false,
}: RecordingArchiveProps) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active playback state
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Stored JWT token for native <video> stream & download requests
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(api.getToken());
  }, []);

  // Rename modal / input state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete modal state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const getAuthenticatedUrl = useCallback((url: string) => {
    if (!url) return '';
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }, [token]);

  const loadRecordings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listRecordings(eventId);
      setRecordings(data);
      if (data.length > 0 && !selectedRecording) {
        setSelectedRecording(data[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load recordings');
    } finally {
      setLoading(false);
    }
  }, [eventId, selectedRecording]);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  // When selected recording changes, reset time, clear error, and auto-play if requested
  useEffect(() => {
    if (selectedRecording && videoRef.current) {
      setCurrentTime(0);
      setVideoError(null);
      if (autoPlayNext) {
        videoRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.error("Playback start error:", err);
            setIsPlaying(false);
          });
        setAutoPlayNext(false);
      }
    }
  }, [selectedRecording?.id, autoPlayNext]);

  // Video event handlers
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      if (videoRef.current.duration && !isNaN(videoRef.current.duration)) {
        setDuration(videoRef.current.duration);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current && videoRef.current.duration) {
      setDuration(videoRef.current.duration);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          setVideoError(null);
        })
        .catch((err) => {
          console.error("Playback error:", err);
          setVideoError("Unable to play video take. Click play to retry.");
          setIsPlaying(false);
        });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const seekRelative = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(
      0,
      Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + seconds)
    );
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const next = !isMuted;
    videoRef.current.muted = next;
    setIsMuted(next);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      if (val > 0 && isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
  };

  const changePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Rename recording
  const handleStartRename = (rec: Recording) => {
    setEditingId(rec.id);
    setEditTitle(rec.title);
  };

  const handleSaveRename = async (recId: string) => {
    if (!editTitle.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await api.renameRecording(eventId, recId, editTitle.trim());
      setRecordings((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      if (selectedRecording?.id === recId) {
        setSelectedRecording(updated);
      }
      setEditingId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to rename recording');
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete recording
  const handleDelete = async (recId: string) => {
    try {
      await api.deleteRecording(eventId, recId);
      setRecordings((prev) => prev.filter((r) => r.id !== recId));
      if (selectedRecording?.id === recId) {
        const remaining = recordings.filter((r) => r.id !== recId);
        setSelectedRecording(remaining.length > 0 ? remaining[0] : null);
      }
      setDeletingId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete recording');
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Player Section */}
      <div
        ref={playerContainerRef}
        className="bg-[#11141f] border border-[#1e2638] rounded-2xl overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-[#1e2638] flex items-center justify-between bg-[#0e111a]">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              {selectedRecording ? selectedRecording.title : 'Recording Playback & Replay'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {selectedRecording && (
              <span className="text-[11px] font-mono text-slate-400">
                {formatFileSize(selectedRecording.file_size_bytes)}
              </span>
            )}
            <button
              onClick={loadRecordings}
              disabled={loading}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] rounded-md transition-colors"
              title="Refresh recordings"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="aspect-video bg-black relative flex items-center justify-center overflow-hidden group">
          {selectedRecording ? (
            <>
              {videoError && (
                <div className="absolute top-4 left-4 right-4 bg-red-950/80 border border-red-500/40 text-red-300 text-xs p-2.5 rounded-lg flex items-center justify-between z-20">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{videoError}</span>
                  </div>
                  <button
                    onClick={() => setVideoError(null)}
                    className="p-1 text-red-400 hover:text-red-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <video
                ref={videoRef}
                key={selectedRecording.id}
                src={getAuthenticatedUrl(selectedRecording.stream_url)}
                playsInline
                preload="auto"
                className="w-full h-full object-contain cursor-pointer"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => {
                  setIsPlaying(true);
                  setVideoError(null);
                }}
                onPause={() => setIsPlaying(false)}
                onError={(e) => {
                  console.error("Video error event:", e);
                  setVideoError("Unable to load video take. Click play or download take.");
                  setIsPlaying(false);
                }}
                onClick={togglePlay}
              />

              {/* Big Play Overlay if paused */}
              {!isPlaying && (
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/20 transition-colors z-10"
                >
                  <div className="w-16 h-16 rounded-full bg-blue-600/90 hover:bg-blue-600 text-white flex items-center justify-center shadow-xl shadow-blue-600/30 transition-transform transform hover:scale-105">
                    <Play className="w-7 h-7 ml-1" />
                  </div>
                </button>
              )}

              {/* Floating Bottom Scrubber & Controls */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex flex-col gap-2 z-10">
                {/* Timeline Scrubber */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-300 w-10 text-right">
                    {formatTime(currentTime)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.5}
                    value={currentTime}
                    onChange={handleSeekChange}
                    className="flex-1 accent-blue-500 cursor-pointer h-1.5 rounded-lg bg-slate-700/80"
                  />
                  <span className="text-[10px] font-mono text-slate-400 w-10">
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Primary Controls */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={togglePlay}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => seekRelative(-10)}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
                      title="Skip back 10s"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => seekRelative(10)}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
                      title="Skip forward 10s"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>

                    <div className="flex items-center gap-1.5 ml-2">
                      <button
                        onClick={toggleMute}
                        className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
                      >
                        {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-16 accent-blue-500 cursor-pointer h-1 rounded-lg bg-slate-700"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Speed Selector */}
                    <div className="flex items-center gap-1 bg-black/40 rounded-lg p-0.5 border border-slate-700">
                      {[0.5, 1, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => changePlaybackRate(rate)}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            playbackRate === rate
                              ? 'bg-blue-600 text-white font-bold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>

                    {/* Download */}
                    <a
                      href={getAuthenticatedUrl(selectedRecording.download_url)}
                      download
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
                      title="Download MP4"
                    >
                      <Download className="w-4 h-4" />
                    </a>

                    {/* Fullscreen */}
                    <button
                      onClick={toggleFullscreen}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
                    >
                      {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <Film className="w-12 h-12 mb-3 text-slate-600" />
              <p className="text-sm font-medium text-slate-300">No Recording Selected</p>
              <p className="text-xs text-slate-500 max-w-sm mt-1">
                Select a recorded take from the archive below or broadcast a stream to automatically generate recordings.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Recordings Archive List */}
      <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Film className="w-4 h-4 text-purple-400" />
              <span>Event Video Takes & Recordings ({recordings.length})</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Saved fMP4 recordings automatically archived to persistent storage during live OBS streams.
            </p>
          </div>

          <button
            onClick={loadRecordings}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-[#161c2c] hover:bg-[#1f283e] text-slate-200 border border-[#232d44] rounded-lg transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Disk</span>
          </button>
        </div>

        {loading && recordings.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-slate-400">Loading recording archive...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span>{error}</span>
          </div>
        ) : recordings.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-[#1e2638] rounded-xl">
            <Film className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-slate-300">No recordings saved yet</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              Start streaming from OBS with your event stream key. MediaMTX will automatically record and index completed takes here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recordings.map((rec) => {
              const isSelected = selectedRecording?.id === rec.id;
              const isEditing = editingId === rec.id;

              return (
                <div
                  key={rec.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-blue-600/10 border-blue-500/40 shadow-lg shadow-blue-950/20'
                      : 'bg-[#0c0e16] border-[#1e2638] hover:border-[#2a354f]'
                  }`}
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="flex-1 px-2 py-1 text-xs bg-[#11141f] border border-blue-500 rounded text-slate-100"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRename(rec.id)}
                            disabled={savingEdit}
                            className="p-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded"
                            title="Save title"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-slate-200 truncate">
                            {rec.title}
                          </h4>
                          {isSMOrAdmin && (
                            <button
                              onClick={() => handleStartRename(rec)}
                              className="text-slate-500 hover:text-slate-300"
                              title="Rename recording"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}

                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#161c2c] text-blue-400 border border-[#232d44]">
                        {rec.status.toUpperCase()}
                      </span>
                    </div>

                    {/* Metadata chips */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mb-4">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span>{new Date(rec.created_at).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3 text-slate-500" />
                        <span>{formatFileSize(rec.file_size_bytes)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#1e2638]/60">
                    <button
                      onClick={() => {
                        if (isSelected) {
                          togglePlay();
                        } else {
                          setSelectedRecording(rec);
                          setAutoPlayNext(true);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                          : 'bg-[#182030] hover:bg-[#202b42] text-slate-200'
                      }`}
                    >
                      {isSelected && isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{isSelected ? (isPlaying ? 'Pause' : 'Resume Take') : 'Play Take'}</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <a
                        href={getAuthenticatedUrl(rec.download_url)}
                        download
                        className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] rounded-lg transition-colors"
                        title="Download MP4"
                      >
                        <Download className="w-4 h-4" />
                      </a>

                      {isAdmin && (
                        <>
                          {deletingId === rec.id ? (
                            <div className="flex items-center gap-1 bg-red-950/60 p-1 rounded-lg border border-red-500/40">
                              <span className="text-[10px] text-red-300 font-semibold px-1">Delete?</span>
                              <button
                                onClick={() => handleDelete(rec.id)}
                                className="px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[10px] rounded font-bold"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-[10px] rounded"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeletingId(rec.id)}
                              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Delete recording"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
