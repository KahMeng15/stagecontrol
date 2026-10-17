'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { LogOut, Settings, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="font-bold text-foreground tracking-tight text-base hover:text-foreground/80 transition-colors">
              stagecontrol
            </span>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-9 px-2.5 gap-2 text-foreground hover:bg-accent focus-visible:ring-1"
                >
                  <div className="flex flex-col text-right">
                    <span className="text-xs font-semibold leading-tight">
                      {user.full_name || user.username}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-normal">
                      @{user.username}
                    </span>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
                  Signed in as <strong className="text-foreground">@{user.username}</strong>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {user.is_superadmin && (
                  <DropdownMenuItem asChild>
                    <Link
                      href="/admin/settings"
                      className="flex items-center gap-2 cursor-pointer w-full"
                    >
                      <Settings className="w-4 h-4 text-muted-foreground" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </header>
  );
}
