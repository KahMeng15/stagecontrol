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

interface ScriptTrackerProps {
  eventId: string;
  isSMOrAdmin: boolean;
  className?: string;
  onBlockSelect?: (block: ScriptBlock) => void;
  // Recording playback mode props
  playbackTime?: number;
  playbackSubtitles?: SubtitleItem[];
  onSeek?: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Strict music/performance check: differentiates spoken dialogue from musical acts
function isMusicPerformance(text?: string | null, isMusicFlag?: boolean | null): boolean {
  if (isMusicFlag) return true;
  if (!text) return false;
  const trimmed = text.trim();
  // Explicit musical tags like [Music], [Singing], [Song], [Instrumental], etc.
  if (/^(\[|\(|\{)\s*(music|singing|song|instrumental|live music|choir|band|performance)\s*(\]|\)|\})/i.test(trimmed)) {
    return true;
  }
  if (/[\u266a\u266b\u2669\u266c♪♫♩♬🎶♭♯]/.test(trimmed)) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  const musicHallucinations = [
    'thanks for watching',
    'thank you for watching',
    'chopin',
    'to this dream',
    'down your face',
    'stuck in reverse',
    'try to fix you',
  ];
  if (musicHallucinations.some((h) => lower.includes(h))) {
    return true;
  }
  return false;
}

function isPerformanceBlock(blk?: ScriptBlock | null): boolean {
  if (!blk) return false;
  const cue = (blk.cue || '').toLowerCase();
  const diag = (blk.dialogue || '').toLowerCase();
  const speaker = (blk.speaker || '').toLowerCase();

  const cueSpeaker = `${cue} ${speaker}`;
  const cuePattern = /\b(audio|music|song|songs|track|tracks|soundtrack|soundtracks|playback|singing|sing|band|choir|anthem|dance|dancing|performance|dikir|silat|walk-in|video|montage|instrumental)\b/i;
  if (cuePattern.test(cueSpeaker)) {
    return true;
  }

  const diagPattern = /\b(dance|dancing|song|songs|singing|anthem|dikir|silat|walk-in|soundtrack)\b/i;
  if (diag && diagPattern.test(diag)) {
    if (speaker && diag.length > 40) {
      return false;
    }
    return true;
  }

  return false;
}

function getPerformanceName(blk?: ScriptBlock | null): string {
  if (!blk) return 'Musical Performance / Song Active';
  const cue = blk.cue?.trim();
  const diag = blk.dialogue?.trim();
  if (cue && /\b(dance|song|music|soundtrack|audio|anthem|performance|playback|video|tribute)\b/i.test(cue)) {
    return cue;
  }
  if (diag && /\b(dance|song|singing|performance|walk-in|video|tribute)\b/i.test(diag)) {
    return diag;
  }
  return cue || diag || 'Live Song / Performance Active';
}

// Client-side fuzzy text normalization
function normalizeText(text: string, stripActions: boolean = false): string {
  if (!text) return '';
  let cleaned = text;
  if (stripActions) {
    // Strip stage directions and actor actions in brackets: [Groans], (pause), {applause}
    cleaned = cleaned.replace(/\[.*?\]|\(.*?\)|{.*?}/g, ' ');
  }
  return cleaned
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA < 3 || lenB < 3 || Math.abs(lenA - lenB) > 3) return 0.0;
  let hits = 0;
  const maxPairs = lenA - 1;
  for (let i = 0; i < maxPairs; i++) {
    const p = a.slice(i, i + 2);
    if (b.includes(p)) hits++;
  }
  return (2.0 * hits) / (lenA - 1 + lenB - 1);
}

// Fast substring & keyword pre-filter to reject non-matching blocks in sub-microseconds
function quickOverlap(spkWords: string[], targetText: string): boolean {
  if (!targetText || spkWords.length === 0) return false;
  const lower = targetText.toLowerCase();
  for (let i = 0; i < spkWords.length; i++) {
    const w = spkWords[i];
    if (w.length >= 3 && lower.includes(w)) {
      return true;
    }
  }
  return false;
}

// Client-side similarity calculation with wildcard tolerance (optimized for 60fps event loop)
function computeSimilarity(
  spoken: string,
  dialogue: string,
  preNormSpk?: string,
  preSpkWords?: string[]
): number {
  const normSpk = preNormSpk || normalizeText(spoken, false);
  let normDiag = normalizeText(dialogue, true);
  if (!normDiag) {
    normDiag = normalizeText(dialogue, false);
  }
  if (!normSpk || !normDiag) return 0;

  const spkWords = preSpkWords || normSpk.split(' ').filter((w) => w.length > 1);
  const diagWords = normDiag.split(' ').filter((w) => w.length > 1);
  if (spkWords.length === 0 || diagWords.length === 0) return 0;

  const spkLen = spkWords.length;
  const diagLen = diagWords.length;

  // Whole-phrase word containment match
  if (spkLen >= 3 && normDiag.includes(normSpk)) return 0.95;
  if (diagLen >= 3 && normSpk.includes(normDiag)) return 0.90;

  // Short line guard: prevent a long sentence from matching "No..." or "I wish!"
  if (diagLen <= 2 && spkLen > 3) return 0.0;

  // Word-level fuzzy containment
  let matchedSpk = 0.0;
  for (let i = 0; i < spkWords.length; i++) {
    const sw = spkWords[i];
    let bestW = 0.0;
    for (let j = 0; j < diagWords.length; j++) {
      const dw = diagWords[j];
      if (sw === dw) {
        bestW = 1.0;
        break;
      } else if (sw.length >= 4 && dw.length >= 4) {
        const sim = wordRatio(sw, dw);
        if (sim >= 0.75) {
          bestW = Math.max(bestW, sim);
        }
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
      for (let s = 0; s < spkWords.length; s++) {
        const sw = spkWords[s];
        if (windowWords.includes(sw)) {
          winHits += 1.0;
        } else if (sw.length >= 4) {
          for (let w = 0; w < windowWords.length; w++) {
            const ww = windowWords[w];
            if (ww.length >= 4 && wordRatio(sw, ww) >= 0.72) {
              winHits += 0.85;
              break;
            }
          }
        }
      }
      const ratio = winHits / spkLen;
      if (ratio > bestWindow) bestWindow = ratio;
    }
  } else {
    let hits = 0;
    for (let s = 0; s < spkWords.length; s++) {
      const sw = spkWords[s];
      if (diagWords.includes(sw)) {
        hits += 1.0;
      } else if (sw.length >= 4) {
        for (let d = 0; d < diagWords.length; d++) {
          const dw = diagWords[d];
          if (dw.length >= 4 && wordRatio(sw, dw) >= 0.72) {
            hits += 0.85;
            break;
          }
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

interface DialogueContentProps {
  text?: string | null;
  isActive: boolean;
  teleprompterMode: boolean;
}

function DialogueContent({ text, isActive, teleprompterMode }: DialogueContentProps) {
  const segments = useMemo(() => {
    if (!text) return [];
    // Split by bracketed stage directions or actions: [ ... ], ( ... ), { ... }
    const parts = text.split(/(\[[^\]]+\]|\([^\)]+\)|\{[^\}]+\})/g);
    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => {
        const isAction =
          (p.startsWith('[') && p.endsWith(']')) ||
          (p.startsWith('(') && p.endsWith(')')) ||
          (p.startsWith('{') && p.endsWith('}'));
        return { text: p, isAction };
      });
  }, [text]);

  if (segments.length === 0) {
    return <p className="text-xs text-slate-500 italic">[Stage direction / Musical interlude]</p>;
  }

  return (
    <div className="space-y-1">
      {segments.map((seg, idx) => {
        if (seg.isAction) {
          return (
            <div key={idx} className="my-0.5">
              <span
                className={`font-mono inline-flex items-center px-2 py-0.5 rounded border text-[11px] tracking-wide select-none max-w-full break-words whitespace-normal ${
                  isActive
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 font-semibold shadow-sm shadow-amber-500/10'
                    : 'bg-slate-800/80 border-slate-700/80 text-amber-400/90'
                } ${teleprompterMode ? 'text-sm sm:text-base px-3 py-1' : ''}`}
              >
                <span className="font-mono break-words whitespace-normal">{seg.text}</span>
              </span>
            </div>
          );
        }

        return (
          <p
            key={idx}
            className={`leading-normal ${
              teleprompterMode
                ? 'text-xl sm:text-2xl font-semibold'
                : 'text-sm'
            } ${isActive ? 'text-slate-100 font-medium' : 'text-slate-300'}`}
          >
            {seg.text}
          </p>
        );
      })}
    </div>
  );
}

export default function ScriptTracker({
  eventId,
  isSMOrAdmin,
  className = '',
  onBlockSelect,
  playbackTime,
  playbackSubtitles,
  onSeek,
}: ScriptTrackerProps) {
  const isPlaybackMode = playbackTime !== undefined;
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
  const [isMusicActive, setIsMusicActive] = useState(false);
  const [activePerformanceName, setActivePerformanceName] = useState<string | null>(null);
  const musicTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // Map subtitle timestamps to script blocks in recording mode
  const blockTimestamps = useMemo(() => {
    if (!isPlaybackMode || !playbackSubtitles?.length || !allBlocks.length) {
      return new Map<string, number>();
    }
    const map = new Map<string, number>();
    for (const sub of playbackSubtitles) {
      if (sub.start_seconds === null || sub.start_seconds === undefined) continue;
      const spoken = sub.text;
      if (!spoken || spoken.split(' ').length < 2) continue;
      let bestId: string | null = null;
      let bestScore = 0;
      for (const blk of allBlocks) {
        if (!blk.dialogue) continue;
        const score = computeSimilarity(spoken, blk.dialogue);
        if (score > bestScore) {
          bestScore = score;
          bestId = blk.id;
        }
      }
      if (bestId && bestScore >= (wildcardThreshold / 100)) {
        if (!map.has(bestId)) {
          map.set(bestId, sub.start_seconds);
        }
      }
    }
    return map;
  }, [isPlaybackMode, playbackSubtitles, allBlocks, wildcardThreshold]);

  // Sync script position with video playbackTime in recording mode
  useEffect(() => {
    if (!isPlaybackMode || playbackTime === undefined || !playbackSubtitles?.length || !allBlocks.length) {
      return;
    }
    if (!speechSyncEnabled) return;

    // Find current or latest subtitle up to playbackTime
    const currentSub = playbackSubtitles.find(
      (s) =>
        s.start_seconds !== null &&
        s.start_seconds !== undefined &&
        playbackTime >= s.start_seconds &&
        playbackTime < (s.end_seconds ?? s.start_seconds + 3.0)
    ) || [...playbackSubtitles].reverse().find(
      (s) => s.start_seconds !== null && s.start_seconds !== undefined && s.start_seconds <= playbackTime
    );

    if (!currentSub || !currentSub.text) return;

    const spoken = currentSub.text;
    const isMusic = isMusicPerformance(spoken, currentSub.is_music);

    const currBlockId = activeBlockIdRef.current;
    const currIdx = allBlocks.findIndex((b) => b.id === currBlockId);

    if (isMusic) {
      setIsMusicActive(true);
      // Find current or upcoming performance block
      let targetPerfBlock: ScriptBlock | null = null;
      if (currIdx >= 0) {
        for (let i = currIdx; i <= Math.min(allBlocks.length - 1, currIdx + 8); i++) {
          if (isPerformanceBlock(allBlocks[i])) {
            targetPerfBlock = allBlocks[i];
            break;
          }
        }
      }
      if (!targetPerfBlock) {
        const words = spoken.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        targetPerfBlock = allBlocks.find((b) => {
          if (!isPerformanceBlock(b)) return false;
          const comb = `${b.cue || ''} ${b.dialogue || ''}`.toLowerCase();
          return words.some((w: string) => comb.includes(w));
        }) || null;
      }
      if (targetPerfBlock) {
        setActiveBlockId(targetPerfBlock.id);
        setActivePerformanceName(getPerformanceName(targetPerfBlock));
      }
      return;
    } else {
      setIsMusicActive(false);
    }

    const normSpk = normalizeText(spoken, false);
    const spkWords = normSpk.split(' ').filter((w) => w.length > 1);
    if (spkWords.length < 2) return;

    let bestId: string | null = null;
    let bestScore = 0;

    // Nearby proximity search first
    if (currIdx >= 0) {
      const start = Math.max(0, currIdx - 2);
      const end = Math.min(allBlocks.length - 1, currIdx + 6);
      for (let i = start; i <= end; i++) {
        const blk = allBlocks[i];
        if (!blk.dialogue) continue;
        const score = computeSimilarity(spoken, blk.dialogue, normSpk, spkWords) + 0.08;
        if (score > bestScore) {
          bestScore = score;
          bestId = blk.id;
        }
      }
    }

    // Global fallback
    if (bestScore < (wildcardThreshold / 100)) {
      for (let i = 0; i < allBlocks.length; i++) {
        const blk = allBlocks[i];
        if (!blk.dialogue) continue;
        if (!quickOverlap(spkWords, blk.dialogue)) continue;
        const score = computeSimilarity(spoken, blk.dialogue, normSpk, spkWords);
        if (score > bestScore) {
          bestScore = score;
          bestId = blk.id;
        }
      }
    }

    if (bestId && bestScore >= (wildcardThreshold / 100)) {
      if (bestId !== activeBlockIdRef.current) {
        setActiveBlockId(bestId);
        lastMatchTimeRef.current = Date.now();
        setLastConfidence(Math.round(bestScore * 100));
        setLastMatchedSpoken(spoken);

        const targetBlock = allBlocks.find((b) => b.id === bestId);
        if (targetBlock && selectedSectionId !== 'all' && selectedSectionId !== targetBlock.section_id) {
          setSelectedSectionId('all');
        }
      }
    }
  }, [isPlaybackMode, playbackTime, playbackSubtitles, allBlocks, wildcardThreshold, speechSyncEnabled, selectedSectionId]);

  // WebSocket Listener for real-time speech matching and sync (stays connected permanently during live)
  useEffect(() => {
    if (isPlaybackMode) return;
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
              const spoken = data.text || '';
              const isMusic = isMusicPerformance(spoken, data.is_music);

              if (isMusic) {
                setIsMusicActive(true);
                const currentBlocks = allBlocksRef.current;
                const currBlockId = activeBlockIdRef.current;
                const currIdx = currentBlocks.findIndex((b) => b.id === currBlockId);

                let targetPerfBlock: ScriptBlock | null = null;
                if (currIdx >= 0) {
                  for (let i = currIdx; i <= Math.min(currentBlocks.length - 1, currIdx + 8); i++) {
                    if (isPerformanceBlock(currentBlocks[i])) {
                      targetPerfBlock = currentBlocks[i];
                      break;
                    }
                  }
                }
                if (!targetPerfBlock) {
                  const words = spoken.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
                  targetPerfBlock = currentBlocks.find((b) => {
                    if (!isPerformanceBlock(b)) return false;
                    const comb = `${b.cue || ''} ${b.dialogue || ''}`.toLowerCase();
                    return words.some((w: string) => comb.includes(w));
                  }) || null;
                }

                if (targetPerfBlock) {
                  if (targetPerfBlock.id !== currBlockId) {
                    setActiveBlockId(targetPerfBlock.id);
                    lastMatchTimeRef.current = Date.now();
                  }
                  setActivePerformanceName(getPerformanceName(targetPerfBlock));
                }

                if (musicTimerRef.current) clearTimeout(musicTimerRef.current);
                musicTimerRef.current = setTimeout(() => {
                  setIsMusicActive(false);
                }, 15000);
                return;
              }

              // Real-time client-side fuzzy match with anti-jump cooldown & music protection:
              const currentBlocks = allBlocksRef.current;
              const isSyncOn = speechSyncEnabledRef.current;

              if (isSyncOn && currentBlocks.length > 0 && spoken) {
                const normSpk = normalizeText(spoken, false);
                const spkWords = normSpk.split(' ').filter((w) => w.length > 1);
                if (spkWords.length < 2) return;

                const currBlockId = activeBlockIdRef.current;
                const currIdx = currentBlocks.findIndex((b) => b.id === currBlockId);

                const thresholdFraction = wildcardThresholdRef.current / 100.0;
                const now = Date.now();
                const timeSinceLastMatch = (now - lastMatchTimeRef.current) / 1000.0;

                // Step 1: Check Local Window (±5 lines around current position)
                let bestLocalMatch: ScriptBlock | null = null;
                let bestLocalScore = 0;

                if (currIdx >= 0) {
                  const startIdx = Math.max(0, currIdx - 5);
                  const endIdx = Math.min(currentBlocks.length - 1, currIdx + 5);

                  for (let i = startIdx; i <= endIdx; i++) {
                    const blk = currentBlocks[i];
                    const targetText = `${blk.dialogue || ''} ${blk.cue || ''}`.trim();
                    if (!targetText) continue;

                    let score = computeSimilarity(spoken, targetText, normSpk, spkWords);
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
                  const targetText = `${blk.dialogue || ''} ${blk.cue || ''}`.trim();
                  if (!targetText) continue;

                  // Ultra-fast keyword/sub-string pre-check before expensive fuzzy comparison
                  if (!quickOverlap(spkWords, targetText)) continue;

                  const score = computeSimilarity(spoken, targetText, normSpk, spkWords);
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
  }, [eventId, fetchScript, isPlaybackMode]);

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

    if (isPlaybackMode && onSeek) {
      let targetTime = blockTimestamps.get(block.id);
      if (targetTime === undefined) {
        const blockIdx = allBlocks.findIndex((b) => b.id === block.id);
        if (blockIdx >= 0) {
          for (let i = blockIdx - 1; i >= 0; i--) {
            const prevTime = blockTimestamps.get(allBlocks[i].id);
            if (prevTime !== undefined) {
              targetTime = prevTime;
              break;
            }
          }
        }
      }
      if (targetTime !== undefined) {
        onSeek(targetTime);
      }
    } else if (isSMOrAdmin) {
      try {
        await api.jumpScriptBlock(eventId, block.id);
      } catch (err) {
        console.error('Failed to broadcast script jump:', err);
      }
    }
  };

  // Find active block, active cues & upcoming cues
  const activeIndex = useMemo(() => {
    if (!activeBlockId) return -1;
    return allBlocks.findIndex((b) => b.id === activeBlockId);
  }, [allBlocks, activeBlockId]);

  const activeBlock = activeIndex >= 0 ? allBlocks[activeIndex] : null;

  // Active cues currently live on stage or in effect
  const activeCues = useMemo(() => {
    if (activeIndex < 0 || !allBlocks.length) return [];
    const current = allBlocks[activeIndex];

    // 1. Direct cue on the current active line
    if (current?.cue && current.cue.trim()) {
      return [{
        block: current,
        type: getCueType(current.cue),
        isCurrentLine: true,
      }];
    }

    // 2. Or most recent cue still active from preceding lines
    for (let i = activeIndex - 1; i >= Math.max(0, activeIndex - 15); i--) {
      const blk = allBlocks[i];
      if (blk?.cue && blk.cue.trim()) {
        return [{
          block: blk,
          type: getCueType(blk.cue),
          isCurrentLine: false,
        }];
      }
    }

    return [];
  }, [allBlocks, activeIndex]);

  // Upcoming cues strictly approaching ahead of current line
  const upcomingCues = useMemo(() => {
    if (activeIndex < 0) return [];
    const cues: Array<{ block: ScriptBlock; distance: number; type: 'lighting' | 'audio' | 'stage' | 'none' }> = [];
    for (let i = activeIndex + 1; i < Math.min(allBlocks.length, activeIndex + 8); i++) {
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
      className={`bg-card border border-border/60 rounded-2xl flex flex-col shadow-xl overflow-hidden text-card-foreground ${
        teleprompterMode ? 'fixed inset-4 z-50 bg-background border-primary/50' : className
      }`}
    >
      {/* Header Bar */}
      <div className="p-4 border-b border-border/60 bg-muted/30 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">
                {script ? script.title : (isPlaybackMode ? 'Imported Script' : 'Live Script & Cue Tracker')}
              </h3>
              {script && (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  v{script.version} • {script.total_blocks} lines
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <span>{isPlaybackMode ? 'Take Replay Video Sync' : `Speech-to-Script Wildcard Sync (~${wildcardThreshold}% tolerance)`}</span>
              {lastConfidence && (
                <span className="text-emerald-400 font-mono font-medium">
                  • {Math.round(lastConfidence * 100)}% match
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Auto-Follow Toggle */}
          <Button
            size="sm"
            variant={autoFollow ? 'default' : 'outline'}
            onClick={() => setAutoFollow(!autoFollow)}
            className="gap-1.5 text-xs h-8"
            title={autoFollow ? 'Auto-scroll enabled' : 'Auto-scroll paused'}
          >
            {autoFollow ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Auto-Follow</span>
          </Button>

          {/* AI Speech Sync Toggle */}
          <Button
            size="sm"
            variant={speechSyncEnabled ? 'default' : 'outline'}
            onClick={() => setSpeechSyncEnabled(!speechSyncEnabled)}
            className="gap-1.5 text-xs h-8"
            title={isPlaybackMode ? 'Toggle Video-to-Script Auto-Sync' : 'Toggle Live Speech-to-Script Auto-Sync'}
          >
            <Sparkles className={`w-3.5 h-3.5 ${speechSyncEnabled ? 'animate-pulse text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">
              {isPlaybackMode
                ? (speechSyncEnabled ? 'Video Sync On' : 'Video Sync Off')
                : (speechSyncEnabled ? 'AI Sync Active' : 'AI Sync Off')}
            </span>
          </Button>

          {/* Teleprompter Fullscreen Mode */}
          <Button
            size="icon-sm"
            variant={teleprompterMode ? 'default' : 'outline'}
            onClick={() => setTeleprompterMode(!teleprompterMode)}
            title={teleprompterMode ? 'Exit Fullscreen Teleprompter' : 'Presenter / Teleprompter Mode'}
          >
            {teleprompterMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>

          {/* Import Button */}
          {isSMOrAdmin && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsImportModalOpen(true)}
              className="gap-1.5 text-xs h-8"
            >
              <Upload className="w-3.5 h-3.5 text-primary" />
              <span>Import Script</span>
            </Button>
          )}

          {/* Delete Script */}
          {script && isSMOrAdmin && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={handleDeleteScript}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Delete active script"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Filter & Sensitivity Controls Sub-bar */}
      {script && (
        <div className="px-4 py-2 bg-muted/15 border-b border-border/60 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search lines, speakers, or cues..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-xs h-8"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
                className="rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none h-8"
              >
                <option value="all" className="bg-popover text-popover-foreground">All Scenes ({script.sections.length})</option>
                {script.sections.map((sec) => (
                  <option key={sec.id} value={sec.id} className="bg-popover text-popover-foreground">
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

      {/* Live Music / Performance Active Indicator Banner (Orange) */}
      {(() => {
        const isCurrentBlockPerformance = isPerformanceBlock(activeBlock);
        const isPerformanceActive = isCurrentBlockPerformance || isMusicActive;
        const performanceTitle = isCurrentBlockPerformance
          ? getPerformanceName(activeBlock)
          : (activePerformanceName || 'Live Song / Performance Active');

        if (!isPerformanceActive) return null;

        return (
          <div className="px-4 py-2 bg-orange-500/10 border-b border-orange-500/20 flex items-center gap-3 overflow-x-auto text-xs animate-in fade-in duration-150">
            <div className="flex items-center gap-1.5 text-orange-400 font-semibold uppercase tracking-wider shrink-0">
              <Music className="w-3.5 h-3.5 text-orange-400" />
              <span className="font-bold">Performance Active:</span>
            </div>

            <div className="flex items-center gap-2 flex-1 overflow-x-auto py-0.5">
              <div className="px-2.5 py-1 rounded-lg border text-xs flex items-center gap-2 shrink-0 bg-orange-500/15 border-orange-500/40 text-orange-300 shadow-sm">
                <Music className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="font-mono font-medium whitespace-nowrap">
                  {performanceTitle}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Active Cues Alert Banner for Technical Crew (Green) */}
      {activeCues.length > 0 && (
        <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-3 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold uppercase tracking-wider shrink-0">
            <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
            <span className="font-bold">Active Cues:</span>
          </div>

          <div className="flex items-center gap-2 flex-1 overflow-x-auto py-0.5">
            {activeCues.map((item) => (
              <div
                key={item.block.id}
                onClick={() => handleJumpToBlock(item.block)}
                className="cursor-pointer px-2.5 py-1 rounded-lg border text-xs flex items-center gap-2 shrink-0 transition-all hover:scale-[1.02] shadow-sm bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
              >
                {item.type === 'lighting' ? (
                  <Lightbulb className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : item.type === 'audio' ? (
                  <Music className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <Badge variant="outline" className="font-bold text-[10px] uppercase tracking-wider px-1.5 py-0 h-4 bg-background/80 shrink-0 border-emerald-500/30 text-emerald-400">
                  {item.isCurrentLine ? 'LIVE NOW' : `LINE #${item.block.order_index + 1}`}
                </Badge>
                <span className="font-mono font-medium whitespace-nowrap">{item.block.cue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Cues Alert Banner for Technical Crew (Blue) */}
      {upcomingCues.length > 0 && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center gap-3 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 text-blue-400 font-semibold uppercase tracking-wider shrink-0">
            <Radio className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-bold">Upcoming Cues:</span>
          </div>

          <div className="flex items-center gap-2 flex-1 overflow-x-auto py-0.5">
            {upcomingCues.slice(0, 3).map((item) => (
              <div
                key={item.block.id}
                onClick={() => handleJumpToBlock(item.block)}
                className="cursor-pointer px-2.5 py-1 rounded-lg border text-xs flex items-center gap-2 shrink-0 transition-all hover:scale-[1.02] shadow-sm bg-blue-500/15 border-blue-500/40 text-blue-300"
              >
                {item.type === 'lighting' ? (
                  <Lightbulb className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                ) : item.type === 'audio' ? (
                  <Music className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                )}
                <Badge variant="outline" className="font-bold text-[10px] uppercase tracking-wider px-1.5 py-0 h-4 bg-background/80 shrink-0 border-blue-500/30 text-blue-400">
                  IN {item.distance} LINE{item.distance > 1 ? 'S' : ''}
                </Badge>
                <span className="font-mono font-medium whitespace-nowrap">{item.block.cue}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table Header Bar for Column Titles (Continuous Stage Cue Layout) */}
      {script && displayBlocks.length > 0 && (
        <div className="flex items-center px-3 py-1.5 bg-muted/40 border-b border-border/60 text-[11px] font-bold text-muted-foreground uppercase tracking-wider select-none shrink-0 sticky top-0 z-10">
          <div className="w-28 sm:w-36 lg:w-44 shrink-0 flex items-center gap-1.5 pr-2">
            <span className="w-5 text-muted-foreground/60">#</span>
            <span>Speaker</span>
          </div>
          <div className="flex-1 min-w-0 pr-4">Dialogue</div>
          <div className="w-48 sm:w-64 lg:w-80 shrink-0 text-right">Technical Notes</div>
        </div>
      )}

      {/* Script Lines Content Container (Continuous List, No Gaps) */}
      <div
        ref={listContainerRef}
        className={`relative flex-1 overflow-y-auto divide-y divide-border/40 bg-card ${
          teleprompterMode ? 'max-h-full' : 'max-h-[550px]'
        }`}
      >
        {loading ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">Loading synchronized script...</span>
          </div>
        ) : !script ? (
          <div className="py-16 text-center border border-dashed border-border/60 rounded-2xl flex flex-col items-center justify-center p-8 m-4 bg-muted/10">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-3">
              <FileText className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-foreground">No script loaded</h4>
            <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1 mb-5 leading-relaxed">
              Import a Word (.docx) document or paste raw text to enable real-time speech synchronization,
              speaker line tracking, and technical cue alerts.
            </p>

            {isSMOrAdmin && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  onClick={() => setIsImportModalOpen(true)}
                  className="gap-2 shadow-sm"
                >
                  <Upload className="w-4 h-4" />
                  <span>Import Script Document (.docx)</span>
                </Button>
              </div>
            )}
          </div>
        ) : displayBlocks.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            No lines match your search filter &quot;{searchQuery}&quot;.
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
                className={`group relative flex items-start transition-colors cursor-pointer px-3 py-1.5 md:py-2 ${
                  isActive
                    ? 'bg-primary/10 border-l-4 border-l-primary shadow-sm'
                    : 'border-l-4 border-l-transparent hover:bg-muted/40'
                }`}
              >
                {/* Left Column: Speaker & Line Number */}
                <div className="w-28 sm:w-36 lg:w-44 shrink-0 pr-2 flex items-start gap-1.5 pt-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0 pt-0.5 select-none">
                    #{block.order_index + 1}
                  </span>

                  {block.speaker ? (
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-semibold capitalize truncate max-w-[85px] sm:max-w-[110px] lg:max-w-[130px] border ${getSpeakerColor(
                        block.speaker
                      )}`}
                      title={block.speaker}
                    >
                      {block.speaker}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60 italic select-none">—</span>
                  )}

                  {isPlaybackMode && blockTimestamps.has(block.id) && (
                    <Button
                      type="button"
                      size="sm"
                      variant={isActive ? "default" : "secondary"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSeek?.(blockTimestamps.get(block.id)!);
                      }}
                      className="h-5 px-1.5 text-[9px] font-mono gap-1 shrink-0"
                      title="Jump video playback to this line"
                    >
                      <Play className="w-2 h-2 fill-current" />
                      <span>{formatTime(blockTimestamps.get(block.id)!)}</span>
                    </Button>
                  )}

                  {isActive && isPlaybackMode && (
                    <Badge variant="default" className="text-[9px] px-1 py-0 h-4 font-mono font-bold shrink-0">
                      PLAYING
                    </Badge>
                  )}
                </div>

                {/* Middle Column: Dialogue & Monoscript Actions */}
                <div className="flex-1 min-w-0 pr-4">
                  <DialogueContent
                    text={block.dialogue}
                    isActive={isActive}
                    teleprompterMode={teleprompterMode}
                  />
                </div>

                {/* Right Column: Technical Notes & Cues (Multi-line wrap, no cutoffs) */}
                <div className="w-48 sm:w-64 lg:w-80 shrink-0 flex flex-col items-end gap-1 pt-0.5">
                  <div className="flex items-start gap-1.5 w-full justify-end">
                    {block.cue ? (
                      <span
                        className={`inline-flex items-start gap-1 px-2 py-0.5 rounded border text-[11px] font-mono font-medium max-w-full text-right break-words whitespace-normal leading-relaxed ${
                          cueType === 'lighting'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                            : cueType === 'audio'
                            ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        }`}
                        title={block.cue}
                      >
                        {cueType === 'lighting' ? (
                          <Lightbulb className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                        ) : cueType === 'audio' ? (
                          <Music className="w-3 h-3 text-purple-400 shrink-0 mt-0.5" />
                        ) : (
                          <FileText className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                        )}
                        <span className="break-words text-right whitespace-normal">{block.cue}</span>
                      </span>
                    ) : !block.notes ? (
                      <span className="text-xs text-muted-foreground/40 select-none">—</span>
                    ) : null}
                  </div>

                  {block.notes && (
                    <span
                      className="text-[11px] text-muted-foreground font-mono text-right max-w-full break-words whitespace-normal leading-relaxed block"
                      title={block.notes}
                    >
                      {block.notes}
                    </span>
                  )}
                </div>
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
              <span className="text-xs text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-mono max-w-xs sm:max-w-md break-words whitespace-normal">
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

      {/* Script Import Dialog using shadcn/ui */}
      <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <Upload className="w-5 h-5 text-purple-400" />
              <span>Import Stage Script</span>
            </DialogTitle>
            <DialogDescription>
              Import a Word (.docx) 3-column table or paste raw script text to enable synchronized speech following.
            </DialogDescription>
          </DialogHeader>

          {/* Modal Tabs */}
          <div className="flex items-center gap-2 border-b border-border/50 pb-3">
            <Button
              type="button"
              size="sm"
              variant={importTab === 'file' ? 'default' : 'ghost'}
              onClick={() => setImportTab('file')}
            >
              Upload Word (.docx) / File
            </Button>
            <Button
              type="button"
              size="sm"
              variant={importTab === 'text' ? 'default' : 'ghost'}
              onClick={() => setImportTab('text')}
            >
              Paste Raw Text / TSV
            </Button>
          </div>

          {importError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {/* Tab 1: File Upload */}
          {importTab === 'file' && (
            <form onSubmit={handleUploadFile} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                  Script Title <span className="text-muted-foreground font-normal lowercase">(optional)</span>
                </label>
                <Input
                  type="text"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="e.g. Stage Script (defaults to filename if blank)"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                  Word File (.docx) or Text Script (.txt, .tsv)
                </label>
                <div className="border-2 border-dashed border-border/70 rounded-xl p-6 text-center hover:border-primary/50 transition-colors">
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
                    <span className="text-xs text-foreground font-medium">
                      {importFile ? importFile.name : 'Click to select Word (.docx) file'}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Supports 3-column stage tables (Speaker, Technical Notes, Dialogue Lines)
                    </span>
                  </label>
                </div>
              </div>

              <DialogFooter className="gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsImportModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!importFile || isImporting}
                  className="gap-1.5"
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
                </Button>
              </DialogFooter>
            </form>
          )}

          {/* Tab 2: Raw Text Paste */}
          {importTab === 'text' && (
            <form onSubmit={handleImportRawText} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                  Script Title
                </label>
                <Input
                  type="text"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                  placeholder="e.g. Rehearsal Script"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                  Paste Script Text or TSV Table
                </label>
                <textarea
                  rows={8}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`Paste here! Supported formats:\n1. Tab-delimited (copy from Excel/Word table): Speaker [tab] Technical Cue [tab] Dialogue\n2. Script dialogue: Speaker: Spoken line [SPOTLIGHT ON EMCEE]\n3. Plain dialogue lines`}
                  className="w-full rounded-lg border border-input bg-transparent p-3 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
                  required
                />
              </div>

              <DialogFooter className="gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsImportModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!importText.trim() || isImporting}
                  className="gap-1.5"
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
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
