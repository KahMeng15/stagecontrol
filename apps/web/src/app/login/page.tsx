'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { api, setStoredToken } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { user, login, register, isLoading } = useAuth();

  const [authMode, setAuthMode] = useState<'login' | 'register' | 'guest'>('login');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');

  // Guest PIN state
  const [guestPin, setGuestPin] = useState('');
  const [guestDisplayName, setGuestDisplayName] = useState('');

  // System registration mode: 'open' | 'approval' | 'closed'
  const [registrationMode, setRegistrationMode] = useState<'open' | 'approval' | 'closed'>('open');
  const [approvalPendingMessage, setApprovalPendingMessage] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load registration mode
  useEffect(() => {
    let ignore = false;
    api.getRegistrationMode()
      .then((res) => {
        if (!ignore && res?.registration_mode) {
          setRegistrationMode(res.registration_mode);
        }
      })
      .catch(() => {
        // Fallback to open if settings cannot be queried
      });
    return () => {
      ignore = true;
    };
  }, []);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (!isLoading && user) {
      router.push('/');
    }
  }, [user, isLoading, router]);

  // If registration is closed and user was on register tab, switch to login
  useEffect(() => {
    if (registrationMode === 'closed' && authMode === 'register') {
      setAuthMode('login');
    }
  }, [registrationMode, authMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setApprovalPendingMessage(null);
    setSubmitting(true);

    try {
      if (authMode === 'guest') {
        const cleanPin = guestPin.replace(/\s+/g, '');
        if (cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
          throw new Error('Please enter a valid 6-digit PIN');
        }
        const res = await api.joinWithPublicPin(cleanPin, guestDisplayName.trim() || undefined);
        setStoredToken(res.access_token);
        router.push(`/events/${res.event.slug || res.event.id}`);
        return;
      }

      if (authMode === 'register') {
        if (!fullName.trim() || !email.trim() || !password) {
          throw new Error('Full Name, Email, and Password are all required.');
        }

        const res = await register(email.trim(), password, fullName.trim());
        if (res.requires_approval || !res.access_token) {
          setApprovalPendingMessage(
            res.message || 'Registration submitted! Your account is pending administrator approval before you can log in.'
          );
          setAuthMode('login');
          return;
        }

        router.push('/');
        return;
      }

      // Login
      if (!email.trim() || !password) {
        throw new Error('Please enter your email and password');
      }

      await login(email.trim(), password);
      router.push('/');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Authentication failed. Please check your credentials.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const showRegisterTab = registrationMode !== 'closed';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        {/* Minimal header matching Navbar styling */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block group">
            <span className="font-bold text-foreground tracking-tight text-3xl hover:text-foreground/80 transition-colors">
              stagecontrol
            </span>
          </Link>
          <p className="text-sm text-muted-foreground mt-2">
            Live event production, script cues &amp; crew comms
          </p>
        </div>

        {/* Auth Card using shadcn */}
        <Card className="border-border/60 shadow-lg bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold tracking-tight">
              {authMode === 'login' && 'Sign in to your crew account'}
              {authMode === 'register' && 'Create your crew account'}
              {authMode === 'guest' && 'Enter Room with Event PIN'}
            </CardTitle>
            <CardDescription className="text-xs">
              {authMode === 'login' && 'Enter your registered email and password to access production boards.'}
              {authMode === 'register' && 'Provide your name and email to join the production system.'}
              {authMode === 'guest' && 'Enter the 6-digit access PIN provided by your stage lead.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Tabs */}
            <Tabs
              value={authMode}
              onValueChange={(val) => {
                setAuthMode(val as 'login' | 'register' | 'guest');
                setError(null);
              }}
              className="w-full"
            >
              <TabsList className={`grid w-full ${showRegisterTab ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <TabsTrigger value="login">Sign In</TabsTrigger>
                {showRegisterTab && <TabsTrigger value="register">Register</TabsTrigger>}
                <TabsTrigger value="guest">Guest PIN</TabsTrigger>
              </TabsList>
            </Tabs>

            {approvalPendingMessage && (
              <div className="p-3.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{approvalPendingMessage}</span>
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {authMode === 'guest' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      6-Digit Event PIN *
                    </label>
                    <Input
                      type="text"
                      required
                      maxLength={6}
                      value={guestPin}
                      onChange={(e) => setGuestPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="e.g. 482910"
                      className="text-center font-mono text-xl tracking-[0.25em] h-12"
                      autoFocus
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Ask your event organizer or stage manager for the room&apos;s 6-digit access PIN.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Display Name / Nickname <span className="text-muted-foreground font-normal">(Optional)</span>
                    </label>
                    <Input
                      type="text"
                      value={guestDisplayName}
                      onChange={(e) => setGuestDisplayName(e.target.value)}
                      placeholder="Audience - Hall A or Your Name"
                    />
                  </div>
                </>
              )}

              {authMode === 'register' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Full Name *
                    </label>
                    <Input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Chen"
                      autoComplete="name"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Email Address *
                    </label>
                    <Input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@crew.org"
                      autoComplete="email"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Password *
                    </label>
                    <Input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}

              {authMode === 'login' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Email Address
                    </label>
                    <Input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="alex@crew.org"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Password
                    </label>
                    <Input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                    />
                  </div>
                </>
              )}

              <Button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 gap-2 shadow-sm"
              >
                {submitting ? (
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>
                      {authMode === 'guest'
                        ? 'Enter Room as Viewer'
                        : authMode === 'register'
                        ? 'Create Account'
                        : 'Sign In'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
