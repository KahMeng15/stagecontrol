'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Cpu,
  Download,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  HardDrive,
  Globe2,
  Radio,
  Layers,
  Sparkles,
  RefreshCw,
  Plus,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, TranscriptionModelInfo, TranscriptionSettings } from '@/lib/api';

interface TranscriptionModelSettingsProps {
  canManage?: boolean;
}

export function TranscriptionModelSettings({ canManage = true }: TranscriptionModelSettingsProps) {
  const [settings, setSettings] = useState<TranscriptionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  // Custom repo input
  const [customRepo, setCustomRepo] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSettings = useCallback(async (isPolling = false) => {
    try {
      if (!isPolling) setLoading(true);
      const data = await api.getTranscriptionSettings();
      setSettings(data);
      setError(null);
    } catch (err: any) {
      if (!isPolling) {
        setError(err?.message || 'Failed to fetch transcription engine settings');
      }
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [fetchSettings]);

  // Polling when any model is downloading
  useEffect(() => {
    const hasDownloading = settings?.models.some((m) => m.download_status === 'downloading');
    if (hasDownloading) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(() => {
          fetchSettings(true);
        }, 2500);
      }
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [settings, fetchSettings]);

  const handleDownload = async (modelId: string, repoToDownload?: string) => {
    try {
      setActionLoading(`download-${modelId}`);
      setError(null);
      setSuccessMsg(null);
      await api.downloadTranscriptionModel(modelId, repoToDownload);
      setSuccessMsg(`Download initiated for ${modelId}. Weights are being saved to persistent storage.`);
      await fetchSettings(true);
    } catch (err: any) {
      setError(err?.message || `Failed to initiate download for ${modelId}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivate = async (modelId: string) => {
    try {
      setActionLoading(`activate-${modelId}`);
      setError(null);
      setSuccessMsg(null);
      const res = await api.activateTranscriptionModel(modelId);
      setSuccessMsg(res.message || `Activated model ${modelId}`);
      await fetchSettings();
    } catch (err: any) {
      setError(err?.message || `Failed to activate model ${modelId}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (modelId: string, modelName: string) => {
    if (!window.confirm(`Are you sure you want to delete '${modelName}' from server storage to free disk space?`)) {
      return;
    }
    try {
      setActionLoading(`delete-${modelId}`);
      setError(null);
      setSuccessMsg(null);
      const res = await api.deleteTranscriptionModel(modelId);
      setSuccessMsg(res.message || `Deleted ${modelName}`);
      await fetchSettings();
    } catch (err: any) {
      setError(err?.message || `Failed to delete model ${modelId}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCustomDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRepo.trim()) return;
    const repo = customRepo.trim();
    await handleDownload(repo, repo);
    setCustomRepo('');
    setShowCustomInput(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Architecture Alert: Single Unified Engine */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-foreground">
                Unified Speech-to-Text Model Architecture
              </h3>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-[10px]">
                Single Model Shared
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
              Both the <strong className="text-foreground">Live Program Video Feed</strong> and <strong className="text-foreground">Crew Walkie-Talkie Voice Comms</strong> share a single loaded Whisper model instance in memory. This eliminates duplicate memory allocations, reduces CPU thermal load, and prevents RAM exhaustion.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchSettings()}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Language Filter & Storage Safeguard Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: 3-Language Restriction Filter */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground font-semibold text-xs tracking-wide uppercase">
                <Globe2 className="w-4 h-4 text-sky-400" />
                <span>Restricted Language Filter</span>
              </div>
              <Badge variant="secondary" className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/30">
                Hallucination Guard Active
              </Badge>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Speech recognition is strictly constrained to 3 target languages. The decoder ignores unsupported foreign language tokens.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2 pt-1">
              <div className="px-3 py-1.5 rounded-lg border border-border/60 bg-muted/30 flex items-center gap-2 text-xs">
                <span className="font-mono text-primary font-bold">EN</span>
                <span className="text-foreground font-medium">English</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg border border-border/60 bg-muted/30 flex items-center gap-2 text-xs">
                <span className="font-mono text-emerald-400 font-bold">MS</span>
                <span className="text-foreground font-medium">Bahasa Melayu / Malaysia</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg border border-border/60 bg-muted/30 flex items-center gap-2 text-xs">
                <span className="font-mono text-amber-400 font-bold">ZH</span>
                <span className="text-foreground font-medium">Mandarin Chinese (华语)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Server Storage & Image Optimization */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground font-semibold text-xs tracking-wide uppercase">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <span>Client Model Storage Management</span>
              </div>
              <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Lean Docker Image
              </Badge>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Model weights are downloaded on demand into persistent host storage (<code className="text-[11px] text-foreground">/storage/models</code>) and not bundled inside Docker images.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between text-xs py-1">
              <span className="text-muted-foreground">Active Model in Memory:</span>
              <span className="font-semibold text-foreground truncate max-w-[240px]">
                {settings?.active_model_name || 'Loading...'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs py-1 border-t border-border/40 mt-1">
              <span className="text-muted-foreground">Quantization Format:</span>
              <span className="font-mono text-xs text-foreground/80">INT8 CTranslate2 (CPU Optimized)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-3.5 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Model Catalog Table */}
      <Card className="p-0 overflow-hidden border-border/60">
        <div className="p-4 sm:p-5 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <span>Available Speech Recognition Models</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select or download Mesolitica’s Malaysian Whisper models or OpenAI Stock Whisper models.
            </p>
          </div>

          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCustomInput(!showCustomInput)}
              className="gap-1.5 text-xs self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Custom HF Model</span>
            </Button>
          )}
        </div>

        {/* Custom Repo Form Drawer */}
        {showCustomInput && canManage && (
          <form
            onSubmit={handleCustomDownload}
            className="p-4 bg-muted/20 border-b border-border/60 flex flex-col sm:flex-row gap-2.5 items-end"
          >
            <div className="flex-1 space-y-1 w-full">
              <label className="text-xs font-medium text-foreground">
                Hugging Face CTranslate2 Repository ID:
              </label>
              <Input
                placeholder="e.g. SeamlessX/malaysian-faster-whisper-large-v3-turbo-v3-ct2"
                value={customRepo}
                onChange={(e) => setCustomRepo(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="submit" size="sm" className="h-8 text-xs gap-1.5">
                <Download className="w-3.5 h-3.5" />
                <span>Download & Add</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCustomInput(false)}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/60">
                <TableHead className="w-[300px]">Model & Architecture</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Storage Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !settings ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 5 : 4} className="text-center py-10 text-muted-foreground text-xs">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
                    <span>Loading models catalog and local storage status...</span>
                  </TableCell>
                </TableRow>
              ) : settings?.models?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 5 : 4} className="text-center py-8 text-muted-foreground text-xs">
                    No models configured.
                  </TableCell>
                </TableRow>
              ) : (
                settings?.models.map((m) => {
                  const isDownloading = m.download_status === 'downloading';
                  const isActionBusy = actionLoading?.includes(m.id);

                  return (
                    <TableRow key={m.id} className={m.is_active ? 'bg-primary/5' : undefined}>
                      <TableCell className="align-top py-3.5">
                        <div className="flex items-start gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs text-foreground">
                                {m.name}
                              </span>
                              {m.recommended && (
                                <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30 h-4 px-1.5 gap-1">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>Recommended for Malaysia</span>
                                </Badge>
                              )}
                              {m.is_active && (
                                <Badge className="text-[9px] bg-emerald-500/20 text-emerald-400 border-emerald-500/40 h-4 px-1.5 gap-1">
                                  <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
                                  <span>Active Engine</span>
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                              {m.description}
                            </p>
                            <span className="font-mono text-[10px] text-muted-foreground/70 block mt-1">
                              {m.repo_id}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="align-top py-3.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {m.category}
                        </Badge>
                      </TableCell>

                      <TableCell className="align-top py-3.5 text-xs font-mono">
                        {m.size_on_disk ? (
                          <span className="text-emerald-400 font-semibold">{m.size_on_disk}</span>
                        ) : (
                          <span className="text-muted-foreground">{m.size_estimate}</span>
                        )}
                      </TableCell>

                      <TableCell className="align-top py-3.5">
                        {isDownloading ? (
                          <div className="flex items-center gap-1.5 text-xs text-amber-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span>Downloading weights...</span>
                          </div>
                        ) : m.is_downloaded ? (
                          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Downloaded on server</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not downloaded</span>
                        )}

                        {m.download_error && (
                          <p className="text-[10px] text-destructive mt-1 truncate max-w-[180px]" title={m.download_error}>
                            {m.download_error}
                          </p>
                        )}
                      </TableCell>

                      {canManage && (
                        <TableCell className="align-top py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Activate button */}
                            {m.is_downloaded && !m.is_active && (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => handleActivate(m.id)}
                                disabled={isActionBusy || isDownloading}
                                className="h-7 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                              >
                                {actionLoading === `activate-${m.id}` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Zap className="w-3 h-3" />
                                )}
                                <span>Activate</span>
                              </Button>
                            )}

                            {/* Download button */}
                            {!m.is_downloaded && !isDownloading && (
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => handleDownload(m.id, m.repo_id)}
                                disabled={isActionBusy}
                                className="h-7 text-[11px] gap-1"
                              >
                                {actionLoading === `download-${m.id}` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Download className="w-3 h-3" />
                                )}
                                <span>Download</span>
                              </Button>
                            )}

                            {/* Downloading state indicator */}
                            {isDownloading && (
                              <Button size="xs" variant="secondary" disabled className="h-7 text-[11px] gap-1 opacity-70">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>Downloading...</span>
                              </Button>
                            )}

                            {/* Active badge placeholder */}
                            {m.is_active && (
                              <span className="text-[11px] text-emerald-400 font-semibold px-2 py-1 bg-emerald-500/10 rounded border border-emerald-500/20">
                                Current Active
                              </span>
                            )}

                            {/* Delete button (only if downloaded and NOT active) */}
                            {m.is_downloaded && !m.is_active && (
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => handleDelete(m.id, m.name)}
                                disabled={isActionBusy}
                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="Delete model from server storage"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
