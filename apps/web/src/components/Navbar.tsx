'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { LogOut, Sliders, Shield } from 'lucide-react';

export function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#1e2638] bg-[#0c0e16]/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 group-hover:bg-blue-600/30 transition-colors">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold text-slate-100 tracking-tight text-base">StageControl</span>
              <span className="hidden sm:inline-block ml-2 px-1.5 py-0.2 rounded text-[10px] font-mono uppercase bg-blue-950 text-blue-300 border border-blue-800">
                PROD
              </span>
            </div>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col text-right">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-xs font-medium text-slate-200">
                  {user.full_name || user.username}
                </span>
                {user.is_superadmin && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30">
                    <Shield className="w-2.5 h-2.5" />
                    Admin
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400">@{user.username}</span>
            </div>

            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-1.5 rounded-lg border border-[#1e2638] bg-[#11141f] text-slate-400 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
