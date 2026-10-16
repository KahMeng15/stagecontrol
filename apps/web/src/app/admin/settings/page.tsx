'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, SystemSettings } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
import {
  Globe,
  Network,
  Shield,
  Save,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Copy,
  Info,
} from 'lucide-react';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [primaryDomain, setPrimaryDomain] = useState('');
  const [alternativeDomain, setAlternativeDomain] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    async function loadSettings() {
      if (!user) return;
      try {
        setLoading(true);
        const data = await api.getSettings();
        setSettings(data);
        setPrimaryDomain(data.primary_domain || '');
        setAlternativeDomain(data.alternative_domain || '');
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load system settings');
      } finally {
        setLoading(false);
      }
    }

    if (user?.is_superadmin) {
      loadSettings();
    } else {
      setLoading(false);
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const updated = await api.updateSettings({
        primary_domain: primaryDomain.trim() || null,
        alternative_domain: alternativeDomain.trim() || null,
      });
      setSettings(updated);
      setPrimaryDomain(updated.primary_domain || '');
      setAlternativeDomain(updated.alternative_domain || '');
      setSuccessMsg('Global domain configuration updated successfully!');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (loading && !settings && !errorMsg)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#090b10]">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Permission Guard
  if (!user?.is_superadmin) {
    return (
      <div className="min-h-screen bg-[#090b10] flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-lg mx-auto px-4 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-100">Superadmin Access Required</h2>
          <p className="text-sm text-slate-400 mt-2 mb-6">
            Global system domains and network settings can only be configured by Lead Superadmins.
          </p>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  const cleanPrimary = primaryDomain.trim().replace(/\/$/, '') || 'http://localhost:3000';
  const cleanAlternative = alternativeDomain.trim().replace(/\/$/, '');

  return (
    <div className="min-h-screen bg-[#090b10] flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/')}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#1a2030] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
                <span>Domain & Network Settings</span>
              </h1>
            </div>
            <p className="text-sm text-slate-400">
              Configure the global canonical domain and fallback LAN domain for audience links, teleprompter, and crew comms.
            </p>
          </div>
        </div>

        {successMsg && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          <form onSubmit={handleSave} className="bg-[#11141f] border border-[#1e2638] rounded-2xl p-6 sm:p-8 shadow-xl space-y-6">
            {/* Primary Global Domain */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Globe className="w-4 h-4 text-blue-400" />
                <label className="text-sm font-bold text-slate-100 uppercase tracking-wider text-xs">
                  Primary Global Domain
                </label>
              </div>
              <p className="text-xs text-slate-400 mb-2">
                The canonical public URL used when generating shareable links, 6-digit PIN invites, and teleprompter displays.
              </p>
              <input
                type="text"
                placeholder="https://stagecontrol.yourdomain.com (or http://localhost:3000)"
                value={primaryDomain}
                onChange={(e) => setPrimaryDomain(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#090b10] border border-[#1e2638] rounded-xl text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-500 block mt-1">
                Leave blank or set to your public domain (e.g. <code>https://stage.myschool.edu</code>).
              </span>
            </div>

            {/* Alternative Domain / LAN Fallback */}
            <div className="pt-4 border-t border-[#1e2638]">
              <div className="flex items-center gap-2 mb-1.5">
                <Network className="w-4 h-4 text-purple-400" />
                <label className="text-sm font-bold text-slate-100 uppercase tracking-wider text-xs">
                  Alternative Domain / Local LAN Fallback
                </label>
              </div>
              <p className="text-xs text-slate-400 mb-2">
                Secondary domain or local LAN IP address. Essential when event crew or student devices operate on an isolated local Wi-Fi router without internet access.
              </p>
              <input
                type="text"
                placeholder="http://192.168.1.100:3000 or https://backup.yourdomain.com"
                value={alternativeDomain}
                onChange={(e) => setAlternativeDomain(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#090b10] border border-[#1e2638] rounded-xl text-sm font-mono text-purple-300 placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
              <span className="text-[11px] text-slate-500 block mt-1">
                Example: Local venue IP like <code>http://10.0.1.50:3000</code> or backup tunnel.
              </span>
            </div>

            {/* Live Link Preview Box */}
            <div className="p-4 rounded-xl bg-[#0c0e16] border border-[#1e2638] space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Info className="w-4 h-4 text-blue-400" />
                <span>Live Share Link Preview</span>
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-sans">Primary 6-Digit PIN Link:</span>
                  <span className="text-blue-400 break-all">{cleanPrimary}/view/482910</span>
                </div>

                {cleanAlternative && (
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-sans">Alternative / LAN Link:</span>
                    <span className="text-purple-400 break-all">{cleanAlternative}/view/482910</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => router.push('/')}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white transition-colors flex items-center gap-2 shadow-lg shadow-blue-600/20"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save Domain Settings</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
