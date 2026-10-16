'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, EventItem, EventStatus } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
import { RoleBadge } from '@/components/RoleBadge';
import {
  Calendar,
  Plus,
  Radio,
  Clock,
  ArrowRight,
  Sparkles,
  AlertCircle,
  X,
  CheckCircle,
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New Event Modal State
  const [showModal, setShowModal] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventSlug, setNewEventSlug] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  const loadEvents = async () => {
    try {
      setLoadingEvents(true);
      const data = await api.listEvents();
      setEvents(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to load events');
      }
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadEvents();
    }
  }, [user]);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setCreating(true);

    try {
      if (!newEventName.trim()) {
        throw new Error('Event name is required');
      }

      const created = await api.createEvent({
        name: newEventName.trim(),
        slug: newEventSlug.trim() || undefined,
        description: newEventDesc.trim() || undefined,
      });

      setShowModal(false);
      setNewEventName('');
      setNewEventSlug('');
      setNewEventDesc('');
      router.push(`/events/${created.slug || created.id}`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setModalError(err.message);
      } else {
        setModalError('Failed to create event');
      }
    } finally {
      setCreating(false);
    }
  };

  if (isLoading || (!user && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#090b10]">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getStatusBadge = (status: EventStatus) => {
    switch (status) {
      case 'live':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse-live" />
            ON AIR
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            <CheckCircle className="w-3 h-3" />
            Completed
          </span>
        );
      case 'draft':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <Clock className="w-3 h-3" />
            Rehearsal / Draft
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#090b10] flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
              <span>Production Control Center</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Select an event to open the control room, live stream, cues & walkie-talkie
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Event</span>
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Events Grid */}
        {loadingEvents ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-48 rounded-2xl bg-[#11141f] border border-[#1e2638] animate-pulse"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-16 px-4 bg-[#11141f]/50 border border-[#1e2638] border-dashed rounded-2xl">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mx-auto mb-4">
              <Radio className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-slate-200">No events yet</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto mt-1 mb-6">
              You haven&apos;t joined or created any stage events yet. Create your first event to start streaming and coordinating crew members.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Event</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((ev) => (
              <div
                key={ev.id}
                onClick={() => router.push(`/events/${ev.slug || ev.id}`)}
                className="group cursor-pointer bg-[#11141f] hover:bg-[#151926] border border-[#1e2638] hover:border-blue-500/50 rounded-2xl p-6 transition-all duration-200 shadow-xl hover:shadow-2xl hover:shadow-blue-950/20 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    {getStatusBadge(ev.status)}
                    <RoleBadge role={ev.user_role} />
                  </div>

                  <h3 className="text-lg font-semibold text-slate-100 group-hover:text-blue-400 transition-colors line-clamp-1">
                    {ev.name}
                  </h3>

                  <p className="text-xs font-mono text-slate-400 mt-1">
                    Room Code: <span className="text-slate-300 font-semibold">{ev.slug}</span>
                  </p>

                  {ev.description && (
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                      {ev.description}
                    </p>
                  )}
                </div>

                <div className="pt-6 mt-4 border-t border-[#1e2638] flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{new Date(ev.created_at).toLocaleDateString()}</span>
                  </div>

                  <span className="inline-flex items-center gap-1 text-blue-400 font-medium group-hover:translate-x-0.5 transition-transform">
                    <span>Enter Room</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Event Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#11141f] border border-[#1e2638] w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-400" />
                <span>Create Production Event</span>
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Event Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2026 Spring Commencement"
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Room Code / Slug <span className="text-slate-500 font-normal">(Optional, e.g. gala-2026)</span>
                </label>
                <input
                  type="text"
                  placeholder="commencement-2026"
                  value={newEventSlug}
                  onChange={(e) => setNewEventSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  className="w-full px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                  Description <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Main stage audio & lighting coordination"
                  value={newEventDesc}
                  onChange={(e) => setNewEventDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-[#090b10] border border-[#1e2638] rounded-lg text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors flex items-center gap-2"
                >
                  {creating ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>Create & Enter</span>
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
