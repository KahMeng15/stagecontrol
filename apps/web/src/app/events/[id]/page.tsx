'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, EventDetail, EventRole, EventStatus } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
import { RoleBadge } from '@/components/RoleBadge';
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
  Clock,
  Sparkles,
  KeyRound,
  Link2,
  ExternalLink,
  ShieldOff,
} from 'lucide-react';

function EventContent() {
  const router = useRouter();
  const params = useParams();
  const eventId = (params?.id as string) || '';
  const { user, isLoading: authLoading } = useAuth();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'control' | 'stream' | 'crew'>('control');

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
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to load event details. You might not have access.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && eventId) {
      fetchEventData();
    }
  }, [user, eventId]);

  const handleCopyStreamKey = () => {
    if (event?.stream_key) {
      navigator.clipboard.writeText(event.stream_key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const handleRegenerateKey = async () => {
    if (!event || !confirm('Are you sure you want to regenerate the stream key? The current OBS stream will disconnect.')) {
      return;
    }
    try {
      setRegenerating(true);
      const updated = await api.regenerateStreamKey(event.id);
      setEvent((prev) => (prev ? { ...prev, stream_key: updated.stream_key } : null));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to regenerate stream key');
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
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to generate 6-digit PIN');
    } finally {
      setPinActionLoading(false);
    }
  };

  const handleRevokePin = async () => {
    if (!event || !confirm('Are you sure you want to revoke the 6-digit PIN? All guest viewers with this PIN will immediately lose access.')) {
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
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to revoke PIN access');
    } finally {
      setPinActionLoading(false);
    }
  };

  const handleCopyPublicLink = () => {
    if (event?.public_pin && typeof window !== 'undefined') {
      const url = `${window.location.origin}/view/${event.public_pin}`;
      navigator.clipboard.writeText(url);
      setCopiedPinLink(true);
      setTimeout(() => setCopiedPinLink(false), 2000);
    }
  };

  const handleStatusChange = async (newStatus: EventStatus) => {
    if (!event) return;
    try {
      setUpdatingStatus(true);
      const updated = await api.updateEvent(event.id, { status: newStatus });
      setEvent((prev) => (prev ? { ...prev, status: updated.status } : null));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update event status');
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

      setShowAddMember(false);
      setInviteIdentifier('');
      setInviteCallsign('');
      // Refresh event data to update members list
      await fetchEventData();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to add crew member');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (membershipId: string, username?: string) => {
    if (!event || !confirm(`Remove ${username || 'this member'} from the crew?`)) return;
    try {
      await api.removeMember(event.id, membershipId);
      await fetchEventData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  if (authLoading || (loading && !event && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#090b10]">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-[#090b10] flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-lg mx-auto px-4 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-100">Access Restricted</h2>
          <p className="text-sm text-slate-400 mt-2 mb-6">
            {error || 'You do not have permission to view this event.'}
          </p>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  const isAdmin = event.user_role === 'admin';
  const isSMOrAdmin = isAdmin || event.user_role === 'stage_manager';

  return (
    <div className="min-h-screen bg-[#090b10] flex flex-col">
      <Navbar />

      {/* Event Header Banner */}
      <div className="border-b border-[#1e2638] bg-[#0c0e16]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => router.push('/')}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
                  {event.name}
                </h1>
                <RoleBadge role={event.user_role} />
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-2">
                <span>Room Code: <strong className="font-mono text-slate-300">{event.slug}</strong></span>
                <span>•</span>
                <span>Created {new Date(event.created_at).toLocaleDateString()}</span>
              </p>
            </div>

            {/* Status and Actions */}
            <div className="flex items-center gap-3">
              {isSMOrAdmin ? (
                <div className="flex items-center gap-1.5 bg-[#11141f] border border-[#1e2638] rounded-xl p-1">
                  {(['draft', 'live', 'completed'] as EventStatus[]).map((st) => (
                    <button
                      key={st}
                      disabled={updatingStatus}
                      onClick={() => handleStatusChange(st)}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg capitalize transition-colors ${
                        event.status === st
                          ? st === 'live'
                            ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                            : 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {st === 'live' ? '🔴 Live' : st}
                    </button>
                  ))}
                </div>
              ) : (
                <span className={`px-3 py-1 text-xs font-semibold rounded-lg uppercase tracking-wider ${
                  event.status === 'live'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  Status: {event.status}
                </span>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-4 mt-6 border-t border-[#1e2638] pt-3">
            <button
              onClick={() => setActiveTab('control')}
              className={`flex items-center gap-2 text-sm font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'control'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-4 h-4" />
              <span>Control Room</span>
            </button>

            {isSMOrAdmin && (
              <button
                onClick={() => setActiveTab('stream')}
                className={`flex items-center gap-2 text-sm font-medium pb-2 border-b-2 transition-colors ${
                  activeTab === 'stream'
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Tv className="w-4 h-4" />
                <span>OBS & Video Setup</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('crew')}
              className={`flex items-center gap-2 text-sm font-medium pb-2 border-b-2 transition-colors ${
                activeTab === 'crew'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Crew Roster ({event.memberships?.length || 1})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Tab Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'control' && (
          <div className="space-y-6">
            {/* Control Room Top Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Video Player Card (Prepared for Milestone 2) */}
              <div className="lg:col-span-2 bg-[#11141f] border border-[#1e2638] rounded-2xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-[#1e2638] flex items-center justify-between bg-[#0e111a]">
                  <div className="flex items-center gap-2">
                    <Tv className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Live Program Feed
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    event.status === 'live' ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {event.status === 'live' ? 'STREAM READY' : 'OFF AIR'}
                  </span>
                </div>

                <div className="aspect-video bg-black/60 flex flex-col items-center justify-center p-6 text-center relative group">
                  <Tv className="w-12 h-12 text-slate-600 mb-3" />
                  <p className="text-sm font-medium text-slate-300">
                    MediaMTX Low-Latency Player
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    Connect OBS Studio with your event stream key to broadcast live WebRTC video to all crew.
                  </p>
                  {isSMOrAdmin && (
                    <button
                      onClick={() => setActiveTab('stream')}
                      className="mt-4 px-3 py-1.5 text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors"
                    >
                      View OBS Stream Key
                    </button>
                  )}
                </div>
              </div>

              {/* Walkie-Talkie & Comms Panel (Prepared for Milestone 4) */}
              <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Mic className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                        Crew Walkie-Talkie
                      </span>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                      VOICE READY
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 mb-6">
                    Real-time push-to-talk voice channel for stage directors, audio ops, and presenters.
                  </p>
                </div>

                <div className="flex flex-col items-center py-6 bg-[#0c0e16] rounded-xl border border-[#1e2638]">
                  <button
                    disabled
                    className="w-24 h-24 rounded-full bg-blue-600/10 border-2 border-blue-500/30 flex flex-col items-center justify-center text-blue-400 opacity-60 cursor-not-allowed"
                  >
                    <Mic className="w-8 h-8 mb-1" />
                    <span className="text-[10px] font-bold tracking-wider">HOLD TO TALK</span>
                  </button>
                  <span className="text-[11px] text-slate-500 mt-4">
                    Voice room: <strong>{event.slug}-comms</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Script & Cue Tracker View (Prepared for Milestone 3) */}
            <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Live Script & Cue Tracker
                  </span>
                </div>
                <span className="text-xs text-slate-400">Milestone 3 Synchronized Script</span>
              </div>

              <div className="py-12 text-center border border-dashed border-[#1e2638] rounded-xl">
                <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <h4 className="text-sm font-medium text-slate-300">No script loaded</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                  Import DOCX or text script in Milestone 3 to enable live line-by-line stage advancement and presenter teleprompter mode.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* OBS Stream Setup Tab */}
        {activeTab === 'stream' && isSMOrAdmin && (
          <div className="max-w-3xl space-y-6">
            <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100">OBS Studio Streaming Credentials</h2>
                  <p className="text-xs text-slate-400">
                    Use these credentials in OBS Studio or any RTMP/WHIP streaming software.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {/* RTMP Server URL */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Stream Server URL (RTMP)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value="rtmp://localhost:1935/live"
                      className="flex-1 px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg font-mono text-xs text-slate-200"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText('rtmp://localhost:1935/live');
                        alert('Server URL copied!');
                      }}
                      className="px-3 py-2 bg-[#1a2030] hover:bg-[#222b40] text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>

                {/* Stream Key */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Stream Key (Secret)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      readOnly
                      value={event.stream_key || '••••••••••••••••••••••••'}
                      className="flex-1 px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg font-mono text-xs text-blue-400"
                    />
                    <button
                      onClick={handleCopyStreamKey}
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-blue-600/20"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
                    </button>
                    {isAdmin && (
                      <button
                        onClick={handleRegenerateKey}
                        disabled={regenerating}
                        title="Regenerate Stream Key"
                        className="p-2 bg-[#1a2030] hover:bg-red-500/20 hover:text-red-400 text-slate-400 rounded-lg transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Never share this key publicly. Only Admins and Stage Managers can view or regenerate this key.
                  </p>
                </div>

                {/* WebRTC WHIP URL for low latency */}
                <div className="pt-4 border-t border-[#1e2638]">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    WHIP Ingest URL (Ultra-low latency WebRTC streaming)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={`http://localhost:8889/live/${event.stream_key}/whip`}
                    className="w-full px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg font-mono text-xs text-slate-400"
                  />
                </div>
              </div>
            </div>

            {/* Public 6-Digit PIN & Audience Access Card */}
            <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-600/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                      <span>Public Audience View Link</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        event.public_pin_enabled
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {event.public_pin_enabled ? 'ACTIVE' : 'DISABLED'}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400">
                      Allows anyone to join as a read-only viewer with a 6-digit PIN. No registration needed.
                    </p>
                  </div>
                </div>
              </div>

              {event.public_pin_enabled && event.public_pin ? (
                <div className="space-y-4 pt-2">
                  <div className="p-4 rounded-xl bg-[#0c0e16] border border-[#1e2638] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                        6-Digit Room Access PIN
                      </span>
                      <div className="text-3xl font-mono font-bold tracking-widest text-purple-400">
                        {event.public_pin.slice(0, 3)} {event.public_pin.slice(3)}
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleGeneratePin}
                          disabled={pinActionLoading}
                          className="px-3 py-2 bg-[#1a2030] hover:bg-[#222b40] text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                          title="Generate a new 6-digit PIN (replaces current)"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${pinActionLoading ? 'animate-spin' : ''}`} />
                          <span>Rotate PIN</span>
                        </button>
                        <button
                          onClick={handleRevokePin}
                          disabled={pinActionLoading}
                          className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                          title="Immediately block public access"
                        >
                          <ShieldOff className="w-3.5 h-3.5" />
                          <span>Revoke Access</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Direct Shareable Public Link
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={typeof window !== 'undefined' ? `${window.location.origin}/view/${event.public_pin}` : `/view/${event.public_pin}`}
                        className="flex-1 px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg font-mono text-xs text-slate-200"
                      />
                      <button
                        onClick={handleCopyPublicLink}
                        className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-purple-600/20"
                      >
                        {copiedPinLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedPinLink ? 'Copied' : 'Copy Link'}</span>
                      </button>
                      <a
                        href={`/view/${event.public_pin}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 bg-[#1a2030] hover:bg-[#222b40] text-slate-300 rounded-lg transition-colors"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Share this direct link with your audience or students. They can open it directly or enter the 6-digit PIN on the home page.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="pt-2">
                  <p className="text-xs text-slate-400 mb-4">
                    Public viewer access is currently disabled. Only invited crew members can open this event.
                  </p>
                  {isAdmin && (
                    <button
                      onClick={handleGeneratePin}
                      disabled={pinActionLoading}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-purple-600/20"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>{pinActionLoading ? 'Generating...' : 'Enable 6-Digit Public PIN'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Crew Roster Tab */}
        {activeTab === 'crew' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-100">Event Crew Members</h2>
                <p className="text-xs text-slate-400">
                  Assigned crew members with role-based permissions and custom callsigns.
                </p>
              </div>

              {isAdmin && (
                <button
                  onClick={() => setShowAddMember(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Add Crew Member</span>
                </button>
              )}
            </div>

            {/* Crew Table */}
            <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1e2638] bg-[#0c0e16] text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="px-6 py-3">Member</th>
                    <th className="px-6 py-3">Role</th>
                    <th className="px-6 py-3">Callsign</th>
                    <th className="px-6 py-3">Joined</th>
                    {isAdmin && <th className="px-6 py-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2638] text-sm">
                  {event.memberships?.map((m) => (
                    <tr key={m.id} className="hover:bg-[#151926] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-100">
                          {m.user?.full_name || m.user?.username || 'Unknown'}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          @{m.user?.username} • {m.user?.email}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <RoleBadge role={m.role} />
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-300">
                        {m.callsign || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {new Date(m.created_at).toLocaleDateString()}
                      </td>
                      {isAdmin && (
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleRemoveMember(m.id, m.user?.username)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Remove Member"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#11141f] border border-[#1e2638] w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100 mb-2 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-400" />
              <span>Add Crew Member</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Enter the username or email of a registered crew member to assign them a role.
            </p>

            {inviteError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{inviteError}</span>
              </div>
            )}

            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Username or Email *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. lights_lead or sam@event.edu"
                  value={inviteIdentifier}
                  onChange={(e) => setInviteIdentifier(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Crew Role *
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as EventRole)}
                  className="w-full px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="crew">Crew (View stream, cues, walkie-talkie)</option>
                  <option value="stage_manager">Stage Manager (Advance script cues, manage stream)</option>
                  <option value="presenter">Presenter (Teleprompter view & cues)</option>
                  <option value="viewer">Viewer (Read-only live stream)</option>
                  <option value="admin">Admin (Full event & crew control)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Callsign <span className="text-slate-500 font-normal">(Optional, e.g. SM-1, Audio Op)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Stage Left Op"
                  value={inviteCallsign}
                  onChange={(e) => setInviteCallsign(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddMember(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors flex items-center gap-2"
                >
                  {inviting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Add Member</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EventPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#090b10]">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <EventContent />
    </Suspense>
  );
}
