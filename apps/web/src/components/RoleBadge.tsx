import React from 'react';
import { EventRole } from '@/lib/api';
import { ShieldAlert, ShieldCheck, Radio, Mic, Eye } from 'lucide-react';

interface RoleBadgeProps {
  role?: EventRole | string;
  callsign?: string | null;
  className?: string;
}

export function RoleBadge({ role, callsign, className = '' }: RoleBadgeProps) {
  if (!role) return null;

  const getRoleConfig = (r: string) => {
    switch (r) {
      case 'admin':
        return {
          label: 'Admin',
          icon: ShieldAlert,
          bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        };
      case 'stage_manager':
        return {
          label: 'Stage Mgr',
          icon: ShieldCheck,
          bg: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
        };
      case 'crew':
        return {
          label: 'Crew',
          icon: Radio,
          bg: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
        };
      case 'presenter':
        return {
          label: 'Presenter',
          icon: Mic,
          bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        };
      case 'viewer':
      default:
        return {
          label: 'Viewer',
          icon: Eye,
          bg: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
        };
    }
  };

  const config = getRoleConfig(role);
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.bg} ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{config.label}</span>
      {callsign && (
        <span className="opacity-75 border-l border-current pl-1 ml-0.5 font-mono text-[10px]">
          {callsign}
        </span>
      )}
    </span>
  );
}
