'use client';

import React from 'react';
import { Radio, Volume2, VolumeX } from 'lucide-react';
import { WalkieActiveSpeaker } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface WalkieIncomingBannerProps {
  speaker: WalkieActiveSpeaker | null;
  audioLevel: number;
  isMuted: boolean;
  onToggleMute: () => void;
}

export function WalkieIncomingBanner({
  speaker,
  audioLevel,
  isMuted,
  onToggleMute,
}: WalkieIncomingBannerProps) {
  if (!speaker) return null;

  const roleLabels: Record<string, string> = {
    admin: 'Admin',
    stage_manager: 'Stage Manager',
    crew: 'Crew',
  };

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-destructive/95 text-destructive-foreground shadow-2xl backdrop-blur-md border border-white/20">
        <div className="relative flex items-center justify-center">
          <span className="w-3 h-3 rounded-full bg-white animate-ping absolute" />
          <span className="w-3 h-3 rounded-full bg-white relative" />
        </div>

        <Radio className="w-4 h-4 animate-pulse" />

        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider font-extrabold text-white/90">
            INCOMING VOICE:
          </span>
          <span className="text-sm font-bold text-white">
            {speaker.caller_name}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-white">
            {roleLabels[speaker.caller_role] || speaker.caller_role}
          </span>
        </div>

        {/* Dynamic Voice Waveform Equalizer */}
        <div className="flex items-center gap-1 h-4 px-2">
          {[0.3, 0.7, 1.0, 0.6, 0.8, 0.4].map((multiplier, idx) => {
            const h = Math.max(3, Math.min(16, audioLevel * 16 * multiplier + 3));
            return (
              <span
                key={idx}
                className="w-1 bg-white rounded-full transition-all duration-75"
                style={{ height: `${h}px` }}
              />
            );
          })}
        </div>

        {/* Mute incoming audio toggle */}
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleMute}
          className="h-7 px-2 text-white hover:bg-white/20 rounded-full"
          title={isMuted ? 'Unmute voice' : 'Mute incoming voice'}
        >
          {isMuted ? (
            <VolumeX className="w-4 h-4 text-white/70" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
