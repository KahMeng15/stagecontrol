'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, SystemSettings } from '@/lib/api';
import { Navbar } from '@/components/Navbar';
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
import { toast } from 'sonner';
import {
  Globe,
  Network,
  Shield,
  Save,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
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
        const msg = err instanceof Error ? err.message : 'Failed to load system settings';
        setErrorMsg(msg);
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
      const msg = 'Global domain configuration updated successfully!';
      setSuccessMsg(msg);
      toast.success(msg);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update settings';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (loading && !settings && !errorMsg)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Permission Guard
  if (!user?.is_superadmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-lg mx-auto px-4 flex flex-col items-center justify-center text-center">
          <Card className="p-8 max-w-md w-full shadow-sm text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-4">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Superadmin Access Required</h2>
            <p className="text-sm text-muted-foreground mt-2 mb-6 leading-relaxed">
              Global system domains and network settings can only be configured by Lead Superadmins.
            </p>
            <Button
              onClick={() => router.push('/')}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Dashboard</span>
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const cleanPrimary = primaryDomain.trim().replace(/\/$/, '') || 'http://localhost:3000';
  const cleanAlternative = alternativeDomain.trim().replace(/\/$/, '');

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push('/')}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Domain & Network Settings
              </h1>
            </div>
            <p className="text-sm text-muted-foreground pl-10">
              Configure the global canonical domain and fallback LAN domain for audience links, teleprompter, and crew comms.
            </p>
          </div>
        </div>

        {successMsg && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-sm flex items-center gap-3">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          <Card className="shadow-sm">
            <form onSubmit={handleSave}>
              <CardContent className="p-6 sm:p-8 space-y-6">
                {/* Primary Global Domain */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Primary Global Domain
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The canonical public URL used when generating shareable links, 6-digit PIN invites, and teleprompter displays.
                  </p>
                  <Input
                    type="text"
                    placeholder="https://stagecontrol.yourdomain.com (or http://localhost:3000)"
                    value={primaryDomain}
                    onChange={(e) => setPrimaryDomain(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <span className="text-[11px] text-muted-foreground block">
                    Leave blank or set to your public domain (e.g. <code className="text-foreground">https://stage.myschool.edu</code>).
                  </span>
                </div>

                {/* Alternative Domain / LAN Fallback */}
                <div className="pt-6 border-t border-border/60 space-y-2">
                  <div className="flex items-center gap-2">
                    <Network className="w-4 h-4 text-purple-400" />
                    <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Alternative Domain / Local LAN Fallback
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Secondary domain or local LAN IP address. Essential when event crew or student devices operate on an isolated local Wi-Fi router without internet access.
                  </p>
                  <Input
                    type="text"
                    placeholder="http://192.168.1.100:3000 or https://backup.yourdomain.com"
                    value={alternativeDomain}
                    onChange={(e) => setAlternativeDomain(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <span className="text-[11px] text-muted-foreground block">
                    Example: Local venue IP like <code className="text-foreground">http://10.0.1.50:3000</code> or backup tunnel.
                  </span>
                </div>

                {/* Live Link Preview Box */}
                <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Info className="w-4 h-4 text-primary" />
                    <span>Live Share Link Preview</span>
                  </div>

                  <div className="space-y-2 text-xs font-mono">
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-sans">Primary 6-Digit PIN Link:</span>
                      <span className="text-primary break-all">{cleanPrimary}/view/482910</span>
                    </div>

                    {cleanAlternative && (
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase font-sans">Alternative / LAN Link:</span>
                        <span className="text-purple-400 break-all">{cleanAlternative}/view/482910</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex items-center justify-end gap-3 px-6 sm:px-8 py-4 border-t border-border/60 bg-muted/20">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => router.push('/')}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="gap-2 shadow-sm"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save Domain Settings</span>
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}
