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
  Flag,
  Bookmark,
  Plus,
  Tag,
  FileText,
  Search,
  Subtitles,
  Sparkles,
} from 'lucide-react';
import { api, Recording, VideoMarker, SubtitleItem } from '@/lib/api';

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

  // Markers & chapters state
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [showAddChapterModal, setShowAddChapterModal] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterDescription, setChapterDescription] = useState('');
  const [chapterColor, setChapterColor] = useState('purple');
  const [chapterTime, setChapterTime] = useState<number>(0);
  const [savingChapter, setSavingChapter] = useState(false);

  // Dialogue transcript state
  const [activeTab, setActiveTab] = useState<'chapters' | 'transcript'>('transcript');
  const [recordSubtitles, setRecordSubtitles] = useState<SubtitleItem[]>([]);
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [showReplayCC, setShowReplayCC] = useState(true);

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

  const loadMarkers = useCallback(async () => {
    if (!selectedRecording) {
      setMarkers([]);
      return;
    }
    try {
      const data = await api.listMarkers(eventId, selectedRecording.id);
      setMarkers(data);
    } catch (err) {
      console.error('Failed to load markers:', err);
    }
  }, [eventId, selectedRecording]);

  const loadSubtitles = useCallback(async () => {
    if (!selectedRecording) {
      setRecordSubtitles([]);
      return;
    }
    setLoadingSubtitles(true);
    try {
      const data = await api.listSubtitles(eventId, undefined, 300, selectedRecording.id);
      setRecordSubtitles(data);
    } catch {
      setRecordSubtitles([]);
    } finally {
      setLoadingSubtitles(false);
    }
  }, [eventId, selectedRecording]);

  useEffect(() => {
    loadMarkers();
    loadSubtitles();
  }, [loadMarkers, loadSubtitles]);

  const handleOpenAddChapter = () => {
    const t = videoRef.current ? videoRef.current.currentTime : currentTime;
    setChapterTime(Math.round(t * 10) / 10);
    setChapterTitle('');
    setChapterDescription('');
    setShowAddChapterModal(true);
  };

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chapterTitle.trim() || !selectedRecording) return;
    setSavingChapter(true);
    try {
      const newMarker = await api.createMarker(eventId, {
        title: chapterTitle.trim(),
        description: chapterDescription.trim() || undefined,
        timestamp_seconds: chapterTime,
        recording_id: selectedRecording.id,
        color: chapterColor,
      });
      setMarkers((prev) =>
        [...prev, newMarker].sort((a, b) => (a.timestamp_seconds || 0) - (b.timestamp_seconds || 0))
      );
      setShowAddChapterModal(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to add chapter mark');
    } finally {
      setSavingChapter(false);
    }
  };

  const handleDeleteMarker = async (markerId: string) => {
    try {
      await api.deleteMarker(eventId, markerId);
      setMarkers((prev) => prev.filter((m) => m.id !== markerId));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete chapter');
    }
  };

  const handleJumpToMarker = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined || !videoRef.current) return;
    videoRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
  };

  const handleJumpToSubtitle = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined || !videoRef.current) return;
    const target = Math.max(0, seconds);
    videoRef.current.currentTime = target;
    setCurrentTime(target);
    videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
  };

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
          .catch((err: unknown) => {
            if (err instanceof Error && err.name === 'AbortError') return;
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

  const formatFriendlyRecordingTitle = (title: string) => {
    // Check if title has unformatted timestamp e.g. "Recording - 2026-10-16_13-16-46-167599" or "Take - 2026-10-16_..."
    const match = title.match(/(?:Recording|Take)\s*-\s*(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day, hours, minutes, seconds] = match;
      const h = parseInt(hours, 10);
      const ampm = h >= 12 ? 'pm' : 'am';
      const h12 = h % 12 || 12;
      const pad = (n: number | string) => n.toString().padStart(2, '0');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthName = monthNames[parseInt(month, 10) - 1] || month;
      return `${pad(h12)}:${pad(minutes)}:${pad(seconds)} ${ampm} ${parseInt(day, 10)} ${monthName} ${year}`;
    }
    return title;
  };

  const formatFriendlyDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const h = d.getHours();
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm} ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
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
              {selectedRecording ? formatFriendlyRecordingTitle(selectedRecording.title) : 'Recording Playback & Replay'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {selectedRecording && (
              <>
                <button
                  onClick={handleOpenAddChapter}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition-colors shadow-sm"
                  title="Add chapter marker at current time"
                >
                  <Flag className="w-3.5 h-3.5 text-purple-400" />
                  <span>+ Add Chapter</span>
                </button>
                <span className="text-[11px] font-mono text-slate-400">
                  {formatFileSize(selectedRecording.file_size_bytes)}
                </span>
              </>
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

              {/* Replay Closed Captions Overlay */}
              {showReplayCC && (() => {
                const activeSub = recordSubtitles.find((s) => {
                  if (s.start_seconds === null || s.start_seconds === undefined) return false;
                  const end = s.end_seconds ?? s.start_seconds + 3.0;
                  return currentTime >= s.start_seconds && currentTime <= end;
                });
                if (!activeSub) return null;
                return (
                  <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 max-w-[85%] pointer-events-none transition-all duration-200 animate-in fade-in">
                    <div className="bg-black/90 backdrop-blur-md border border-purple-500/40 text-white px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 text-center">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                      <span className="text-xs sm:text-sm font-semibold tracking-wide drop-shadow select-none">
                        {activeSub.text}
                      </span>
                    </div>
                  </div>
                );
              })()}

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
                {/* Timeline Scrubber with Interactive Chapter Marker Pins */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-300 w-10 text-right">
                    {formatTime(currentTime)}
                  </span>
                  <div className="flex-1 relative flex items-center h-6 group/timeline">
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      step={0.5}
                      value={currentTime}
                      onChange={handleSeekChange}
                      className="w-full accent-blue-500 cursor-pointer h-1.5 rounded-lg bg-slate-700/80 z-10"
                    />
                    {/* Chapter Marker Pins on Timeline Track */}
                    {duration > 0 &&
                      markers.map((m) => {
                        if (m.timestamp_seconds === null || m.timestamp_seconds === undefined) return null;
                        const pct = Math.min(100, Math.max(0, (m.timestamp_seconds / duration) * 100));
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJumpToMarker(m.timestamp_seconds);
                            }}
                            style={{ left: `${pct}%` }}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 z-20 group/pin flex items-center justify-center focus:outline-none"
                            title={`${formatTime(m.timestamp_seconds)} - ${m.title}`}
                          >
                            <span
                              className={`w-2.5 h-2.5 rounded-full border border-black shadow-md transition-transform group-hover/pin:scale-150 ${
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
                            {/* Tooltip on Hover */}
                            <div className="absolute bottom-full mb-1.5 hidden group-hover/pin:flex flex-col items-center pointer-events-none whitespace-nowrap z-30">
                              <div className="bg-[#0b0e17] border border-[#232f48] text-white text-[10px] px-2 py-0.5 rounded shadow-lg flex items-center gap-1.5">
                                <span className="font-mono text-purple-400 font-bold">{formatTime(m.timestamp_seconds)}</span>
                                <span className="font-semibold">{m.title}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>
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

                    {/* Quick Add Chapter */}
                    <button
                      onClick={handleOpenAddChapter}
                      className="p-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 transition-colors flex items-center gap-1 text-[11px] font-semibold"
                      title="Add chapter at current time"
                    >
                      <Flag className="w-3.5 h-3.5 text-purple-400" />
                      <span className="hidden sm:inline">+ Chapter</span>
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

                    {/* Subtitles (CC) Toggle */}
                    <button
                      onClick={() => setShowReplayCC((prev) => !prev)}
                      className={`p-1.5 rounded-lg text-xs font-bold transition-colors ${
                        showReplayCC
                          ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                          : 'bg-white/10 hover:bg-white/20 text-slate-400'
                      }`}
                      title={showReplayCC ? 'Hide Closed Captions' : 'Show Closed Captions'}
                    >
                      <Subtitles className="w-4 h-4" />
                    </button>

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

      {/* Chapters & Dialogue Transcript Section */}
      {selectedRecording && (
        <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            {/* View Tabs */}
            <div className="flex items-center gap-1.5 bg-[#0b0e17] p-1 rounded-xl border border-[#1e2638]">
              <button
                type="button"
                onClick={() => setActiveTab('chapters')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'chapters'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Chapters ({markers.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('transcript')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'transcript'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Dialogue Transcript ({recordSubtitles.length})</span>
                {recordSubtitles.length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              {activeTab === 'chapters' ? (
                <button
                  onClick={handleOpenAddChapter}
                  className="px-2.5 py-1 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Chapter</span>
                </button>
              ) : (
                <div className="relative">
                  <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                    placeholder="Search spoken dialogue..."
                    className="pl-7 pr-3 py-1 text-xs bg-[#0b0e17] border border-[#1e2638] rounded-lg text-slate-200 outline-none w-48 focus:w-60 transition-all"
                  />
                </div>
              )}
            </div>
          </div>

          {activeTab === 'chapters' ? (
            markers.length === 0 ? (
              <div className="py-6 px-4 rounded-xl border border-dashed border-[#1e2638] text-center">
                <Flag className="w-6 h-6 text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs text-slate-400 font-medium">No chapters or scene marks saved for this take</p>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-0.5">
                  Scrub to any moment in the video and click &quot;+ Add Chapter&quot; to bookmark scenes, cues, or rehearsal segments.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#1e2638] border border-[#1e2638] rounded-xl overflow-hidden bg-[#0c0e16] max-h-[420px] overflow-y-auto">
                {markers.map((m, idx) => {
                  const nextMarker = markers[idx + 1];
                  const isActive =
                    m.timestamp_seconds !== null &&
                    m.timestamp_seconds !== undefined &&
                    currentTime >= m.timestamp_seconds &&
                    (nextMarker?.timestamp_seconds ? currentTime < nextMarker.timestamp_seconds : true);

                  return (
                    <div
                      key={m.id}
                      className={`group px-3.5 py-2.5 transition-colors flex items-center justify-between gap-3 ${
                        isActive
                          ? 'bg-purple-600/15 border-l-4 border-l-purple-500'
                          : 'border-l-4 border-l-transparent hover:bg-[#131826]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleJumpToMarker(m.timestamp_seconds)}
                        className="flex items-center gap-3 min-w-0 text-left flex-1"
                      >
                        {/* Chapter Index / Status Indicator */}
                        <div className="w-6 h-6 rounded-md bg-[#161c2c] group-hover:bg-purple-600/30 border border-[#232d44] flex items-center justify-center shrink-0 transition-colors">
                          {isActive ? (
                            <Play className="w-3 h-3 text-purple-400 fill-purple-400" />
                          ) : (
                            <span className="text-[10px] font-mono font-semibold text-slate-400 group-hover:text-purple-300">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                          )}
                        </div>

                        {/* Color Tag Indicator */}
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

                        {/* Title & Description */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200 group-hover:text-purple-300 transition-colors truncate">
                              {m.title}
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-purple-500/25 text-purple-300 rounded font-semibold border border-purple-500/30 animate-pulse">
                                NOW PLAYING
                              </span>
                            )}
                          </div>
                          {m.description && (
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{m.description}</p>
                          )}
                        </div>
                      </button>

                      {/* Timecode Badge & Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleJumpToMarker(m.timestamp_seconds)}
                          className={`px-2.5 py-1 rounded-md font-mono text-[11px] font-bold border transition-all flex items-center gap-1.5 ${
                            isActive
                              ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                              : 'bg-[#161c2c] hover:bg-purple-600 hover:text-white text-purple-300 border-[#232d44]'
                          }`}
                          title="Jump to this time"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>{formatTime(m.timestamp_seconds || 0)}</span>
                        </button>

                        {(isSMOrAdmin || isAdmin) && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMarker(m.id)}
                            className="text-slate-500 hover:text-red-400 p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
                            title="Delete chapter"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* Dialogue Transcript Tab */
            recordSubtitles.length === 0 ? (
              <div className="py-8 px-4 rounded-xl border border-dashed border-[#1e2638] text-center">
                <FileText className="w-6 h-6 text-slate-600 mx-auto mb-1.5" />
                <p className="text-xs text-slate-400 font-medium">No dialogue lines transcribed for this take</p>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-0.5">
                  Dialogue spoken during live broadcasts is captured by Malaysian Whisper and synchronized with video timestamps.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#1e2638] border border-[#1e2638] rounded-xl overflow-hidden bg-[#0c0e16] max-h-[420px] overflow-y-auto">
                {recordSubtitles
                  .filter((s) => !transcriptSearch.trim() || s.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
                  .map((sub, idx, arr) => {
                    const nextSub = arr[idx + 1];
                    const subStart = sub.start_seconds || 0;
                    const subEnd = sub.end_seconds ?? (nextSub?.start_seconds ?? subStart + 3.0);
                    const isCurrent = currentTime >= subStart && currentTime < subEnd;

                    return (
                      <div
                        key={sub.id || idx}
                        onClick={() => handleJumpToSubtitle(sub.start_seconds)}
                        className={`group px-3.5 py-2.5 transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                          isCurrent
                            ? 'bg-purple-600/15 border-l-4 border-l-purple-500'
                            : 'border-l-4 border-l-transparent hover:bg-[#131826]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-6 h-6 rounded-md bg-[#161c2c] group-hover:bg-purple-600/30 border border-[#232d44] flex items-center justify-center shrink-0 transition-colors">
                            {isCurrent ? (
                              <Play className="w-3 h-3 text-purple-400 fill-purple-400" />
                            ) : (
                              <span className="text-[10px] font-mono font-semibold text-slate-400 group-hover:text-purple-300">
                                {String(idx + 1).padStart(2, '0')}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-200 group-hover:text-purple-300 transition-colors leading-relaxed">
                                {sub.text}
                              </span>
                              {isCurrent && (
                                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-purple-500/25 text-purple-300 rounded font-semibold border border-purple-500/30 animate-pulse">
                                  PLAYING
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 bg-[#161c2c] text-slate-400 rounded">
                            {sub.language || 'en'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJumpToSubtitle(sub.start_seconds);
                            }}
                            className={`px-2.5 py-1 rounded-md font-mono text-[11px] font-bold border transition-all flex items-center gap-1.5 ${
                              isCurrent
                                ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                                : 'bg-[#161c2c] hover:bg-purple-600 hover:text-white text-purple-300 border-[#232d44]'
                            }`}
                            title="Jump video playback to this line"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>{formatTime(sub.start_seconds || 0)}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )
          )}
        </div>
      )}

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
                            {formatFriendlyRecordingTitle(rec.title)}
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
                        <span>{formatFriendlyDate(rec.created_at)}</span>
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

      {/* Add Chapter / Mark Modal */}
      {showAddChapterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-[#11141f] border border-[#1e2638] rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-slate-100">Add Chapter Mark</h3>
              </div>
              <button
                onClick={() => setShowAddChapterModal(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateChapter} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    Chapter / Cue Title
                  </label>
                  <span className="text-[11px] font-mono text-purple-400 font-bold">
                    @ {formatTime(chapterTime)}
                  </span>
                </div>
                <input
                  type="text"
                  value={chapterTitle}
                  onChange={(e) => setChapterTitle(e.target.value)}
                  placeholder="e.g. Act 1 Scene 2, Solo, Intermission"
                  className="w-full px-3 py-2 text-xs bg-[#0b0e17] border border-[#1e2638] focus:border-purple-500 rounded-xl text-slate-100 outline-none"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Optional Notes
                </label>
                <input
                  type="text"
                  value={chapterDescription}
                  onChange={(e) => setChapterDescription(e.target.value)}
                  placeholder="Additional cues or notes..."
                  className="w-full px-3 py-1.5 text-xs bg-[#0b0e17] border border-[#1e2638] focus:border-purple-500 rounded-xl text-slate-100 outline-none"
                />
              </div>

              {/* Quick Presets */}
              <div>
                <label className="block text-[11px] text-slate-400 mb-1.5">Quick Presets</label>
                <div className="flex flex-wrap gap-1.5">
                  {['Scene 1', 'Scene 2', 'Solo Performance', 'Intermission', 'Key Cue', 'Finale'].map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      onClick={() => setChapterTitle(preset)}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-[#161c2c] hover:bg-[#202940] text-slate-300 border border-[#232d44] transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color selector */}
              <div>
                <label className="block text-[11px] text-slate-400 mb-1.5">Pin Color</label>
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
                      onClick={() => setChapterColor(c.id)}
                      className={`w-6 h-6 rounded-full ${c.bg} transition-transform ${
                        chapterColor === c.id ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1e2638]">
                <button
                  type="button"
                  onClick={() => setShowAddChapterModal(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingChapter || !chapterTitle.trim()}
                  className="px-4 py-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors shadow-lg shadow-purple-600/30 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{savingChapter ? 'Saving...' : 'Pin Chapter'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
