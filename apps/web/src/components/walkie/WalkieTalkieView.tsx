'use client';

import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Radio,
  Users,
  Search,
  Volume2,
  VolumeX,
  Lock,
  Unlock,
  Trash2,
  Sparkles,
  Headphones,
  Activity,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { RoleBadge } from '@/components/RoleBadge';
import { WalkieCallCard } from './WalkieCallCard';
import { WalkieCall, WalkieActiveSpeaker, WalkiePresenceUser } from '@/lib/api';

interface WalkieTalkieViewProps {
  eventId: string;
  voiceRoom: string;
  isConnected: boolean;
  isTransmitting: boolean;
  isHandsFree: boolean;
  audioLevel: number;
  incomingSpeaker: WalkieActiveSpeaker | null;
  incomingAudioLevel: number;
  connectedUsers: WalkiePresenceUser[];
  channelBusyMessage: string | null;
  calls: WalkieCall[];
  isLoadingCalls: boolean;
  isMuted: boolean;
  volume: number;
  canManage: boolean;
  onStartTransmission: () => void;
  onStopTransmission: () => void;
  onToggleTransmission: () => void;
  onToggleMute: () => void;
  onVolumeChange: (vol: number) => void;
  onDeleteCall: (callId: string) => void;
  onClearCalls: () => void;
  onRefreshCalls: () => void;
}

export function WalkieTalkieView({
  eventId,
  voiceRoom,
  isConnected,
  isTransmitting,
  isHandsFree,
  audioLevel,
  incomingSpeaker,
  incomingAudioLevel,
  connectedUsers,
  channelBusyMessage,
  calls,
  isLoadingCalls,
  isMuted,
  volume,
  canManage,
  onStartTransmission,
  onStopTransmission,
  onToggleTransmission,
  onToggleMute,
  onVolumeChange,
  onDeleteCall,
  onClearCalls,
  onRefreshCalls,
}: WalkieTalkieViewProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCalls = calls.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.caller_name.toLowerCase().includes(q) ||
      (c.transcription && c.transcription.toLowerCase().includes(q))
    );
  });

  const isSomeoneElseSpeaking = !!incomingSpeaker;

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-border/70 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-foreground">
                Crew Walkie-Talkie Push-to-Talk
              </h2>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  isConnected
                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                    : 'border-muted text-muted-foreground'
                }`}
              >
                {isConnected ? 'SUB-100MS LIVE BROADCAST' : 'CONNECTING...'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Voice Room: <strong className="text-foreground">{voiceRoom || 'connecting...'}</strong>
            </p>
          </div>
        </div>

        {/* Volume & Audio Output Controls */}
        <div className="flex items-center gap-4 self-end md:self-auto">
          <div className="flex items-center gap-2 bg-muted/40 border border-border/50 rounded-lg px-3 py-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={onToggleMute}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title={isMuted ? 'Unmute audio' : 'Mute incoming audio'}
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4 text-destructive" />
              ) : (
                <Volume2 className="w-4 h-4 text-primary" />
              )}
            </Button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-20 md:w-28 h-1.5 bg-muted-foreground/30 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <span className="text-[10px] font-mono text-muted-foreground w-7 text-right">
              {isMuted ? '0%' : `${Math.round(volume * 100)}%`}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border/40 px-3 py-1.5 rounded-lg">
            <Users className="w-3.5 h-3.5" />
            <span>
              <strong className="text-foreground">{connectedUsers.length}</strong> online
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Left = PTT Station & Crew; Right = Call Recordings & AI Transcriptions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: PTT Station (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Tactile PTT Transmission Console */}
          <Card className="border-border/70 relative overflow-hidden shadow-sm">
            {isTransmitting && (
              <div className="absolute inset-0 bg-red-500/10 pointer-events-none animate-pulse" />
            )}
            {isSomeoneElseSpeaking && (
              <div className="absolute inset-0 bg-blue-500/10 pointer-events-none animate-pulse" />
            )}

            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Push-to-Talk Console
              </CardTitle>
            </CardHeader>

            <CardContent className="flex flex-col items-center justify-center py-8 space-y-6">
              {/* Radial Sound Waves Ring */}
              <div className="relative flex items-center justify-center">
                {(isTransmitting || isSomeoneElseSpeaking) && (
                  <div
                    className={`absolute w-48 h-48 rounded-full border-2 transition-all duration-75 pointer-events-none ${
                      isTransmitting
                        ? 'border-destructive/40 bg-destructive/10 animate-ping'
                        : 'border-blue-500/40 bg-blue-500/10 animate-pulse'
                    }`}
                    style={{
                      transform: `scale(${1 + (isTransmitting ? audioLevel : incomingAudioLevel) * 0.5})`,
                    }}
                  />
                )}

                {/* Giant Push-To-Talk Button */}
                <button
                  type="button"
                  onMouseDown={onStartTransmission}
                  onMouseUp={onStopTransmission}
                  onMouseLeave={isTransmitting && !isHandsFree ? onStopTransmission : undefined}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    onStartTransmission();
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    onStopTransmission();
                  }}
                  disabled={!isConnected || (isSomeoneElseSpeaking && !isTransmitting)}
                  className={`w-36 h-36 rounded-full flex flex-col items-center justify-center select-none shadow-2xl transition-all duration-150 relative z-10 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                    isTransmitting
                      ? 'bg-destructive text-white shadow-destructive/50 border-4 border-white ring-8 ring-destructive/30 animate-pulse'
                      : isSomeoneElseSpeaking
                      ? 'bg-blue-600 text-white shadow-blue-500/30 border-2 border-blue-400 cursor-not-allowed'
                      : 'bg-gradient-to-b from-card via-muted/60 to-muted hover:from-muted hover:to-muted/90 text-foreground border-4 border-border shadow-black/40 hover:border-emerald-500/50'
                  }`}
                >
                  {isTransmitting ? (
                    <>
                      <Mic className="w-12 h-12 mb-2 animate-bounce" />
                      <span className="text-xs font-black tracking-widest uppercase">
                        TRANSMITTING
                      </span>
                      <span className="text-[10px] opacity-80 font-mono mt-0.5">
                        BROADCASTING
                      </span>
                    </>
                  ) : isSomeoneElseSpeaking ? (
                    <>
                      <Radio className="w-11 h-11 mb-2 animate-pulse text-white" />
                      <span className="text-[11px] font-bold tracking-wider uppercase px-2 text-center truncate max-w-full">
                        {incomingSpeaker?.caller_name}
                      </span>
                      <span className="text-[10px] opacity-80 uppercase tracking-wider">
                        LISTENING
                      </span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-12 h-12 mb-2 text-emerald-400 group-hover:scale-110 transition-transform" />
                      <span className="text-xs font-bold tracking-wider uppercase text-foreground">
                        HOLD TO TALK
                      </span>
                      <span className="text-[10px] text-muted-foreground uppercase font-mono mt-0.5">
                        [SPACEBAR]
                      </span>
                    </>
                  )}
                </button>
              </div>

              {/* Live Mic VU Audio Meter */}
              <div className="w-full max-w-xs space-y-1.5">
                <div className="flex justify-between text-[10px] uppercase font-semibold text-muted-foreground">
                  <span>Microphone Input</span>
                  <span className="font-mono">
                    {Math.round((isTransmitting ? audioLevel : 0) * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-muted/60 rounded-full overflow-hidden p-0.5 border border-border/60">
                  <div
                    className={`h-full rounded-full transition-all duration-75 ${
                      isTransmitting ? 'bg-destructive' : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${Math.max(2, (isTransmitting ? audioLevel : 0) * 100)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Mode Switchers */}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant={isHandsFree ? 'default' : 'outline'}
                  onClick={onToggleTransmission}
                  className={`text-xs gap-1.5 ${
                    isHandsFree ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''
                  }`}
                >
                  {isHandsFree ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  {isHandsFree ? 'Hands-Free: LOCKED ON' : 'Toggle Hands-Free'}
                </Button>
              </div>

              {/* Channel Busy Warning */}
              {channelBusyMessage && (
                <div className="text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-4 py-1.5 rounded-full animate-in fade-in">
                  {channelBusyMessage}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Voice Room Crew Roster */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  <CardTitle className="text-xs font-bold uppercase tracking-wider">
                    Online Comms Crew ({connectedUsers.length})
                  </CardTitle>
                </div>
              </div>
              <CardDescription className="text-xs">
                Crew members actively tuned into this voice channel.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {connectedUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">
                  No other crew members online in this room.
                </p>
              ) : (
                <div className="divide-y divide-border/40">
                  {connectedUsers.map((user) => {
                    const isUserSpeaking = incomingSpeaker?.user_id === user.user_id;
                    return (
                      <div
                        key={user.user_id}
                        className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="relative">
                            <div className="w-7 h-7 rounded-full bg-muted border border-border/80 flex items-center justify-center font-bold text-xs text-foreground">
                              {user.caller_name.charAt(0).toUpperCase()}
                            </div>
                            <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-background absolute -bottom-0.5 -right-0.5" />
                          </div>
                          <div>
                            <span className="font-semibold text-xs text-foreground block">
                              {user.caller_name}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <RoleBadge role={user.caller_role as 'admin' | 'stage_manager' | 'crew' | 'presenter' | 'viewer'} />
                          {isUserSpeaking && (
                            <Badge variant="destructive" className="text-[9px] h-4 px-1.5 font-bold animate-pulse">
                              SPEAKING
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Specifications Info Card */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-bold text-foreground">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Production Audio Pipeline</span>
            </div>
            <ul className="space-y-1 list-disc list-inside text-[11px] text-muted-foreground/90">
              <li>16kHz Studio Mono PCM raw streaming (<span className="text-foreground">~80ms latency</span>)</li>
              <li>Survives tab switching and runs across laptop, tablet, and mobile</li>
              <li>Every transmission is automatically archived with full scrubbing replay</li>
              <li>AI Speech-to-text transcriptions generated automatically with Whisper</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Transmission Archive & AI Transcriptions (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-foreground">
                  Call History & AI Transcriptions
                </h3>
                <Badge variant="secondary" className="font-mono text-xs">
                  {calls.length} calls
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Replay recorded voice calls and inspect automated Whisper transcriptions.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onRefreshCalls}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                title="Refresh call log"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                Refresh
              </Button>

              {canManage && calls.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onClearCalls}
                  className="h-8 text-xs text-destructive hover:bg-destructive/10 border-destructive/30"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Clear Archive
                </Button>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search transmissions by crew name or transcribed words..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs bg-card/60"
            />
          </div>

          {/* Call list */}
          {isLoadingCalls && calls.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground space-y-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p>Loading recorded calls...</p>
            </div>
          ) : filteredCalls.length === 0 ? (
            <Card className="border-dashed border-border/80 bg-muted/10 py-12 text-center">
              <CardContent className="space-y-3">
                <div className="w-12 h-12 rounded-full bg-muted border border-border/60 flex items-center justify-center mx-auto text-muted-foreground">
                  <Headphones className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-foreground">
                    {searchQuery ? 'No matching calls found' : 'No recorded calls yet'}
                  </h4>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                    {searchQuery
                      ? 'Try searching with different keywords or clear the filter.'
                      : 'Hold the Push-to-Talk button or press Spacebar to broadcast a live message to the crew. All transmissions are saved here with AI transcripts.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
              {filteredCalls.map((call) => (
                <WalkieCallCard
                  key={call.id}
                  call={call}
                  canManage={canManage}
                  onDelete={onDeleteCall}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
