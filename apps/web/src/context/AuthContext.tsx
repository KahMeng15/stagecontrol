'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, setStoredToken, User, AuthResponse } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthResponse>;
  register: (email: string, password: string, fullName: string) => Promise<AuthResponse>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      setUser(null);
      setStoredToken(null);
      setToken(null);
    }
  };

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('stagecontrol_token') : null;
    if (stored) {
      setToken(stored);
      refreshUser().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.login({ email, password });
    if (data.access_token) {
      setStoredToken(data.access_token);
      setToken(data.access_token);
      setUser(data.user);
    }
    return data;
  };

  const register = async (email: string, password: string, fullName: string) => {
    const data = await api.register({
      email,
      password,
      full_name: fullName,
    });
    if (data.access_token && !data.requires_approval) {
      setStoredToken(data.access_token);
      setToken(data.access_token);
      setUser(data.user);
    }
    return data;
  };

  const logout = () => {
    api.logout();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
