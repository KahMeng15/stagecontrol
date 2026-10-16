'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FileText,
  Sparkles,
  Upload,
  Play,
  Pause,
  Sliders,
  Maximize2,
  Minimize2,
  Search,
  Trash2,
  AlertCircle,
  Lightbulb,
  Music,
  CheckCircle2,
  Radio,
  FileCheck,
  ChevronDown,
  ArrowRight,
  RefreshCw,
  X,
  Volume2,
} from 'lucide-react';
import { api, getWebSocketUrl, ScriptItem, ScriptBlock, ScriptSection, SubtitleItem } from '@/lib/api';

interface ScriptTrackerProps {
  eventId: string;
  isSMOrAdmin: boolean;
  className?: string;
  onBlockSelect?: (block: ScriptBlock) => void;
}

// Client-side fuzzy text normalization
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 3 || b.length < 3) return 0.0;
  const pairsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) pairsA.add(a.slice(i, i + 2));
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    if (pairsA.has(b.slice(i, i + 2))) hits++;
  }
  return (2.0 * hits) / (a.length - 1 + b.length - 1);
}

// Client-side similarity calculation with wildcard tolerance
function computeSimilarity(spoken: string, dialogue: string): number {
  const normSpk = normalizeText(spoken);
  const normDiag = normalizeText(dialogue);
  if (!normSpk || !normDiag) return 0;

  const spkWords = normSpk.split(' ').filter((w) => w.length > 1);
  const diagWords = normDiag.split(' ').filter((w) => w.length > 1);
  if (spkWords.length === 0 || diagWords.length === 0) return 0;

  const spkLen = spkWords.length;
  const diagLen = diagWords.length;

  // Whole-phrase word boundary match
  const escapedSpk = normSpk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const spkPattern = new RegExp(`(?:\\b|^)${escapedSpk}(?:\\b|$)`, 'i');
  if (spkLen >= 3 && spkPattern.test(normDiag)) return 0.95;

  const escapedDiag = normDiag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const diagPattern = new RegExp(`(?:\\b|^)${escapedDiag}(?:\\b|$)`, 'i');
  if (diagLen >= 3 && diagPattern.test(normSpk)) return 0.90;

  // Short line guard: prevent a long sentence from matching "No..." or "I wish!"
  if (diagLen <= 2 && spkLen > 3) return 0.0;

  // Word-level fuzzy containment
  let matchedSpk = 0.0;
  for (const sw of spkWords) {
    let bestW = 0.0;
    for (const dw of diagWords) {
      if (sw === dw) {
        bestW = 1.0;
        break;
      } else if (sw.length >= 4 && dw.length >= 4) {
        const sim = wordRatio(sw, dw);
        if (sim >= 0.75) bestW = Math.max(bestW, sim);
      }
    }
    if (bestW >= 0.75) matchedSpk += bestW;
  }

  const containment = matchedSpk / spkLen;

  // Sliding window similarity
  let bestWindow = 0.0;
  if (diagLen > spkLen + 2) {
    for (let i = 0; i <= diagLen - spkLen; i++) {
      const windowWords = diagWords.slice(i, i + spkLen + 2);
      let winHits = 0;
      for (const sw of spkWords) {
        if (windowWords.includes(sw)) {
          winHits += 1.0;
        } else if (sw.length >= 4) {
          if (windowWords.some((ww) => ww.length >= 4 && wordRatio(sw, ww) >= 0.72)) {
            winHits += 0.85;
          }
        }
      }
      const ratio = winHits / spkLen;
      if (ratio > bestWindow) bestWindow = ratio;
    }
  } else {
    let hits = 0;
    for (const sw of spkWords) {
      if (diagWords.includes(sw)) {
        hits += 1.0;
      } else if (sw.length >= 4) {
        if (diagWords.some((dw) => dw.length >= 4 && wordRatio(sw, dw) >= 0.72)) {
          hits += 0.85;
        }
      }
    }
    bestWindow = hits / Math.max(spkLen, diagLen);
  }

  return Math.max(containment * 0.80 + bestWindow * 0.20, bestWindow);
}

// Distinct speaker avatar colors
const SPEAKER_COLORS: Record<string, string> = {
  caitlyn: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  cait: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  'hang tuah': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'hang jebat': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  sultan: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  puteri: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  narrator: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  bendahara: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
};

function getSpeakerColor(speaker?: string | null): string {
  if (!speaker) return 'bg-slate-700/30 text-slate-300 border-slate-600/30';
  const lower = speaker.toLowerCase().trim();
  for (const key of Object.keys(SPEAKER_COLORS)) {
    if (lower.includes(key)) return SPEAKER_COLORS[key];
  }
  return 'bg-blue-600/20 text-blue-300 border-blue-500/30';
}

function getCueType(cue?: string | null): 'lighting' | 'audio' | 'stage' | 'none' {
  if (!cue) return 'none';
  const c = cue.toLowerCase();
  if (c.includes('light') || c.includes('spotlight') || c.includes('red') || c.includes('white') || c.includes('blue')) {
    return 'lighting';
  }
  if (c.includes('audio') || c.includes('music') || c.includes('song') || c.includes('anthem') || c.includes('sound')) {
    return 'audio';
  }
  return 'stage';
}

export default function ScriptTracker({
  eventId,
  isSMOrAdmin,
  className = '',
  onBlockSelect,
}: ScriptTrackerProps) {
  const [script, setScript] = useState<ScriptItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [lastMatchedSpoken, setLastMatchedSpoken] = useState<string | null>(null);

  // Settings
  const [autoFollow, setAutoFollow] = useState(true);
  const [speechSyncEnabled, setSpeechSyncEnabled] = useState(true);
  const [wildcardThreshold, setWildcardThreshold] = useState(65); // 65% match default
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('all');
  const [teleprompterMode, setTeleprompterMode] = useState(false);

  // Import Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTab, setImportTab] = useState<'file' | 'text'>('file');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importText, setImportText] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Active block ref for smooth scroll
  const activeBlockRef = useRef<HTMLDivElement | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Fetch active script
  const fetchScript = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getScript(eventId);
      setScript(data);
      if (data && data.active_block_id) {
        setActiveBlockId(data.active_block_id);
      } else if (data && data.sections?.[0]?.blocks?.[0]) {
        setActiveBlockId(data.sections[0].blocks[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch event script:', err);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchScript();
  }, [fetchScript]);

  // Flatten all blocks for fast lookup
  const allBlocks = useMemo(() => {
    if (!script) return [];
    const list: ScriptBlock[] = [];
    for (const sec of script.sections) {
      for (const blk of sec.blocks) {
        list.push(blk);
      }
    }
    return list;
  }, [script]);

  // Persistent refs so WebSocket listener does not re-open/teardown on line change
  const activeBlockIdRef = useRef(activeBlockId);
  activeBlockIdRef.current = activeBlockId;

  const speechSyncEnabledRef = useRef(speechSyncEnabled);
  speechSyncEnabledRef.current = speechSyncEnabled;

  const wildcardThresholdRef = useRef(wildcardThreshold);
  wildcardThresholdRef.current = wildcardThreshold;

  const allBlocksRef = useRef(allBlocks);
  allBlocksRef.current = allBlocks;

  const selectedSectionIdRef = useRef(selectedSectionId);
  selectedSectionIdRef.current = selectedSectionId;

  // Track timestamp of last matched block to implement anti-jump cooldown
  const lastMatchTimeRef = useRef<number>(Date.now());

  // WebSocket Listener for real-time speech matching and sync (stays connected permanently)
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

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Server-broadcasted script position jump or sync
            if (data.type === 'script_sync' || data.type === 'script_jump') {
              if (data.block_id) {
                setActiveBlockId(data.block_id);
                lastMatchTimeRef.current = Date.now();
                if (data.confidence) setLastConfidence(data.confidence);
                if (data.spoken_text) setLastMatchedSpoken(data.spoken_text);

                // Auto-expand/switch section filter if the jumped block is in another section
                const targetBlock = allBlocksRef.current.find((b) => b.id === data.block_id);
                if (targetBlock && selectedSectionIdRef.current !== 'all' && selectedSectionIdRef.current !== targetBlock.section_id) {
                  setSelectedSectionId('all');
                }
              }
            } else if (data.type === 'script_updated') {
              fetchScript();
            } else if (data.type === 'script_deleted') {
              setScript(null);
              setActiveBlockId(null);
            } else if (data.type === 'subtitle') {
              // Real-time client-side fuzzy match with anti-jump cooldown:
              // 1. Search local window (±5 lines).
              // 2. If no local line matches, only search globally across all lines if >= 3.0s has passed since last match.
              const currentBlocks = allBlocksRef.current;
              const isSyncOn = speechSyncEnabledRef.current;
              const spoken = data.text;

              if (isSyncOn && currentBlocks.length > 0 && spoken && spoken.split(' ').length >= 2) {
                const thresholdFraction = wildcardThresholdRef.current / 100.0;
                const now = Date.now();
                const timeSinceLastMatch = (now - lastMatchTimeRef.current) / 1000.0;

                const currBlockId = activeBlockIdRef.current;
                const currIdx = currentBlocks.findIndex((b) => b.id === currBlockId);

                // Step 1: Check Local Window (±5 lines around current position)
                let bestLocalMatch: ScriptBlock | null = null;
                let bestLocalScore = 0;

                if (currIdx >= 0) {
                  const startIdx = Math.max(0, currIdx - 5);
                  const endIdx = Math.min(currentBlocks.length - 1, currIdx + 5);

                  for (let i = startIdx; i <= endIdx; i++) {
                    const blk = currentBlocks[i];
                    if (!blk.dialogue) continue;

                    let score = computeSimilarity(spoken, blk.dialogue);
                    const diff = blk.order_index - currIdx;
                    if (diff >= 0 && diff <= 2) score += 0.06;
                    else if (diff >= 3 && diff <= 5) score += 0.03;
                    else if (diff >= -2 && diff < 0) score += 0.02;

                    if (score > bestLocalScore) {
                      bestLocalScore = score;
                      bestLocalMatch = blk;
                    }
                  }

                  if (bestLocalMatch && bestLocalScore >= thresholdFraction) {
                    setActiveBlockId(bestLocalMatch.id);
                    setLastConfidence(Math.min(1.0, bestLocalScore));
                    setLastMatchedSpoken(spoken);
                    lastMatchTimeRef.current = Date.now();

                    if (selectedSectionIdRef.current !== 'all' && selectedSectionIdRef.current !== bestLocalMatch.section_id) {
                      setSelectedSectionId('all');
                    }
                    return;
                  }

                  // If no local line matched and less than 3 seconds have passed, DO NOT jump globally
                  if (timeSinceLastMatch < 3.0) {
                    return;
                  }
                }

                // Step 2: Global Fallback (only triggered after 3s without local match or if starting fresh)
                let bestGlobalMatch: ScriptBlock | null = null;
                let bestGlobalScore = 0;
                const distantThreshold = Math.max(thresholdFraction, 0.70); // Require solid match for scene jumps

                for (let i = 0; i < currentBlocks.length; i++) {
                  const blk = currentBlocks[i];
                  if (!blk.dialogue) continue;

                  const score = computeSimilarity(spoken, blk.dialogue);
                  if (score > bestGlobalScore) {
                    bestGlobalScore = score;
                    bestGlobalMatch = blk;
                  }
                }

                if (bestGlobalMatch && bestGlobalScore >= distantThreshold) {
                  setActiveBlockId(bestGlobalMatch.id);
                  setLastConfidence(Math.min(1.0, bestGlobalScore));
                  setLastMatchedSpoken(spoken);
                  lastMatchTimeRef.current = Date.now();

                  if (selectedSectionIdRef.current !== 'all' && selectedSectionIdRef.current !== bestGlobalMatch.section_id) {
                    setSelectedSectionId('all');
                  }
                }
              }
            }
          } catch (e) {
            console.error('Error handling WebSocket message:', e);
          }
        };

        ws.onopen = () => {
          console.log('[ScriptTracker] Connected to live script & speech sync channel');
        };

        ws.onerror = () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
        };

        ws.onclose = () => {
          if (!isDisposed) {
            reconnectTimer = setTimeout(connectWebSocket, 3000);
          }
        };
      } catch (err) {
        console.error('Failed to connect script sync WebSocket:', err);
        if (!isDisposed) {
          reconnectTimer = setTimeout(connectWebSocket, 3000);
        }
      }
    };

    connectWebSocket();

    return () => {
      isDisposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => {
            try {
              ws?.close();
            } catch {}
          };
        }
      }
    };
  }, [eventId, fetchScript]);

  // Smooth auto-scroll directly inside the script container
  useEffect(() => {
    if (autoFollow && activeBlockRef.current && listContainerRef.current) {
      const container = listContainerRef.current;
      const element = activeBlockRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const relativeTop = elementRect.top - containerRect.top;
      const targetScrollTop =
        container.scrollTop + relativeTop - container.clientHeight / 2 + elementRect.height / 2;
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: 'smooth',
      });
    }
  }, [activeBlockId, autoFollow]);

  // Jump to specific block manually
  const handleJumpToBlock = async (block: ScriptBlock) => {
    setActiveBlockId(block.id);
    lastMatchTimeRef.current = Date.now();
    onBlockSelect?.(block);
    if (isSMOrAdmin) {
      try {
        await api.jumpScriptBlock(eventId, block.id);
      } catch (err) {
        console.error('Failed to broadcast script jump:', err);
      }
    }
  };

  // Find active block & upcoming cues
  const activeIndex = useMemo(() => {
    if (!activeBlockId) return -1;
    return allBlocks.findIndex((b) => b.id === activeBlockId);
  }, [allBlocks, activeBlockId]);

  const activeBlock = activeIndex >= 0 ? allBlocks[activeIndex] : null;

  const upcomingCues = useMemo(() => {
    if (activeIndex < 0) return [];
    const cues: Array<{ block: ScriptBlock; distance: number; type: 'lighting' | 'audio' | 'stage' | 'none' }> = [];
    for (let i = activeIndex; i < Math.min(allBlocks.length, activeIndex + 8); i++) {
      const blk = allBlocks[i];
      if (blk.cue && blk.cue.trim()) {
        cues.push({
          block: blk,
          distance: i - activeIndex,
          type: getCueType(blk.cue),
        });
      }
    }
    return cues;
  }, [allBlocks, activeIndex]);

  // Filtered blocks for display
  const displayBlocks = useMemo(() => {
    if (!script) return [];

    let filtered = allBlocks;

    // Filter by section
    if (selectedSectionId !== 'all') {
      filtered = filtered.filter((b) => b.section_id === selectedSectionId);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          (b.speaker && b.speaker.toLowerCase().includes(q)) ||
          (b.dialogue && b.dialogue.toLowerCase().includes(q)) ||
          (b.cue && b.cue.toLowerCase().includes(q))
      );
    }

    return filtered;
  }, [script, allBlocks, selectedSectionId, searchQuery]);

  // Handle docx / file upload
  const handleUploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;

    try {
      setIsImporting(true);
      setImportError(null);
      const res = await api.uploadScriptFile(eventId, importFile, importTitle);
      setScript(res);
      if (res.sections?.[0]?.blocks?.[0]) {
        setActiveBlockId(res.sections[0].blocks[0].id);
      }
      setIsImportModalOpen(false);
      setImportFile(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import script');
    } finally {
      setIsImporting(false);
    }
  };

  // Handle raw text paste import
  const handleImportRawText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;

    try {
      setIsImporting(true);
      setImportError(null);
      const res = await api.importScriptText(eventId, importText, importTitle);
      setScript(res);
      if (res.sections?.[0]?.blocks?.[0]) {
        setActiveBlockId(res.sections[0].blocks[0].id);
      }
      setIsImportModalOpen(false);
      setImportText('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import text');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteScript = async () => {
    if (!confirm('Are you sure you want to remove the current script?')) return;
    try {
      await api.deleteScript(eventId);
      setScript(null);
      setActiveBlockId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete script');
    }
  };

  return (
    <div
      className={`bg-[#11141f] border border-[#1e2638] rounded-2xl flex flex-col shadow-xl overflow-hidden ${
        teleprompterMode ? 'fixed inset-4 z-50 bg-[#090b10] border-blue-500/50' : className
      }`}
    >
      {/* Header Bar */}
      <div className="p-4 border-b border-[#1e2638] bg-[#0c0e16] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-600/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100">
                {script ? script.title : 'Live Script & Cue Tracker'}
              </h3>
              {script && (
                <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-mono font-semibold">
                  v{script.version} • {script.total_blocks} lines
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>Speech-to-Script Wildcard Sync (~{wildcardThreshold}% tolerance)</span>
              {lastConfidence && (
                <span className="text-emerald-400 font-mono font-medium">
                  • 🎯 {Math.round(lastConfidence * 100)}% match
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Auto-Follow Toggle */}
          <button
            onClick={() => setAutoFollow(!autoFollow)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-colors ${
              autoFollow
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title={autoFollow ? 'Auto-scroll enabled' : 'Auto-scroll paused'}
          >
            {autoFollow ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Auto-Follow</span>
          </button>

          {/* AI Speech Sync Toggle */}
          <button
            onClick={() => setSpeechSyncEnabled(!speechSyncEnabled)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-colors ${
              speechSyncEnabled
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Live Speech-to-Script Auto-Sync"
          >
            <Sparkles className={`w-3.5 h-3.5 ${speechSyncEnabled ? 'animate-pulse text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">{speechSyncEnabled ? 'AI Sync Active' : 'AI Sync Off'}</span>
          </button>

          {/* Teleprompter Fullscreen Mode */}
          <button
            onClick={() => setTeleprompterMode(!teleprompterMode)}
            className={`p-1.5 rounded-xl border transition-colors ${
              teleprompterMode
                ? 'bg-purple-600 border-purple-500 text-white'
                : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title={teleprompterMode ? 'Exit Fullscreen Teleprompter' : 'Presenter / Teleprompter Mode'}
          >
            {teleprompterMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Import Button */}
          {isSMOrAdmin && (
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-purple-600/20 transition-all"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Script</span>
            </button>
          )}

          {/* Delete Script */}
          {script && isSMOrAdmin && (
            <button
              onClick={handleDeleteScript}
              className="p-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
              title="Delete active script"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter & Sensitivity Controls Sub-bar */}
      {script && (
        <div className="px-4 py-2 bg-[#090b10] border-b border-[#1e2638] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search lines, speakers, or cues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#11141f] border border-[#1e2638] rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Scene/Act Selector */}
            {script.sections.length > 1 && (
              <select
                value={selectedSectionId}
                onChange={(e) => setSelectedSectionId(e.target.value)}
                className="bg-[#11141f] border border-[#1e2638] rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-purple-500"
              >
                <option value="all">All Scenes ({script.sections.length})</option>
                {script.sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    {sec.title} ({sec.blocks.length})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Wildcard Tolerance Slider */}
          <div className="flex items-center gap-2 text-slate-400">
            <Sliders className="w-3.5 h-3.5 text-purple-400" />
            <span>Wildcard:</span>
            <input
              type="range"
              min="50"
              max="95"
              step="5"
              value={wildcardThreshold}
              onChange={(e) => setWildcardThreshold(Number(e.target.value))}
              className="w-20 accent-purple-500 cursor-pointer"
              title={`Wildcard tolerance: ${wildcardThreshold}% match required`}
            />
            <span className="font-mono text-purple-300 text-[11px] font-semibold">
              {wildcardThreshold}%
            </span>
          </div>
        </div>
      )}

      {/* Upcoming Cues Alert Banner for Technical Crew */}
      {upcomingCues.length > 0 && (
        <div className="px-4 py-2.5 bg-gradient-to-r from-purple-950/40 via-blue-950/30 to-[#0c0e16] border-b border-purple-500/20 flex items-center gap-3 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold uppercase tracking-wider shrink-0">
            <Radio className="w-3.5 h-3.5 animate-pulse text-purple-400" />
            <span>Upcoming Cues:</span>
          </div>

          <div className="flex items-center gap-2 flex-1 overflow-x-auto">
            {upcomingCues.slice(0, 3).map((item, idx) => (
              <div
                key={item.block.id}
                onClick={() => handleJumpToBlock(item.block)}
                className={`cursor-pointer px-2.5 py-1 rounded-lg border text-xs flex items-center gap-2 shrink-0 transition-transform hover:scale-105 ${
                  item.type === 'lighting'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : item.type === 'audio'
                    ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                }`}
              >
                {item.type === 'lighting' ? (
                  <Lightbulb className="w-3 h-3 text-amber-400" />
                ) : item.type === 'audio' ? (
                  <Music className="w-3 h-3 text-purple-400" />
                ) : (
                  <FileText className="w-3 h-3 text-emerald-400" />
                )}
                <span className="font-semibold">
                  {item.distance === 0 ? 'NOW' : `In ${item.distance} line${item.distance > 1 ? 's' : ''}`}:
                </span>
                <span className="truncate max-w-[180px] font-mono">{item.block.cue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Script Lines Content Container */}
      <div
        ref={listContainerRef}
        className={`relative flex-1 overflow-y-auto p-4 space-y-3 ${
          teleprompterMode ? 'max-h-full px-8 py-6' : 'max-h-[550px]'
        }`}
      >
        {loading ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-400">Loading synchronized script...</span>
          </div>
        ) : !script ? (
          <div className="py-16 text-center border border-dashed border-[#1e2638] rounded-2xl flex flex-col items-center justify-center p-6">
            <div className="w-12 h-12 rounded-2xl bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
              <FileText className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-slate-200">No script loaded</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
              Import a Word (.docx) document or paste raw text to enable real-time speech synchronization,
              speaker line tracking, and technical cue alerts.
            </p>

            {isSMOrAdmin && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-purple-600/25 transition-all"
                >
                  <Upload className="w-4 h-4" />
                  <span>Import Script Document (.docx)</span>
                </button>
              </div>
            )}
          </div>
        ) : displayBlocks.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            No lines match your search filter "{searchQuery}".
          </div>
        ) : (
          displayBlocks.map((block) => {
            const isActive = block.id === activeBlockId;
            const cueType = getCueType(block.cue);

            return (
              <div
                key={block.id}
                ref={isActive ? activeBlockRef : null}
                onClick={() => handleJumpToBlock(block)}
                className={`relative rounded-xl border p-3.5 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-950/25 border-emerald-500/80 shadow-lg shadow-emerald-500/10 scale-[1.01]'
                    : 'bg-[#0f121b] border-[#1e2638] hover:border-slate-600/50 hover:bg-[#141824]'
                }`}
              >
                {/* Active Indicator & Line Number */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-[10px] uppercase tracking-wider animate-pulse">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        ON STAGE
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-slate-500">
                        #{block.order_index + 1}
                      </span>
                    )}

                    {/* Speaker Chip */}
                    {block.speaker && (
                      <span
                        className={`px-2.5 py-0.5 rounded-md border text-xs font-semibold capitalize ${getSpeakerColor(
                          block.speaker
                        )}`}
                      >
                        {block.speaker}
                      </span>
                    )}
                  </div>

                  {/* Technical Cue Badges */}
                  <div className="flex items-center gap-2">
                    {block.cue && (
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-xs font-mono font-medium ${
                          cueType === 'lighting'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                            : cueType === 'audio'
                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        }`}
                      >
                        {cueType === 'lighting' ? (
                          <Lightbulb className="w-3 h-3 text-amber-400 shrink-0" />
                        ) : cueType === 'audio' ? (
                          <Music className="w-3 h-3 text-purple-400 shrink-0" />
                        ) : (
                          <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
                        )}
                        <span>{block.cue}</span>
                      </span>
                    )}

                    {isSMOrAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleJumpToBlock(block);
                        }}
                        className="opacity-0 group-hover:opacity-100 hover:opacity-100 px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-[10px] text-blue-300 transition-opacity"
                        title="Jump here & broadcast to all crew"
                      >
                        Jump
                      </button>
                    )}
                  </div>
                </div>

                {/* Spoken Dialogue Text */}
                {block.dialogue ? (
                  <p
                    className={`leading-relaxed ${
                      teleprompterMode
                        ? 'text-xl sm:text-2xl font-semibold'
                        : 'text-sm sm:text-base'
                    } ${isActive ? 'text-slate-100 font-medium' : 'text-slate-300'}`}
                  >
                    {block.dialogue}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 italic">[Stage direction / Musical interlude]</p>
                )}

                {/* Notes if any */}
                {block.notes && (
                  <p className="text-xs text-slate-400 mt-1.5 border-t border-slate-800/80 pt-1">
                    📝 {block.notes}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Teleprompter Mode Active Bottom Banner */}
      {teleprompterMode && activeBlock && (
        <div className="p-4 bg-[#0c0e16] border-t border-[#1e2638] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-sm font-bold text-slate-200">
              Current Speaker: <strong className="text-emerald-400">{activeBlock.speaker || 'Stage'}</strong>
            </span>
            {activeBlock.cue && (
              <span className="text-xs text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-mono">
                CUE: {activeBlock.cue}
              </span>
            )}
          </div>
          <button
            onClick={() => setTeleprompterMode(false)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold"
          >
            Exit Teleprompter
          </button>
        </div>
      )}

      {/* Script Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl max-w-xl w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setIsImportModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#1a2030]"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-purple-600/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">Import Stage Script</h3>
                <p className="text-xs text-slate-400">
                  Import Word table (.docx) or paste raw text to enable synchronized tracking.
                </p>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center gap-2 border-b border-[#1e2638] pb-3 mb-4">
              <button
                type="button"
                onClick={() => setImportTab('file')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  importTab === 'file'
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Upload Word (.docx) / File
              </button>
              <button
                type="button"
                onClick={() => setImportTab('text')}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  importTab === 'text'
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Paste Raw Text / TSV
              </button>
            </div>

            {importError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            {/* Tab 1: File Upload */}
            {importTab === 'file' && (
              <form onSubmit={handleUploadFile} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Script Title <span className="text-slate-500 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                    placeholder="e.g. Stage Script (defaults to filename if blank)"
                    className="w-full bg-[#090b10] border border-[#1e2638] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Word File (.docx) or Text Script (.txt, .tsv)
                  </label>
                  <div className="border-2 border-dashed border-[#1e2638] rounded-xl p-6 text-center hover:border-purple-500/50 transition-colors">
                    <input
                      type="file"
                      id="script-file-upload"
                      accept=".docx,.doc,.txt,.tsv,.csv"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setImportFile(file);
                        if (file && !importTitle) {
                          setImportTitle(file.name.replace(/\.[^/.]+$/, ''));
                        }
                      }}
                      className="hidden"
                    />
                    <label
                      htmlFor="script-file-upload"
                      className="cursor-pointer flex flex-col items-center justify-center gap-2"
                    >
                      <FileCheck className="w-8 h-8 text-purple-400" />
                      <span className="text-xs text-slate-200 font-medium">
                        {importFile ? importFile.name : 'Click to select Word (.docx) file'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Supports 3-column stage tables (Speaker, Technical Notes, Dialogue Lines)
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!importFile || isImporting}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    {isImporting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Parsing Document...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload & Parse</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Tab 2: Raw Text Paste */}
            {importTab === 'text' && (
              <form onSubmit={handleImportRawText} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Script Title
                  </label>
                  <input
                    type="text"
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                    placeholder="e.g. Rehearsal Script"
                    className="w-full bg-[#090b10] border border-[#1e2638] rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Paste Script Text or TSV Table
                  </label>
                  <textarea
                    rows={8}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={`Paste here! Supported formats:\n1. Tab-delimited (copy from Excel/Word table): Speaker [tab] Technical Cue [tab] Dialogue\n2. Script dialogue: Speaker: Spoken line [SPOTLIGHT ON EMCEE]\n3. Plain dialogue lines`}
                    className="w-full bg-[#090b10] border border-[#1e2638] rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!importText.trim() || isImporting}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                  >
                    {isImporting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Importing...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Parse & Save Script</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
