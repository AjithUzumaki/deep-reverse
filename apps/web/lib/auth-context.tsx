"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { apiFetch } from "./api";

interface AuthUser {
  id: string;
  email: string;
  display_name: string;
}

interface AuthResponse {
  access_token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    try {
      const res = await apiFetch<AuthResponse>("/auth/refresh", { method: "POST" });
      setAccessToken(res.access_token);
      setUser(res.user);
      return res.access_token;
    } catch {
      return null;
    }
  }, []);

  // Initial silent auth check on mount
  useEffect(() => {
    refreshSession().finally(() => setLoading(false));
  }, [refreshSession]);

  // Proactive background keep-alive: Silently refreshes token every 10 minutes
  // ensuring conversations can run infinitely without session timeouts or 15-min drops.
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      refreshSession();
    }, 10 * 60 * 1000); // every 10 minutes

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSession();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [user, refreshSession]);

  async function login(email: string, password: string) {
    const res = await apiFetch<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(res.access_token);
    setUser(res.user);
  }

  async function register(email: string, password: string, displayName: string) {
    const res = await apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    setAccessToken(res.access_token);
    setUser(res.user);
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {
      // Best-effort logout
    });
    setAccessToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, register, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
