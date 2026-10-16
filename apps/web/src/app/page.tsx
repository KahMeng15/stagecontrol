'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, EventItem, EventStatus } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
import { RoleBadge } from '@/components/RoleBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Calendar,
  Plus,
  Radio,
  Clock,
  ArrowRight,
  Sparkles,
  AlertCircle,
  CheckCircle,
  Loader2,
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



  useEffect(() => {
    if (!user) return;
    let ignore = false;
    api.listEvents().then((data) => {
      if (!ignore) {
        setEvents(data);
        setLoadingEvents(false);
      }
    }).catch((err: unknown) => {
      if (!ignore) {
        const msg = err instanceof Error ? err.message : 'Failed to load events';
        setError(msg);
        toast.error('Failed to load events', { description: msg });
        setLoadingEvents(false);
      }
    });
    return () => {
      ignore = true;
    };
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

      toast.success('Event created successfully');
      setShowModal(false);
      setNewEventName('');
      setNewEventSlug('');
      setNewEventDesc('');
      router.push(`/events/${created.slug || created.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create event';
      setModalError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  if (isLoading || (!user && !error)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const renderStatusBadge = (status: EventStatus) => {
    switch (status) {
      case 'live':
        return (
          <Badge variant="destructive" className="gap-1.5 font-semibold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse-live" />
            ON AIR
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="secondary" className="gap-1 text-muted-foreground">
            <CheckCircle className="w-3 h-3" />
            Completed
          </Badge>
        );
      case 'draft':
      default:
        return (
          <Badge variant="outline" className="gap-1 border-blue-500/30 text-blue-400 bg-blue-500/10">
            <Clock className="w-3 h-3" />
            Rehearsal / Draft
          </Badge>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <span>Production Control Center</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Select an event to open the control room, live stream, cues & walkie-talkie
            </p>
          </div>

          <Button
            onClick={() => setShowModal(true)}
            size="lg"
            className="gap-2 shadow-lg shadow-primary/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Event</span>
          </Button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Events Grid */}
        {loadingEvents ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-48 rounded-xl bg-card border border-border/60 animate-pulse"
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <Card className="text-center py-16 px-4 border-dashed border-border/80 bg-card/40">
            <CardContent className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4">
                <Radio className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No events yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-1 mb-6">
                You haven&apos;t joined or created any stage events yet. Create your first event to start streaming and coordinating crew members.
              </p>
              <Button onClick={() => setShowModal(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                <span>Create Event</span>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((ev) => (
              <Card
                key={ev.id}
                onClick={() => router.push(`/events/${ev.slug || ev.id}`)}
                className="group cursor-pointer transition-all duration-200 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 flex flex-col justify-between"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {renderStatusBadge(ev.status)}
                    <RoleBadge role={ev.user_role} />
                  </div>

                  <CardTitle className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                    {ev.name}
                  </CardTitle>

                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                    Room Code: <span className="text-foreground/90 font-semibold">{ev.slug}</span>
                  </p>

                  {ev.description && (
                    <CardDescription className="line-clamp-2 mt-2">
                      {ev.description}
                    </CardDescription>
                  )}
                </CardHeader>

                <CardFooter className="pt-4 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{new Date(ev.created_at).toLocaleDateString()}</span>
                  </div>

                  <span className="inline-flex items-center gap-1 text-primary font-medium group-hover:translate-x-0.5 transition-transform">
                    <span>Enter Room</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Create Event Dialog using shadcn/ui */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span>Create Production Event</span>
            </DialogTitle>
            <DialogDescription>
              Set up a new event room for live stream ingestion, stage cues, and walkie-talkie audio.
            </DialogDescription>
          </DialogHeader>

          {modalError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{modalError}</span>
            </div>
          )}

          <form onSubmit={handleCreateEvent} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                Event Title *
              </label>
              <Input
                type="text"
                required
                placeholder="e.g. 2026 Spring Commencement"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                Room Code / Slug <span className="text-muted-foreground font-normal lowercase">(optional)</span>
              </label>
              <Input
                type="text"
                placeholder="commencement-2026"
                value={newEventSlug}
                onChange={(e) => setNewEventSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                className="font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground/90 uppercase tracking-wider">
                Description <span className="text-muted-foreground font-normal lowercase">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="Main stage audio & lighting coordination"
                value={newEventDesc}
                onChange={(e) => setNewEventDesc(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
              />
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowModal(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating} className="gap-2">
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <span>Create & Enter</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
