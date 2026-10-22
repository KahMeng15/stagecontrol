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
  AlertTriangle,
  Flag,
  Bookmark,
  Plus,
  Tag,
  FileText,
  ScrollText,
  Search,
  Subtitles,
  Sparkles,
  Music,
  Zap,
} from 'lucide-react';
import { api, Recording, VideoMarker, SubtitleItem } from '@/lib/api';
import ScriptTracker from '@/components/script/ScriptTracker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface RecordingArchiveProps {
  eventId: string;
  isAdmin?: boolean;
  isSMOrAdmin?: boolean;
  isSpeaker?: boolean;
  isListener?: boolean;
}

export function RecordingArchive({
  eventId,
  isAdmin = false,
  isSMOrAdmin = false,
  isSpeaker = false,
  isListener = false,
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
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferedProgress, setBufferedProgress] = useState(0);
  const [optimizingId, setOptimizingId] = useState<string | null>(null);
  const [replayQuality, setReplayQuality] = useState<'proxy' | 'source'>('proxy');
  const lastPlayedTimeRef = useRef<number>(0);

  const getReplayStreamUrl = (rec: Recording | null, quality: 'proxy' | 'source') => {
    if (!rec) return '';
    if (quality === 'source') {
      return rec.master_stream_url || `${rec.stream_url}?quality=source`;
    }
    return rec.stream_url;
  };

  // Markers & chapters state
  const [markers, setMarkers] = useState<VideoMarker[]>([]);
  const [showAddChapterModal, setShowAddChapterModal] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterDescription, setChapterDescription] = useState('');
  const [chapterColor, setChapterColor] = useState('purple');
  const [chapterTime, setChapterTime] = useState<number>(0);
  const [savingChapter, setSavingChapter] = useState(false);

  // Dialogue transcript & script follow tabs
  const [activeTab, setActiveTab] = useState<'chapters' | 'transcript' | 'script'>('transcript');
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

  const getAuthenticatedUrl = useCallback((url: string | null | undefined) => {
    if (!url) return '';
    // Strip any hardcoded absolute hostnames (e.g. http://localhost:8000 or http://api:8000) to ensure relative path
    const relativeUrl = url.replace(/^https?:\/\/[^/]+/, '');
    if (!token) return relativeUrl;
    const separator = relativeUrl.includes('?') ? '&' : '?';
    return `${relativeUrl}${separator}token=${encodeURIComponent(token)}`;
  }, [token]);

  const loadRecordings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listRecordings(eventId);
      setRecordings(data);
      setSelectedRecording((prev) => {
        if (!prev) return data.length > 0 ? data[0] : null;
        return data.find((r) => r.id === prev.id) || prev;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load recordings');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadRecordings();
  }, [loadRecordings]);

  // When selected recording changes, reset time, sync duration, clear error, and auto-play if requested
  useEffect(() => {
    if (selectedRecording) {
      setCurrentTime(0);
      setVideoError(null);
      setIsBuffering(false);
      setBufferedProgress(0);
      // Fallback to verified database duration immediately so timeline never displays 00:00 or NaN
      if (selectedRecording.duration_seconds && selectedRecording.duration_seconds > 0) {
        setDuration(selectedRecording.duration_seconds);
      } else {
        setDuration(0);
      }
      if (autoPlayNext && videoRef.current) {
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
      const cur = videoRef.current.currentTime;
      setCurrentTime(cur);
      lastPlayedTimeRef.current = cur;
      const d = videoRef.current.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) {
        setDuration(d);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const d = videoRef.current.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) {
        setDuration(d);
      } else if (selectedRecording?.duration_seconds && selectedRecording.duration_seconds > 0) {
        setDuration(selectedRecording.duration_seconds);
      }
      if (lastPlayedTimeRef.current > 0 && lastPlayedTimeRef.current < (videoRef.current.duration || Infinity)) {
        videoRef.current.currentTime = lastPlayedTimeRef.current;
      }
      setIsBuffering(false);
    }
  };

  const handleProgress = () => {
    if (videoRef.current) {
      const d = duration || selectedRecording?.duration_seconds || 0;
      if (d > 0) {
        const buf = videoRef.current.buffered;
        if (buf.length > 0) {
          const end = buf.end(buf.length - 1);
          setBufferedProgress(Math.min(100, Math.max(0, (end / d) * 100)));
        }
      }
    }
  };

  const handleRetryPlayback = () => {
    if (!videoRef.current) return;
    setVideoError(null);
    setIsBuffering(true);
    videoRef.current.load();
    videoRef.current.currentTime = currentTime;
    videoRef.current
      .play()
      .then(() => {
        setIsPlaying(true);
        setIsBuffering(false);
      })
      .catch((e) => {
        console.error("Retry playback error:", e);
        setVideoError("Unable to resume playback. Please verify connection or retry.");
        setIsBuffering(false);
      });
  };

  const handleOptimizeTake = async (recId: string) => {
    setOptimizingId(recId);
    try {
      const updated = await api.optimizeRecording(eventId, recId);
      setRecordings((prev) => prev.map((r) => (r.id === recId ? updated : r)));
      if (selectedRecording?.id === recId) {
        setSelectedRecording(updated);
        if (updated.duration_seconds > 0) {
          setDuration(updated.duration_seconds);
        }
      }
      toast.success("Take indexed & faststart optimized successfully");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to optimize take");
    } finally {
      setOptimizingId(null);
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
          setIsBuffering(false);
        })
        .catch((err) => {
          if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('interrupted'))) {
            return;
          }
          console.error("Playback error:", err);
          setVideoError("Unable to play video take. Click retry or Auto-Fix.");
          setIsPlaying(false);
          setIsBuffering(false);
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

  // Audio ducking & muting for Walkie-Talkie comms
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isSpeaker) {
      // SPEAKER: Mute playback completely to avoid mic feedback
      video.muted = true;
    } else if (isListener) {
      // LISTENER: Duck volume down by 50%
      if (!isMuted) {
        video.muted = false;
        video.volume = Math.max(0, Math.min(1, volume * 0.5));
      }
    } else {
      // NORMAL: Restore original volume & muted state
      video.muted = isMuted;
      video.volume = volume;
    }
  }, [isSpeaker, isListener, isMuted, volume]);

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

  const formatTime = (seconds: number | null | undefined) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
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
        className="bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col shadow-2xl text-card-foreground"
      >
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">
              {selectedRecording ? formatFriendlyRecordingTitle(selectedRecording.title) : 'Recording Playback & Replay'}
            </span>
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
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {selectedRecording && (
              <>
                {/* Dual-Quality Selector Pill */}
                <div className="flex items-center bg-background/80 rounded-lg p-0.5 border border-border/80 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => setReplayQuality('proxy')}
                    className={cn(
                      "px-2 py-0.5 rounded transition-all font-semibold flex items-center gap-1",
                      replayQuality === 'proxy'
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="720p ~800kbps faststart web proxy (Saves 85% bandwidth)"
                  >
                    <Zap className="w-3 h-3 text-emerald-400" />
                    <span>720p {selectedRecording.is_optimized ? '(Proxy)' : '(Auto)'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplayQuality('source')}
                    className={cn(
                      "px-2 py-0.5 rounded transition-all font-semibold flex items-center gap-1",
                      replayQuality === 'source'
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Full bitrate master source file (for LAN / fiber download)"
                  >
                    <HardDrive className="w-3 h-3 text-primary" />
                    <span>1080p (Source)</span>
                  </button>
                </div>

                {isSMOrAdmin && !selectedRecording.is_optimized && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => handleOptimizeTake(selectedRecording.id)}
                    disabled={optimizingId === selectedRecording.id}
                    className="gap-1 text-[11px] border-amber-500/40 text-amber-300 hover:bg-amber-500/10 h-6 px-2"
                    title="Generate compressed 720p proxy & faststart index"
                  >
                    <Sparkles className={cn("w-3 h-3 text-amber-400", optimizingId === selectedRecording.id && "animate-spin")} />
                    <span>{optimizingId === selectedRecording.id ? "Optimizing..." : "Optimize (720p)"}</span>
                  </Button>
                )}

                <Button
                  size="xs"
                  variant="secondary"
                  onClick={handleOpenAddChapter}
                  className="gap-1.5 text-[11px]"
                  title="Add chapter marker at current time"
                >
                  <Flag className="w-3.5 h-3.5 text-primary" />
                  <span>+ Add Chapter</span>
                </Button>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {formatFileSize(
                    replayQuality === 'proxy' && selectedRecording.proxy_size_bytes
                      ? selectedRecording.proxy_size_bytes
                      : selectedRecording.file_size_bytes
                  )}
                </span>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={loadRecordings}
              disabled={loading}
              title="Refresh recordings"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <div className="aspect-video bg-black relative flex items-center justify-center overflow-hidden group">
          {selectedRecording ? (
            selectedRecording.status === 'missing' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/95 border border-amber-500/30 z-20">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3 shadow-xl shadow-amber-500/10">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <h4 className="text-base font-bold text-amber-200">Recording Media File Missing</h4>
                <p className="text-xs text-slate-400 max-w-md mt-1.5 leading-relaxed">
                  The backing video file is currently missing or detached from storage.
                  Metadata, markers, and subtitles have been safely preserved by the zero-deletion safeguard.
                </p>
              </div>
            ) : selectedRecording.status === 'failed' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950/95 border border-red-500/30 z-20">
                <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-3 shadow-xl shadow-red-500/10">
                  <AlertCircle className="w-7 h-7" />
                </div>
                <h4 className="text-base font-bold text-red-200">Corrupted Stream Take (Quarantined)</h4>
                <p className="text-xs text-slate-400 max-w-md mt-1.5 leading-relaxed">
                  This take experienced severe upstream packet loss or uninitialized buffer wipeouts during live ingest.
                  Browser playback is quarantined to prevent decoder crashes.
                </p>
                <div className="flex items-center gap-3 mt-5 flex-wrap justify-center">
                  {isSMOrAdmin && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleOptimizeTake(selectedRecording.id)}
                      disabled={optimizingId === selectedRecording.id}
                      className="gap-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 text-xs font-semibold"
                    >
                      <Sparkles className={cn("w-3.5 h-3.5 text-amber-400", optimizingId === selectedRecording.id && "animate-spin")} />
                      <span>{optimizingId === selectedRecording.id ? "Attempting Salvage..." : "Auto-Salvage Stream"}</span>
                    </Button>
                  )}
                  {selectedRecording.download_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      asChild
                      className="gap-2 text-xs"
                    >
                      <a href={getAuthenticatedUrl(selectedRecording.download_url)} download>
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Raw Master ({formatFileSize(selectedRecording.file_size_bytes)})</span>
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
            <>
              {videoError && (
                <div className="absolute top-4 left-4 right-4 bg-red-950/90 border border-red-500/50 text-red-200 text-xs p-3 rounded-xl flex items-center justify-between z-25 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{videoError}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isSMOrAdmin && (
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => handleOptimizeTake(selectedRecording.id)}
                        disabled={optimizingId === selectedRecording.id}
                        className="gap-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] border border-amber-400/30 h-7 px-2.5 font-semibold"
                        title="Auto-repair container headers, faststart remux, and compress 720p proxy"
                      >
                        <Sparkles className={cn("w-3 h-3 text-amber-400", optimizingId === selectedRecording.id && "animate-spin")} />
                        <span>{optimizingId === selectedRecording.id ? "Repairing..." : "Auto-Fix Take"}</span>
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={handleRetryPlayback}
                      className="gap-1 bg-red-500/20 hover:bg-red-500/30 text-white text-[11px] border border-red-400/30 h-7 px-2.5 font-semibold"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry</span>
                    </Button>
                    <button
                      onClick={() => setVideoError(null)}
                      className="p-1 text-red-400 hover:text-red-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* 4G Buffering Overlay */}
              {isBuffering && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs z-15 pointer-events-none">
                  <div className="bg-black/85 px-4 py-2.5 rounded-xl border border-white/10 flex items-center gap-2.5 text-white text-xs shadow-2xl">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="font-medium tracking-wide">Buffering replay stream...</span>
                  </div>
                </div>
              )}

              <video
                ref={videoRef}
                key={selectedRecording.id}
                src={getAuthenticatedUrl(getReplayStreamUrl(selectedRecording, replayQuality))}
                playsInline
                preload="metadata"
                className="w-full h-full object-contain cursor-pointer"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onProgress={handleProgress}
                onWaiting={() => setIsBuffering(true)}
                onPlaying={() => {
                  setIsPlaying(true);
                  setIsBuffering(false);
                  setVideoError(null);
                }}
                onCanPlay={() => setIsBuffering(false)}
                onSeeked={() => setIsBuffering(false)}
                onPause={() => setIsPlaying(false)}
                onError={(e) => {
                  const mediaErr = (e.currentTarget as HTMLVideoElement)?.error;
                  console.error("Video error event:", {
                    code: mediaErr?.code,
                    message: mediaErr?.message,
                    src: e.currentTarget?.currentSrc || e.currentTarget?.src,
                  });
                  let detail = "Playback interrupted. Click Retry or Auto-Fix.";
                  if (mediaErr?.code === 4) {
                    detail = "Container format error (unindexed or corrupt box). Click 'Auto-Fix Take' to repair.";
                  } else if (mediaErr?.code === 2) {
                    detail = "Network error loading video slice. Click Retry to reconnect.";
                  } else if (mediaErr?.message) {
                    detail = `${mediaErr.message}. Click 'Auto-Fix Take' to repair.`;
                  }
                  setVideoError(detail);
                  setIsPlaying(false);
                  setIsBuffering(false);
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
              {!isPlaying && !isBuffering && (
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
                {/* Timeline Scrubber with Download Buffer Track & Chapter Markers */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-slate-300 w-12 text-right">
                    {formatTime(currentTime)}
                  </span>
                  <div className="flex-1 relative flex items-center h-6 group/timeline">
                    {/* Background buffer progress track for slow/patchy 4G */}
                    <div className="absolute inset-x-0 h-1.5 rounded-lg bg-slate-800 overflow-hidden pointer-events-none">
                      <div
                        className="h-full bg-slate-500/50 transition-all duration-300"
                        style={{ width: `${bufferedProgress}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, duration || selectedRecording?.duration_seconds || 1)}
                      step={0.5}
                      value={currentTime}
                      onChange={handleSeekChange}
                      className="w-full accent-blue-500 cursor-pointer h-1.5 rounded-lg bg-transparent z-10"
                    />
                    {/* Chapter Marker Pins on Timeline Track */}
                    {(duration > 0 || (selectedRecording?.duration_seconds ?? 0) > 0) &&
                      markers.map((m) => {
                        const totalDur = duration || selectedRecording?.duration_seconds || 1;
                        if (m.timestamp_seconds === null || m.timestamp_seconds === undefined) return null;
                        const pct = Math.min(100, Math.max(0, (m.timestamp_seconds / totalDur) * 100));
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

                    {/* Musical & Performance Pins on Timeline Track (Orange) */}
                    {(duration > 0 || (selectedRecording?.duration_seconds ?? 0) > 0) &&
                      recordSubtitles
                        .filter((s) => s.is_music && s.start_seconds !== null && s.start_seconds !== undefined)
                        .map((p) => {
                          const totalDur = duration || selectedRecording?.duration_seconds || 1;
                          const pct = Math.min(100, Math.max(0, ((p.start_seconds || 0) / totalDur) * 100));
                          return (
                            <button
                              key={`perf-${p.id || p.start_seconds}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToSubtitle(p.start_seconds);
                              }}
                              style={{ left: `${pct}%` }}
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 z-20 group/perf flex items-center justify-center focus:outline-none"
                              title={`Performance: ${p.text} (${formatTime(p.start_seconds || 0)})`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full border border-black shadow-md bg-orange-400 transition-transform group-hover/perf:scale-150" />
                              <div className="absolute bottom-full mb-1.5 hidden group-hover/perf:flex flex-col items-center pointer-events-none whitespace-nowrap z-30">
                                <div className="bg-[#0b0e17] border border-orange-500/40 text-orange-200 text-[10px] px-2 py-0.5 rounded shadow-lg flex items-center gap-1.5">
                                  <Music className="w-3 h-3 text-orange-400" />
                                  <span className="font-mono text-orange-400 font-bold">{formatTime(p.start_seconds || 0)}</span>
                                  <span className="font-semibold truncate max-w-44">{p.text}</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 w-12 text-left">
                    {formatTime(duration || selectedRecording?.duration_seconds || 0)}
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
            )
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
        <Card className="p-5 shadow-sm">
          {/* Active Performance Indicator Banner during Replay */}
          {(() => {
            const activePerfSub = recordSubtitles.find((s) => {
              if (!s.is_music || s.start_seconds === null || s.start_seconds === undefined) return false;
              return currentTime >= s.start_seconds && (s.end_seconds ? currentTime <= s.end_seconds : currentTime <= s.start_seconds + 6);
            });
            if (!activePerfSub) return null;
            return (
              <div className="mb-4 px-4 py-2 bg-orange-500/10 border border-orange-500/30 rounded-xl flex items-center justify-between gap-3 text-xs animate-in fade-in">
                <div className="flex items-center gap-2 min-w-0">
                  <Music className="w-4 h-4 text-orange-400 shrink-0 animate-pulse" />
                  <span className="text-orange-400 font-bold uppercase tracking-wider text-[11px] shrink-0">Performance Active:</span>
                  <span className="font-mono text-orange-300 font-medium truncate">{activePerfSub.text}</span>
                </div>
                <Badge variant="outline" className="bg-orange-500/15 border-orange-500/30 text-orange-300 font-mono text-[10px] shrink-0">
                  {formatTime(activePerfSub.start_seconds || 0)}
                </Badge>
              </div>
            );
          })()}

          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as 'chapters' | 'transcript' | 'script')}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <TabsList>
                <TabsTrigger value="transcript" className="gap-1.5 text-xs">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Dialogue Transcript ({recordSubtitles.length})</span>
                  {recordSubtitles.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="script" className="gap-1.5 text-xs">
                  <ScrollText className="w-3.5 h-3.5" />
                  <span>Imported Script</span>
                </TabsTrigger>
                <TabsTrigger value="chapters" className="gap-1.5 text-xs">
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Chapters ({markers.length})</span>
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-2">
                {activeTab === 'chapters' ? (
                  <Button
                    size="sm"
                    onClick={handleOpenAddChapter}
                    className="h-8 text-xs gap-1.5 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Chapter</span>
                  </Button>
                ) : activeTab === 'transcript' ? (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="text"
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                      placeholder="Search spoken dialogue..."
                      className="pl-8 h-8 text-xs w-48 focus:w-60 transition-all"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <TabsContent value="chapters" className="mt-0">
              {markers.length === 0 ? (
                <div className="py-8 px-4 rounded-xl border border-dashed border-border/60 text-center bg-muted/10">
                  <Flag className="w-6 h-6 text-muted-foreground/60 mx-auto mb-2" />
                  <p className="text-xs text-foreground font-semibold">No chapters or scene marks saved for this take</p>
                  <p className="text-[11px] text-muted-foreground max-w-sm mx-auto mt-1 leading-relaxed">
                    Scrub to any moment in the video and click &quot;+ Add Chapter&quot; to bookmark scenes, cues, or rehearsal segments.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/40 border border-border/60 rounded-xl overflow-hidden bg-card max-h-[420px] overflow-y-auto">
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
                            ? 'bg-primary/10 border-l-4 border-l-primary'
                            : 'border-l-4 border-l-transparent hover:bg-muted/40'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleJumpToMarker(m.timestamp_seconds)}
                          className="flex items-center gap-3 min-w-0 text-left flex-1"
                        >
                          {/* Chapter Index / Status Indicator */}
                          <div className="w-6 h-6 rounded-md bg-muted border border-border/60 group-hover:border-primary/40 flex items-center justify-center shrink-0 transition-colors">
                            {isActive ? (
                              <Play className="w-3 h-3 text-primary fill-primary" />
                            ) : (
                              <span className="text-[10px] font-mono font-semibold text-muted-foreground group-hover:text-foreground">
                                {String(idx + 1).padStart(2, '0')}
                              </span>
                            )}
                          </div>

                          {/* Color Tag Indicator */}
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

                          {/* Title & Description */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                                {m.title}
                              </span>
                              {isActive && (
                                <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 font-mono">
                                  NOW PLAYING
                                </Badge>
                              )}
                            </div>
                            {m.description && (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{m.description}</p>
                            )}
                          </div>
                        </button>

                        {/* Timecode Badge & Action Buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant={isActive ? "default" : "secondary"}
                            onClick={() => handleJumpToMarker(m.timestamp_seconds)}
                            className="h-7 px-2.5 text-[11px] font-mono font-bold gap-1.5"
                            title="Jump to this time"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>{formatTime(m.timestamp_seconds || 0)}</span>
                          </Button>

                          {(isSMOrAdmin || isAdmin) && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteMarker(m.id)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Delete chapter"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="transcript" className="mt-0">
              {recordSubtitles.length === 0 ? (
                <div className="py-8 px-4 rounded-xl border border-dashed border-border/60 text-center bg-muted/10">
                  <FileText className="w-6 h-6 text-muted-foreground/60 mx-auto mb-2" />
                  <p className="text-xs text-foreground font-semibold">No dialogue lines transcribed for this take</p>
                  <p className="text-[11px] text-muted-foreground max-w-sm mx-auto mt-1 leading-relaxed">
                    Dialogue spoken during live broadcasts is captured by Malaysian Whisper and synchronized with video timestamps.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/40 border border-border/60 rounded-xl overflow-hidden bg-card max-h-[420px] overflow-y-auto">
                  {recordSubtitles
                    .filter((s) => !transcriptSearch.trim() || s.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
                    .map((sub, idx, arr) => {
                      const nextSub = arr[idx + 1];
                      const subStart = sub.start_seconds || 0;
                      const subEnd = sub.end_seconds ?? (nextSub?.start_seconds ?? subStart + 3.0);
                      const isCurrent = currentTime >= subStart && currentTime < subEnd;

                      const localTime = sub.created_at
                        ? new Date(sub.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : (selectedRecording?.created_at
                            ? new Date(new Date(selectedRecording.created_at).getTime() + (sub.start_seconds || 0) * 1000).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : '--:--:--');

                      return (
                        <div
                          key={sub.id || idx}
                          onClick={() => handleJumpToSubtitle(sub.start_seconds)}
                          className={`group px-3 py-1.5 transition-colors flex items-center justify-between gap-3 text-xs cursor-pointer ${
                            isCurrent
                              ? 'bg-primary/10 border-l-4 border-l-primary shadow-sm'
                              : 'border-l-4 border-l-transparent hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span
                              className={`shrink-0 flex items-center gap-1 font-mono text-[11px] select-none ${
                                isCurrent ? 'text-primary font-semibold' : 'text-muted-foreground group-hover:text-foreground'
                              }`}
                              title={`Video offset: ${formatTime(sub.start_seconds || 0)}`}
                            >
                              <Clock className="w-3 h-3 text-muted-foreground/70" />
                              <span>{localTime}</span>
                            </span>
                            <p
                              className={`leading-normal flex-1 break-words transition-colors flex items-center gap-1.5 ${
                                isCurrent ? 'text-primary font-semibold' : 'text-foreground font-medium group-hover:text-primary'
                              }`}
                            >
                              {sub.is_music && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-orange-500/15 border border-orange-500/40 text-orange-400 shrink-0">
                                  <Music className="w-2.5 h-2.5 text-orange-400 shrink-0" />
                                  <span>PERFORMANCE</span>
                                </span>
                              )}
                              <span>{sub.text}</span>
                            </p>
                            {isCurrent && (
                              <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 font-mono font-bold shrink-0">
                                PLAYING
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-[9px] uppercase font-mono px-1.5 py-0 text-muted-foreground shrink-0">
                              {sub.language || 'en'}
                            </Badge>
                            <Button
                              type="button"
                              size="icon"
                              variant={isCurrent ? "default" : "ghost"}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToSubtitle(sub.start_seconds);
                              }}
                              className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                              title="Jump video playback to this line"
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="script" className="mt-0">
              <ScriptTracker
                eventId={eventId}
                isSMOrAdmin={isSMOrAdmin}
                playbackTime={currentTime}
                playbackSubtitles={recordSubtitles}
                onSeek={(seconds) => handleJumpToSubtitle(seconds)}
                className="border-0 shadow-none bg-transparent rounded-none"
              />
            </TabsContent>
          </Tabs>
        </Card>
      )}

      {/* Recordings Archive List */}
      <Card className="p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Film className="w-4 h-4 text-primary" />
              <span>Event Video Takes & Recordings ({recordings.length})</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Saved fMP4 recordings automatically archived to persistent storage during live OBS streams.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadRecordings}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Disk</span>
          </Button>
        </div>

        {loading && recordings.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-muted-foreground">Loading recording archive...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <span>{error}</span>
          </div>
        ) : recordings.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-border/60 rounded-xl bg-muted/10">
            <Film className="w-10 h-10 text-muted-foreground/50 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-foreground">No recordings saved yet</h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 leading-relaxed">
              Start streaming from OBS with your event stream key. MediaMTX will automatically record and index completed takes here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40 border border-border/60 rounded-xl overflow-hidden bg-card">
            {recordings.map((rec) => {
              const isSelected = selectedRecording?.id === rec.id;
              const isEditing = editingId === rec.id;

              return (
                <div
                  key={rec.id}
                  className={cn(
                    "group px-3.5 py-2 transition-colors flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 text-xs",
                    isSelected
                      ? "bg-primary/10 border-l-4 border-l-primary shadow-sm"
                      : "border-l-4 border-l-transparent hover:bg-muted/30"
                  )}
                >
                  {/* Left: Quick Play button + Title / Rename */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Button
                      size="icon"
                      variant={isSelected ? "default" : "secondary"}
                      onClick={() => {
                        if (isSelected) {
                          if (rec.status !== 'failed' && rec.status !== 'missing') togglePlay();
                        } else {
                          setSelectedRecording(rec);
                          setAutoPlayNext(rec.status !== 'failed' && rec.status !== 'missing');
                        }
                      }}
                      className={cn(
                        "h-7 w-7 shrink-0",
                        rec.status === 'failed' && "border-red-500/40 text-red-400 hover:bg-red-500/10",
                        rec.status === 'missing' && "border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                      )}
                      title={
                        rec.status === 'missing'
                          ? 'Media file missing from storage'
                          : rec.status === 'failed'
                          ? 'Corrupted take (quarantined)'
                          : (isSelected ? (isPlaying ? 'Pause' : 'Resume Take') : 'Play Take')
                      }
                    >
                      {rec.status === 'missing' ? (
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                      ) : rec.status === 'failed' ? (
                        <AlertCircle className="w-3 h-3 text-red-400" />
                      ) : isSelected && isPlaying ? (
                        <Pause className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                    </Button>

                    {isEditing ? (
                      <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                        <Input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="h-7 text-xs flex-1"
                          autoFocus
                        />
                        <Button
                          size="icon"
                          variant="default"
                          onClick={() => handleSaveRename(rec.id)}
                          disabled={savingEdit}
                          className="h-7 w-7 shrink-0"
                          title="Save title"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              togglePlay();
                            } else {
                              setSelectedRecording(rec);
                              setAutoPlayNext(true);
                            }
                          }}
                          className={`font-semibold truncate hover:text-primary transition-colors text-left ${
                            isSelected ? 'text-primary' : 'text-foreground'
                          }`}
                          title={rec.title}
                        >
                          {formatFriendlyRecordingTitle(rec.title)}
                        </button>

                        {isSelected && (
                          <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4 font-mono font-bold shrink-0">
                            {isPlaying ? 'PLAYING' : 'SELECTED'}
                          </Badge>
                        )}

                        {isSMOrAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleStartRename(rec)}
                            className="h-6 w-6 opacity-40 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                            title="Rename recording"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Metadata + Action buttons */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground font-mono">
                      <div className="flex items-center gap-1" title="Recording Date">
                        <Calendar className="w-3 h-3 text-muted-foreground/70" />
                        <span>{formatFriendlyDate(rec.created_at)}</span>
                      </div>
                      {rec.duration_seconds > 0 && (
                        <>
                          <span className="text-border hidden sm:inline">•</span>
                          <div className="flex items-center gap-1 font-semibold text-foreground/80" title="Take Duration">
                            <Clock className="w-3 h-3 text-primary" />
                            <span>{formatTime(rec.duration_seconds)}</span>
                          </div>
                        </>
                      )}
                      <span className="text-border hidden sm:inline">•</span>
                      <div className="flex items-center gap-1 hidden sm:flex" title="File Size">
                        <HardDrive className="w-3 h-3 text-muted-foreground/70" />
                        <span>{formatFileSize(rec.file_size_bytes)}</span>
                      </div>
                      <Badge
                        variant={rec.status === 'ready' ? 'secondary' : rec.status === 'recording' ? 'destructive' : 'outline'}
                        className={cn(
                          "text-[9px] font-mono uppercase px-1.5 py-0 h-4 shrink-0 flex items-center gap-1",
                          rec.status === 'recording' && "bg-red-500/20 text-red-400 border-red-500/30",
                          rec.status === 'failed' && "bg-red-950/80 text-red-300 border-red-500/40 font-bold",
                          rec.status === 'missing' && "bg-amber-950/80 text-amber-300 border-amber-500/40 font-bold"
                        )}
                      >
                        {rec.status === 'recording' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                        )}
                        {rec.status === 'failed' && (
                          <AlertCircle className="w-2.5 h-2.5 text-red-400" />
                        )}
                        {rec.status === 'missing' && (
                          <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                        )}
                        <span>{rec.status === 'failed' ? 'CORRUPT' : rec.status === 'missing' ? 'MISSING' : rec.status.toUpperCase()}</span>
                      </Badge>
                      {rec.is_optimized && (
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold px-1.5 py-0 h-4 flex items-center gap-1 shrink-0">
                          <Zap className="w-2.5 h-2.5" />
                          <span>720p OPT</span>
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isSMOrAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOptimizeTake(rec.id)}
                          disabled={optimizingId === rec.id}
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          title={rec.is_optimized ? "Re-encode & optimize 720p web proxy" : "Encode 720p web proxy (~85% smaller)"}
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${rec.is_optimized ? 'text-emerald-400' : 'text-primary'} ${optimizingId === rec.id ? 'animate-spin' : ''}`} />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={isSelected ? "default" : "secondary"}
                        onClick={() => {
                          if (isSelected) {
                            togglePlay();
                          } else {
                            lastPlayedTimeRef.current = 0;
                            setSelectedRecording(rec);
                            setAutoPlayNext(true);
                          }
                        }}
                        className="h-7 px-2.5 text-xs font-semibold gap-1.5"
                      >
                        {isSelected && isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />}
                        <span>{isSelected ? (isPlaying ? 'Pause' : 'Resume') : 'Play'}</span>
                      </Button>

                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Download MP4"
                      >
                        <a
                          href={getAuthenticatedUrl(rec.download_url)}
                          download
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </Button>

                      {isAdmin && (
                        <>
                          {deletingId === rec.id ? (
                            <div className="flex items-center gap-1 bg-destructive/10 px-1.5 py-0.5 rounded-md border border-destructive/30">
                              <span className="text-[10px] text-destructive font-semibold">Delete?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDelete(rec.id)}
                                className="h-5 px-1.5 text-[10px] font-bold"
                              >
                                Yes
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeletingId(null)}
                                className="h-5 px-1.5 text-[10px]"
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeletingId(rec.id)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Delete recording"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
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
      </Card>

      {/* Add Chapter / Mark Dialog using shadcn/ui */}
      <Dialog open={showAddChapterModal} onOpenChange={setShowAddChapterModal}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-primary" />
              <span>Add Chapter Mark</span>
            </DialogTitle>
            <DialogDescription>
              Pin a cue point to the recording timeline.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateChapter} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                  Chapter / Cue Title *
                </label>
                <span className="text-[11px] font-mono text-primary font-bold">
                  @ {formatTime(chapterTime)}
                </span>
              </div>
              <Input
                type="text"
                value={chapterTitle}
                onChange={(e) => setChapterTitle(e.target.value)}
                placeholder="e.g. Act 1 Scene 2, Solo, Intermission"
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Optional Notes</label>
              <Input
                type="text"
                value={chapterDescription}
                onChange={(e) => setChapterDescription(e.target.value)}
                placeholder="Additional cues or notes..."
              />
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Quick Presets</label>
              <div className="flex flex-wrap gap-1.5">
                {['Scene 1', 'Scene 2', 'Solo Performance', 'Intermission', 'Key Cue', 'Finale'].map((preset) => (
                  <Button
                    type="button"
                    key={preset}
                    size="xs"
                    variant="outline"
                    onClick={() => setChapterTitle(preset)}
                    className="text-[10px]"
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            </div>

            {/* Color selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Pin Color</label>
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
                      chapterColor === c.id ? 'ring-2 ring-foreground scale-110' : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddChapterModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingChapter || !chapterTitle.trim()}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{savingChapter ? 'Saving...' : 'Pin Chapter'}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
