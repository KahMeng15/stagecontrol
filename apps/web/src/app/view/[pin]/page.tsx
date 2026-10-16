'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api, setStoredToken, PublicEventInfo } from '@/lib/api';
import { Radio, AlertCircle, ArrowRight, User } from 'lucide-react';

function ViewPinContent() {
  const router = useRouter();
  const params = useParams();
  const pin = (params?.pin as string) || '';

  const [eventInfo, setEventInfo] = useState<PublicEventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    async function loadInfo() {
      try {
        setLoading(true);
        setError(null);
        const info = await api.getPublicEventInfo(pin);
        setEventInfo(info);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Invalid or expired 6-digit PIN');
      } finally {
        setLoading(false);
      }
    }
    if (pin) {
      loadInfo();
    }
  }, [pin]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventInfo) return;
    setJoining(true);
    setError(null);

    try {
      const response = await api.joinWithPublicPin(pin, displayName.trim() || undefined);
      setStoredToken(response.access_token);
      router.push(`/events/${response.event.slug || response.event.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to join event room');
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#090b10] px-4 py-12 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/3 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 mb-3 shadow-lg shadow-blue-950/40">
            <Radio className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">StageControl Guest Access</h1>
          <p className="text-xs text-slate-400 mt-1">
            One-click viewer access via 6-digit PIN • No account required
          </p>
        </div>

        <div className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs text-slate-400">Verifying PIN {pin}...</p>
            </div>
          ) : error || !eventInfo ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 mx-auto mb-3">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-100 mb-1">Access Denied</h3>
              <p className="text-xs text-slate-400 mb-6">
                {error || 'This 6-digit PIN is invalid or has been revoked by the stage manager.'}
              </p>
              <button
                onClick={() => router.push('/login')}
                className="w-full py-2.5 px-4 bg-[#1a2030] hover:bg-[#222b40] text-slate-200 rounded-xl text-xs font-medium transition-colors"
              >
                Enter Another PIN or Sign In
              </button>
            </div>
          ) : (
            <div>
              {/* Event Preview Banner */}
              <div className="p-4 rounded-xl bg-[#0c0e16] border border-[#1e2638] mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800">
                    PIN Verified: {pin}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1.5 ${
                    eventInfo.status === 'live'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}>
                    {eventInfo.status === 'live' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    )}
                    <span>{eventInfo.status === 'live' ? 'ON AIR' : eventInfo.status.toUpperCase()}</span>
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-100">{eventInfo.name}</h2>
                {eventInfo.description && (
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {eventInfo.description}
                  </p>
                )}
              </div>

              <form onSubmit={handleJoin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                    Your Nickname / Callout <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. Audience - Hall A or Your Name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 bg-[#090b10] border border-[#1e2638] rounded-xl text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    You will join in read-only <strong>Viewer</strong> mode.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={joining}
                  className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 mt-4"
                >
                  {joining ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Enter Event Room</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ViewPinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#090b10]">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ViewPinContent />
    </Suspense>
  );
}
