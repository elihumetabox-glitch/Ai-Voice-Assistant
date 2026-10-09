"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Calendar, CheckCircle2, LogOut, Loader2, AlertCircle } from "lucide-react";
import { logSafeFailure } from "@/lib/safeLogging";

interface GoogleAuthStatus {
  connected: boolean;
  provider?: string;
  email?: string;
  google_email?: string;
  expires_at?: string;
  can_refresh?: boolean;
  scope?: string;
  error?: string;
}

export function GoogleCalendarAuth() {
  const [status, setStatus] = useState<GoogleAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/auth/google/status", {
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setStatus({ connected: false });
      }
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Listen for cross-window messages from OAuth popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "GOOGLE_AUTH_SUCCESS") {
        fetchStatus();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fetchStatus]);

  const handleConnect = async () => {
    setActionLoading(true);
    const width = 520;
    const height = 650;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      "",
      "GoogleOAuth",
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );

    const callbackUrl = `${window.location.origin}/auth/google/callback`;
    try {
      const res = await fetch(`/auth/google/url?redirect_uri=${encodeURIComponent(callbackUrl)}`, { cache: "no-store", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.auth_url && popup) {
          popup.location.href = data.auth_url;
        } else if (popup) {
          popup.location.href = `/auth/google/login?redirect_uri=${encodeURIComponent(callbackUrl)}`;
        }
      } else if (popup) {
        popup.location.href = `/auth/google/login?redirect_uri=${encodeURIComponent(callbackUrl)}`;
      }
    } catch {
      if (popup) popup.location.href = `/auth/google/login?redirect_uri=${encodeURIComponent(callbackUrl)}`;
    }

    // Fallback timer if popup closed without postMessage
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setActionLoading(false);
        fetchStatus();
      }
    }, 1000);
  };

  const handleDisconnect = async () => {
    setActionLoading(true);
    try {
      await fetch("/auth/google/disconnect", {
        method: "POST",
        credentials: "include",
      });
      await fetchStatus();
    } catch (err) {
      logSafeFailure("Google Calendar disconnect failed", err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/60 border border-slate-800 text-slate-400 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
        <span>Checking Calendar...</span>
      </div>
    );
  }

  if (status?.connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-medium">Calendar Connected</span>
        </div>
        {(status.email || status.google_email) && (
          <span className="text-xs text-slate-400" title="Connected Google account">
            {status.email || status.google_email}
          </span>
        )}
        <button
          onClick={handleDisconnect}
          disabled={actionLoading}
          title="Disconnect Google Calendar"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 border border-transparent hover:border-rose-900/50 transition-all"
        >
          {actionLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <LogOut className="w-3 h-3" />
          )}
          <span>Disconnect</span>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={actionLoading}
      className="flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs border border-indigo-500/50 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
    >
      {actionLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Calendar className="w-3.5 h-3.5 text-indigo-200" />
      )}
      <span>Connect Google Calendar</span>
    </button>
  );
}
