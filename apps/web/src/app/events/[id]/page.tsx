'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, EventDetail, EventRole, EventStatus, SystemSettings } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
import { RoleBadge } from '@/components/RoleBadge';
import { LivePlayer } from '@/components/video/LivePlayer';
import { RecordingArchive } from '@/components/video/RecordingArchive';
import ScriptTracker from '@/components/script/ScriptTracker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Radio,
  Users,
  Key,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  UserPlus,
  ArrowLeft,
  Tv,
  FileText,
  Mic,
  AlertCircle,
  KeyRound,
  ExternalLink,
  ShieldOff,
  Film,
  Zap,
  Loader2,
} from 'lucide-react';

function EventContent() {
  const router = useRouter();
  const params = useParams();
  const eventId = (params?.id as string) || '';
  const { user, isLoading: authLoading } = useAuth();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [selectedDomainType, setSelectedDomainType] = useState<'primary' | 'alternative'>('primary');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'control' | 'script' | 'recordings' | 'stream' | 'crew'>('control');

  // Copy state
  const [copiedKey, setCopiedKey] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copiedPinLink, setCopiedPinLink] = useState(false);
  const [pinActionLoading, setPinActionLoading] = useState(false);

  // Add Member State
  const [showAddMember, setShowAddMember] = useState(false);
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState<EventRole>('crew');
  const [inviteCallsign, setInviteCallsign] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Status updating
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const fetchEventData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getEvent(eventId);
      setEvent(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load event details';
      setError(msg);
      toast.error('Failed to load event details', { description: msg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && eventId) {
      let ignore = false;
      api.getEvent(eventId)
        .then((data) => {
          if (!ignore) {
            setEvent(data);
            setLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (!ignore) {
            const msg = err instanceof Error ? err.message : 'Failed to load event details';
            setError(msg);
            setLoading(false);
          }
        });

      api.getSettings().then((s) => {
        if (!ignore) setSystemSettings(s);
      }).catch(() => null);

      return () => {
        ignore = true;
      };
    }
  }, [user, eventId]);

  const handleCopyStreamKey = () => {
    if (event?.stream_key) {
      navigator.clipboard.writeText(event.stream_key);
      setCopiedKey(true);
      toast.success('Stream key copied to clipboard');
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleRegenerateKey = async () => {
    if (!event) return;
    if (!window.confirm('Are you sure you want to regenerate the stream key? Any active OBS stream will disconnect immediately.')) {
      return;
    }
    try {
      setRegenerating(true);
      const updated = await api.regenerateStreamKey(event.id);
      setEvent((prev) => (prev ? { ...prev, stream_key: updated.stream_key } : null));
      toast.success('Stream key regenerated successfully');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate stream key');
    } finally {
      setRegenerating(false);
    }
  };

  const handleGeneratePin = async () => {
    if (!event) return;
    try {
      setPinActionLoading(true);
      const updated = await api.generatePublicPin(event.id);
      setEvent((prev) =>
        prev
          ? {
              ...prev,
              public_pin: updated.public_pin,
              public_pin_enabled: true,
            }
          : null
      );
      toast.success('New 6-digit public PIN activated');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate PIN');
    } finally {
      setPinActionLoading(false);
    }
  };

  const handleRevokePin = async () => {
    if (!event) return;
    if (!window.confirm('Are you sure you want to revoke the 6-digit PIN? Guest viewers with this PIN will immediately lose access.')) {
      return;
    }
    try {
      setPinActionLoading(true);
      await api.revokePublicPin(event.id);
      setEvent((prev) =>
        prev
          ? {
              ...prev,
              public_pin: null,
              public_pin_enabled: false,
            }
          : null
      );
      toast.success('Public PIN access revoked');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke PIN access');
    } finally {
      setPinActionLoading(false);
    }
  };

  const getActiveBaseUrl = () => {
    if (selectedDomainType === 'alternative' && systemSettings?.alternative_domain) {
      return systemSettings.alternative_domain.replace(/\/$/, '');
    }
    if (systemSettings?.primary_domain) {
      return systemSettings.primary_domain.replace(/\/$/, '');
    }
    return typeof window !== 'undefined' ? window.location.origin : '';
  };

  const handleCopyPublicLink = () => {
    if (event?.public_pin) {
      const url = `${getActiveBaseUrl()}/view/${event.public_pin}`;
      navigator.clipboard.writeText(url);
      setCopiedPinLink(true);
      toast.success('Public audience link copied to clipboard');
      setTimeout(() => setCopiedPinLink(false), 2000);
    }
  };

  const handleStatusChange = async (newStatus: EventStatus) => {
    if (!event || event.status === newStatus) return;
    try {
      setUpdatingStatus(true);
      const updated = await api.updateEvent(event.id, { status: newStatus });
      setEvent((prev) => (prev ? { ...prev, status: updated.status } : null));
      toast.success(`Event status changed to ${newStatus.toUpperCase()}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update event status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;
    setInviteError(null);
    setInviting(true);

    try {
      await api.addMember(event.id, {
        username_or_email: inviteIdentifier.trim(),
        role: inviteRole,
        callsign: inviteCallsign.trim() || undefined,
      });

      toast.success(`Added ${inviteIdentifier} to crew`);
      setShowAddMember(false);
      setInviteIdentifier('');
      setInviteCallsign('');
      await fetchEventData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add crew member';
      setInviteError(msg);
      toast.error(msg);
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (membershipId: string, username?: string) => {
    if (!event) return;
    if (!window.confirm(`Remove ${username || 'this member'} from the crew?`)) return;
    try {
      await api.removeMember(event.id, membershipId);
      toast.success(`Removed ${username || 'member'} from crew`);
      await fetchEventData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  if (authLoading || (loading && !event && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-background flex flex-col text-foreground">
        <Navbar />
        <div className="flex-1 max-w-lg mx-auto px-4 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Access Restricted</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-6">
            {error || 'You do not have permission to view this event.'}
          </p>
          <Button onClick={() => router.push('/')} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </Button>
        </div>
      </div>
    );
  }

  const isAdmin = event.user_role === 'admin';
  const isSMOrAdmin = isAdmin || event.user_role === 'stage_manager';

  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      <Navbar />

      {/* Event Header Banner */}
      <div className="border-b border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => router.push('/')}
                  className="rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                  {event.name}
                </h1>
                <RoleBadge role={event.user_role} />
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-2 pl-9 sm:pl-9">
                <span>Room Code: <strong className="font-mono text-foreground">{event.slug}</strong></span>
                <span>•</span>
                <span>Created {new Date(event.created_at).toLocaleDateString()}</span>
              </p>
            </div>

            {/* Status Selector */}
            <div className="flex items-center gap-3">
              {isSMOrAdmin ? (
                <div className="flex items-center gap-1 bg-muted p-1 rounded-lg border border-border/50">
                  {(['draft', 'live', 'completed'] as EventStatus[]).map((st) => (
                    <Button
                      key={st}
                      disabled={updatingStatus}
                      size="sm"
                      variant={
                        event.status === st
                          ? st === 'live'
                            ? 'destructive'
                            : 'default'
                          : 'ghost'
                      }
                      onClick={() => handleStatusChange(st)}
                      className="text-xs capitalize font-semibold h-7"
                    >
                      {st === 'live' ? 'LIVE' : st}
                    </Button>
                  ))}
                </div>
              ) : (
                <Badge
                  variant={event.status === 'live' ? 'destructive' : 'secondary'}
                  className="uppercase tracking-wider font-semibold"
                >
                  {event.status}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Tabbed Interface */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as typeof activeTab)}
          className="space-y-6"
        >
          <TabsList variant="line" className="border-b border-border/60 w-full justify-start gap-6 pb-px">
            <TabsTrigger value="control" className="gap-2 text-xs font-semibold py-2">
              <Radio className="w-4 h-4" />
              <span>Control Room</span>
            </TabsTrigger>

            <TabsTrigger value="script" className="gap-2 text-xs font-semibold py-2">
              <FileText className="w-4 h-4" />
              <span>Live Script & Cues</span>
            </TabsTrigger>

            <TabsTrigger value="recordings" className="gap-2 text-xs font-semibold py-2">
              <Film className="w-4 h-4" />
              <span>Recordings & Replay</span>
            </TabsTrigger>

            {isSMOrAdmin && (
              <TabsTrigger value="stream" className="gap-2 text-xs font-semibold py-2">
                <Tv className="w-4 h-4" />
                <span>OBS & Video Setup</span>
              </TabsTrigger>
            )}

            <TabsTrigger value="crew" className="gap-2 text-xs font-semibold py-2">
              <Users className="w-4 h-4" />
              <span>Crew Roster ({event.memberships?.length || 1})</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Control Room */}
          <TabsContent value="control" className="space-y-6 mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Ultra-low latency Live Video Player */}
              <div className="lg:col-span-2">
                <LivePlayer
                  eventId={event.id}
                  streamKey={event.stream_key}
                  isSMOrAdmin={isSMOrAdmin}
                  onOpenStreamSetup={() => setActiveTab('stream')}
                />
              </div>

              {/* Walkie-Talkie & Comms Card */}
              <Card className="flex flex-col justify-between">
                <CardHeader>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4 text-emerald-400" />
                      <CardTitle className="text-xs font-bold uppercase tracking-wider">
                        Crew Walkie-Talkie
                      </CardTitle>
                    </div>
                    <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px]">
                      VOICE READY
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Real-time push-to-talk voice channel for stage directors, audio ops, and presenters.
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col items-center py-6 bg-muted/40 mx-4 mb-4 rounded-xl border border-border/50">
                  <Button
                    disabled
                    size="lg"
                    className="w-24 h-24 rounded-full flex flex-col items-center justify-center opacity-60 cursor-not-allowed border-2 border-primary/30"
                  >
                    <Mic className="w-8 h-8 mb-1" />
                    <span className="text-[10px] font-bold tracking-wider">HOLD TO TALK</span>
                  </Button>
                  <span className="text-[11px] text-muted-foreground mt-4">
                    Voice room: <strong className="text-foreground">{event.slug}-comms</strong>
                  </span>
                </CardContent>
              </Card>
            </div>

            {/* Embedded Live Script & Cue Tracker */}
            <ScriptTracker eventId={event.id} isSMOrAdmin={isSMOrAdmin} />
          </TabsContent>

          {/* Tab 2: Dedicated Live Script & Cues */}
          <TabsContent value="script" className="space-y-6 mt-0">
            <ScriptTracker
              eventId={event.id}
              isSMOrAdmin={isSMOrAdmin}
              className="min-h-[700px]"
            />
          </TabsContent>

          {/* Tab 3: Recordings & Replay */}
          <TabsContent value="recordings" className="space-y-6 mt-0">
            <RecordingArchive
              eventId={event.id}
              isAdmin={isAdmin}
              isSMOrAdmin={isSMOrAdmin}
            />
          </TabsContent>

          {/* Tab 4: OBS Stream Setup */}
          {isSMOrAdmin && (
            <TabsContent value="stream" className="max-w-3xl space-y-6 mt-0">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold">OBS Studio Streaming Credentials</CardTitle>
                      <CardDescription className="text-xs">
                        Use these credentials in OBS Studio or any RTMP/WHIP streaming software.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* RTMP Server URL */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Stream Server URL (RTMP)
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        readOnly
                        value="rtmp://localhost:1935/live"
                        className="font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          navigator.clipboard.writeText('rtmp://localhost:1935/live');
                          toast.success('RTMP server URL copied');
                        }}
                        className="gap-1.5 shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </Button>
                    </div>
                  </div>

                  {/* Stream Key */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Stream Key (Secret)
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        readOnly
                        value={event.stream_key || '••••••••••••••••••••••••'}
                        className="font-mono text-xs text-primary"
                      />
                      <Button
                        type="button"
                        onClick={handleCopyStreamKey}
                        className="gap-1.5 shrink-0 shadow-md shadow-primary/20"
                      >
                        {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                      </Button>
                      {isAdmin && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={handleRegenerateKey}
                          disabled={regenerating}
                          title="Regenerate Stream Key"
                          className="shrink-0 hover:text-destructive hover:border-destructive/40"
                        >
                          <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Never share this key publicly. Only Admins and Stage Managers can view or regenerate this key.
                    </p>
                  </div>

                  {/* WebRTC WHIP URL */}
                  <div className="pt-4 border-t border-border/50 space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      WHIP Ingest URL (Ultra-low latency WebRTC streaming)
                    </label>
                    <Input
                      type="text"
                      readOnly
                      value={`http://localhost:8889/live/${event.stream_key}/whip`}
                      className="font-mono text-xs text-muted-foreground"
                    />
                  </div>

                  {/* OBS Profiles & Bandwidth Presets */}
                  <div className="space-y-3 pt-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                      Recommended Encoder Presets (Choose based on your network):
                    </span>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Preset 1: 4G / Mobile Multi-Viewer (Recommended) */}
                      <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/25 text-xs space-y-2.5 relative group">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-400">
                            <Zap className="w-4 h-4 text-emerald-400" />
                            <span>4G / Multi-Viewer (720p @ 500kbps)</span>
                          </div>
                          <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold">
                            RECOMMENDED
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Saves 90% bandwidth. Ensures team members on 4G / LTE mobile connections watch without buffering.
                        </p>
                        <ul className="text-[11px] font-mono space-y-1 text-slate-300 bg-background/50 p-2.5 rounded-lg border border-border/40">
                          <li>• Resolution: <strong>1280x720 (720p 30fps)</strong></li>
                          <li>• Bitrate: <strong className="text-emerald-400">500 kbps (CBR)</strong></li>
                          <li>• Audio: <strong>64 kbps (AAC stereo)</strong></li>
                          <li>• Keyframe: <strong>2s</strong> | Max B-frames: <strong>0</strong></li>
                        </ul>
                        <Button
                          type="button"
                          size="xs"
                          variant="secondary"
                          onClick={() => {
                            const config = `OBS Low-Bandwidth 4G Preset:
Resolution: 1280x720 (720p)
Bitrate: 500 Kbps (CBR)
Audio: 64 Kbps AAC
Keyframe Interval: 2s
Max B-frames: 0
Tune: zerolatency`;
                            navigator.clipboard.writeText(config);
                            toast.success('4G 500kbps OBS preset copied!');
                          }}
                          className="w-full gap-1.5 text-xs font-semibold"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy 500kbps Preset</span>
                        </Button>
                      </div>

                      {/* Preset 2: Local LAN / Studio Standard */}
                      <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 text-xs space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-bold text-foreground">
                            <Tv className="w-4 h-4 text-primary" />
                            <span>Studio Standard (1080p @ 2500kbps)</span>
                          </div>
                          <Badge variant="outline" className="text-[9px]">
                            HIGH SPEED FIBER
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          High-definition feed for local stage control monitors or fiber network connections.
                        </p>
                        <ul className="text-[11px] font-mono space-y-1 text-muted-foreground bg-background/50 p-2.5 rounded-lg border border-border/40">
                          <li>• Resolution: <strong>1920x1080 (1080p 30/60fps)</strong></li>
                          <li>• Bitrate: <strong>2,500 - 3,500 kbps (CBR)</strong></li>
                          <li>• Audio: <strong>128 kbps (AAC stereo)</strong></li>
                          <li>• Keyframe: <strong>2s</strong> | Max B-frames: <strong>0</strong></li>
                        </ul>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            const config = `OBS Studio 1080p Preset:
Resolution: 1920x1080 (1080p)
Bitrate: 2500 Kbps (CBR)
Audio: 128 Kbps AAC
Keyframe Interval: 2s
Max B-frames: 0
Tune: zerolatency`;
                            navigator.clipboard.writeText(config);
                            toast.success('1080p OBS preset copied!');
                          }}
                          className="w-full gap-1.5 text-xs"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy 1080p Preset</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Public 6-Digit PIN Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                        <KeyRound className="w-5 h-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                          <span>Public Audience View Link</span>
                          <Badge
                            variant={event.public_pin_enabled ? 'default' : 'secondary'}
                            className="text-[10px]"
                          >
                            {event.public_pin_enabled ? 'ACTIVE' : 'DISABLED'}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Allows anyone to join as a read-only viewer with a 6-digit PIN.
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {event.public_pin_enabled && event.public_pin ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-muted/40 border border-border/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                            6-Digit Room Access PIN
                          </span>
                          <div className="text-3xl font-mono font-bold tracking-widest text-purple-400">
                            {event.public_pin.slice(0, 3)} {event.public_pin.slice(3)}
                          </div>
                        </div>

                        {isAdmin && (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={handleGeneratePin}
                              disabled={pinActionLoading}
                              className="gap-1.5"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${pinActionLoading ? 'animate-spin' : ''}`} />
                              <span>Rotate PIN</span>
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={handleRevokePin}
                              disabled={pinActionLoading}
                              className="gap-1.5"
                            >
                              <ShieldOff className="w-3.5 h-3.5" />
                              <span>Revoke Access</span>
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Direct Shareable Public Link
                          </label>
                          {systemSettings?.alternative_domain && (
                            <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg border border-border/50">
                              <Button
                                size="xs"
                                variant={selectedDomainType === 'primary' ? 'default' : 'ghost'}
                                onClick={() => setSelectedDomainType('primary')}
                              >
                                Primary
                              </Button>
                              <Button
                                size="xs"
                                variant={selectedDomainType === 'alternative' ? 'default' : 'ghost'}
                                onClick={() => setSelectedDomainType('alternative')}
                              >
                                Alt / LAN
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            readOnly
                            value={`${getActiveBaseUrl()}/view/${event.public_pin}`}
                            className="font-mono text-xs"
                          />
                          <Button
                            type="button"
                            onClick={handleCopyPublicLink}
                            className="gap-1.5 shrink-0"
                          >
                            {copiedPinLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedPinLink ? 'Copied' : 'Copy Link'}</span>
                          </Button>
                          <Button
                            asChild
                            variant="outline"
                            size="icon"
                            className="shrink-0"
                          >
                            <a
                              href={`${getActiveBaseUrl()}/view/${event.public_pin}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in new tab"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-muted-foreground mb-4">
                        Public viewer access is currently disabled. Only invited crew members can open this event.
                      </p>
                      {isAdmin && (
                        <Button
                          onClick={handleGeneratePin}
                          disabled={pinActionLoading}
                          className="gap-2"
                        >
                          <KeyRound className="w-4 h-4" />
                          <span>{pinActionLoading ? 'Generating...' : 'Enable 6-Digit Public PIN'}</span>
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* Tab 5: Crew Roster */}
          <TabsContent value="crew" className="space-y-6 mt-0">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">Event Crew Members</h2>
                <p className="text-xs text-muted-foreground">
                  Assigned crew members with role-based permissions and custom callsigns.
                </p>
              </div>

              {isAdmin && (
                <Button onClick={() => setShowAddMember(true)} className="gap-2">
                  <UserPlus className="w-4 h-4" />
                  <span>Add Crew Member</span>
                </Button>
              )}
            </div>

            {/* Crew Table */}
            <Card className="p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Callsign</TableHead>
                    <TableHead>Joined</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {event.memberships?.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {m.user?.full_name || m.user?.username || 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          @{m.user?.username} • {m.user?.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={m.role} />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-foreground/80">
                        {m.callsign || <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString()}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemoveMember(m.id, m.user?.username)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="Remove Member"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Add Member Dialog using shadcn/ui */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              <span>Add Crew Member</span>
            </DialogTitle>
            <DialogDescription>
              Enter the username or email of a registered crew member to assign them a role.
            </DialogDescription>
          </DialogHeader>

          {inviteError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{inviteError}</span>
            </div>
          )}

          <form onSubmit={handleAddMember} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                Username or Email *
              </label>
              <Input
                type="text"
                required
                placeholder="e.g. lights_lead or sam@event.edu"
                value={inviteIdentifier}
                onChange={(e) => setInviteIdentifier(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                Crew Role *
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as EventRole)}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
              >
                <option value="crew" className="bg-popover text-popover-foreground">Crew (View stream, cues, walkie-talkie)</option>
                <option value="stage_manager" className="bg-popover text-popover-foreground">Stage Manager (Advance script cues, manage stream)</option>
                <option value="presenter" className="bg-popover text-popover-foreground">Presenter (Teleprompter view & cues)</option>
                <option value="viewer" className="bg-popover text-popover-foreground">Viewer (Read-only live stream)</option>
                <option value="admin" className="bg-popover text-popover-foreground">Admin (Full event & crew control)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                Callsign <span className="text-muted-foreground font-normal lowercase">(optional, e.g. SM-1, Audio Op)</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. Stage Left Op"
                value={inviteCallsign}
                onChange={(e) => setInviteCallsign(e.target.value)}
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddMember(false)}
                disabled={inviting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={inviting} className="gap-2">
                {inviting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Adding...</span>
                  </>
                ) : (
                  <span>Add Member</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function EventPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <EventContent />
    </Suspense>
  );
}
