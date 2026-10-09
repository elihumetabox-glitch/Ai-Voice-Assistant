"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode, type RefObject } from "react";
import { TestingSandboxPage } from "./components/sandbox/TestingSandboxPage";
import { BookingUpdateCenter } from "./components/tasks/BookingUpdateCenter";
import type { CapabilityId, ResponseLanguage } from "./lib/capabilityRegistry";
import { logSafeFailure } from "./lib/safeLogging";
import { clearWorkspaceCache, getCompanyProfile, getSession, setCachedCompanyProfile } from "./lib/workspaceCache";
import * as Lu from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, KeyValue, SelectWrap, Skeleton, StatCard, Toast, cn, controlCls, selectCls, type Tone } from "./components/app/ui";

type Page =
  | "landing"
  | "signup"
  | "onboarding-goals"
  | "onboarding-company"
  | "onboarding-ai"
  | "dashboard"
  | "calls"
  | "phone-numbers"
  | "integrations"
  | "company-setup"
  | "assistant-config"
  | "testing-sandbox";

const assetPathPrefix = "/assets";

// ─── Icons ────────────────────────────────────────────────────────────────────

function LogoIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#3B5BDB" />
      <path d="M10 22V10l12 6-12 6z" fill="white" />
    </svg>
  );
}

function IconDashboard({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="11" y="1" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="1" y="11" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
    </svg>
  );
}

function IconCalls({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3.5 3C3.5 2.72 3.72 2.5 4 2.5h2.5c.24 0 .45.17.49.4l.7 3.5c.04.2-.05.4-.22.52L6 8c.9 2 2.5 3.6 4.5 4.5l1.08-1.47c.12-.17.32-.26.52-.22l3.5.7c.23.04.4.25.4.49V14c0 .28-.22.5-.5.5A11.5 11.5 0 013.5 3z" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPhone({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="5" y="1.5" width="8" height="15" rx="2" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <circle cx="9" cy="13.5" r="1" fill={active ? "white" : "#8899BB"} />
    </svg>
  );
}

function IconIntegrations({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="4" cy="9" r="2.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <circle cx="14" cy="4" r="2.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <circle cx="14" cy="14" r="2.5" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <path d="M6.5 9h3m0 0l2.5-4m-2.5 4l2.5 4" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCompany({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="7" width="14" height="9.5" rx="1" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <path d="M5.5 7V5a3.5 3.5 0 017 0v2" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <rect x="7.5" y="11" width="3" height="3" rx="0.5" fill={active ? "white" : "#8899BB"} />
    </svg>
  );
}

function IconAssistant({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" />
      <path d="M6 11.5c0-1.66 1.34-3 3-3s3 1.34 3 3" stroke={active ? "white" : "#8899BB"} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="7" r="1.5" fill={active ? "white" : "#8899BB"} />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 8l3.5 3.5L13 5" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect x="10" y="3" width="8" height="14" rx="4" fill="white" />
      <path d="M6 15a8 8 0 0016 0" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 23v3" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L4 6v6c0 5.25 3.5 9.74 8 10.93C16.5 21.74 20 17.25 20 12V6l-8-4z" stroke="#22C55E" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Layout: App Shell ────────────────────────────────────────────────────────

const NAV_ITEMS: { id: Page; label: string; icon: Lu.LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: Lu.LayoutDashboard },
  { id: "calls", label: "Calls Stream", icon: Lu.PhoneCall },
  { id: "phone-numbers", label: "Phone Numbers", icon: Lu.Hash },
  { id: "integrations", label: "Integrations", icon: Lu.Plug },
  { id: "company-setup", label: "Company Setup", icon: Lu.Building2 },
  { id: "assistant-config", label: "AI Assistant", icon: Lu.Bot },
];

function Sidebar({
  page,
  setPage,
  open,
  onClose,
  closeButtonRef,
}: {
  page: Page;
  setPage: (p: Page) => void;
  open: boolean;
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement>;
}) {
  const go = (p: Page) => {
    setPage(p);
    onClose();
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        id="app-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-hidden bg-slate-950 transition-transform duration-300 ease-out lg:visible lg:w-64 lg:max-w-none lg:translate-x-0",
          open ? "translate-x-0 shadow-2xl" : "invisible -translate-x-full",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(60%_60%_at_30%_0%,rgba(99,102,241,0.35),transparent)]" />

        <div className="relative flex items-center gap-3 px-5 pb-5 pt-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <Lu.AudioWaveform className="h-5 w-5" />
          </div>
          <span className="font-[Bricolage_Grotesque] text-lg font-bold tracking-tight text-white">vocalist.ai</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white lg:hidden"
          >
            <Lu.X className="h-5 w-5" />
          </button>
        </div>

        <nav className="relative flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main">
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workspace</div>
          {NAV_ITEMS.map((item) => {
            const active = page === item.id || (item.id === "assistant-config" && page === "testing-sandbox");
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition",
                  active ? "bg-white/10 text-white ring-1 ring-inset ring-white/10" : "text-slate-400 hover:bg-white/5 hover:text-white",
                )}
              >
                {active && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400" />}
                <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-indigo-300" : "text-slate-500 group-hover:text-slate-300")} />
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <AccountFooter />
      </aside>
    </>
  );
}

function AccountFooter() {
  const [account, setAccount] = useState<{ name?: string; email?: string } | null>(null);
  const [signOutError, setSignOutError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getSession()
      .then((payload) => {
        if (!payload) return;
        const user = payload?.user || payload?.session?.user;
        if (active && user) {
          setAccount({
            name: typeof user.name === "string" ? user.name : undefined,
            email: typeof user.email === "string" ? user.email : undefined,
          });
        }
      })
      .catch(() => { if (active) setAccount(null); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    setBusy(true);
    setSignOutError(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Sign-out failed");
      clearWorkspaceCache();
      window.location.assign("/sign-in");
    } catch {
      setSignOutError(true);
      setBusy(false);
    }
  }

  const accountLabel = account?.name || account?.email || "Account unavailable";
  const initial = (account?.name || account?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative border-t border-white/10 p-3">
      <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
        <div aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-sm font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div title={accountLabel} className="truncate text-[13px] font-semibold text-white">{accountLabel}</div>
          <div title={account?.email} className="truncate text-[11px] text-slate-400">{account?.email || "Email unavailable"}</div>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-60"
        >
          {busy ? <Lu.Loader2 className="h-4 w-4 animate-spin" /> : <Lu.LogOut className="h-4 w-4" />}
        </button>
      </div>
      {signOutError && <div role="alert" className="mt-2 px-1 text-[11px] text-rose-300">Could not sign out. Retry.</div>}
    </div>
  );
}

function AppHeader({
  title,
  subtitle,
  onMenuClick,
  menuOpen,
  menuButtonRef,
}: {
  title: string;
  subtitle: string;
  onMenuClick: () => void;
  menuOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement>;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
        >
          <Lu.Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-[Bricolage_Grotesque] text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h1>
          <p className="hidden truncate text-[13px] text-slate-500 sm:block">{subtitle}</p>
        </div>
      </div>
    </header>
  );
}

function AppShell({ page, setPage, children, title, subtitle }: {
  page: Page;
  setPage: (p: Page) => void;
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    burgerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNav();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [navOpen, closeNav]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setNavOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="app-light min-h-screen bg-slate-50 font-[Inter] text-slate-900">
      <Sidebar page={page} setPage={setPage} open={navOpen} onClose={closeNav} closeButtonRef={closeRef} />
      <div className="flex min-h-screen flex-col lg:pl-64">
        <AppHeader title={title} subtitle={subtitle} onMenuClick={() => setNavOpen(true)} menuOpen={navOpen} menuButtonRef={burgerRef} />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ setPage }: { setPage: (p: Page) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const mq = window.matchMedia("(min-width: 861px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onChange);
    };
  }, []);

  const goSignIn = () => window.location.assign("/sign-in");

  return (
    <div style={{ minHeight: "100vh", background: "white", fontFamily: "Inter" }}>
      {/* Nav */}
      <nav className="lp-nav sticky top-0 z-50 flex h-16 items-center gap-6 border-b border-[#E8ECF4]/80 bg-white/85 px-5 backdrop-blur-md sm:px-10">
        <div className="flex items-center gap-2">
          <LogoIcon />
          <span style={{ fontFamily: "Bricolage Grotesque" }} className="text-base font-bold text-[#0D1526]">
            vocalist.ai
          </span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E2E8F0] text-[#0D1526] max-[860px]:flex hidden"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="lp-menu"
        >
          {menuOpen ? <IconClose /> : <IconMenu />}
        </button>
        <div id="lp-menu" data-open={menuOpen} className="lp-links flex items-center gap-6 max-[860px]:flex-col max-[860px]:items-stretch max-[860px]:gap-1">
          <span onClick={goSignIn} className="cursor-pointer py-3 text-sm text-[#4B5563] transition hover:text-[#0D1526] max-[860px]:border-b max-[860px]:border-[#F1F5F9] max-[860px]:py-3.5 max-[860px]:text-base">
            Sign In
          </span>
          <button
            onClick={goSignIn}
            className="rounded-lg bg-[#3B5BDB] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(13,21,38,0.06)] transition hover:shadow-[0_8px_20px_-6px_rgba(59,91,219,0.55)] max-[860px]:mt-3 max-[860px]:w-full max-[860px]:py-3"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* Hero — soft gradient mesh behind a two-column layout: copy + a live "AI receptionist" call demo */}
      <div className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl"
          style={{ background: "radial-gradient(closest-side, #3B5BDB, transparent)" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-40 right-0 h-[420px] w-[420px] rounded-full opacity-[0.14] blur-3xl"
          style={{ background: "radial-gradient(closest-side, #14B8A6, transparent)" }}
        />

        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 px-5 pb-16 pt-16 sm:px-10 sm:pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* Copy */}
          <div className="text-center lg:text-left">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-[#EEF2FF] px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-[#3B5BDB] lg:mx-0">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3B5BDB]" />
              AI RECEPTIONIST FOR YOUR BUSINESS PHONE LINE
            </div>
            <h1
              style={{ fontFamily: "Bricolage Grotesque" }}
              className="mt-6 text-[38px] font-extrabold leading-[1.08] tracking-tight text-[#0D1526] sm:text-[52px] lg:text-[58px]"
            >
              Never miss a call.
              <br />
              Let AI answer{" "}
              <span className="bg-gradient-to-r from-[#3B5BDB] to-[#14B8A6] bg-clip-text text-transparent">
                like your best receptionist.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-[520px] text-[16px] leading-[1.7] text-[#4B5563] lg:mx-0">
              Vocalist answers calls routed through your 3CX phone system, checks your Google Calendar,
              books and cancels appointments, and represents your company&apos;s tone — configured entirely
              by you, scoped to your account.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3 lg:justify-start">
              <button
                onClick={goSignIn}
                className="rounded-xl bg-[#3B5BDB] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(59,91,219,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-12px_rgba(59,91,219,0.65)]"
              >
                Configure Your Assistant
              </button>
              <a
                href="#real-session-title"
                className="rounded-xl border border-[#E2E8F0] bg-white px-7 py-3.5 text-sm font-semibold text-[#0D1526] transition hover:border-[#CBD5E1] hover:bg-[#F8FAFC]"
              >
                See it in action
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-[#7A8BAD] lg:justify-start">
              <span className="inline-flex items-center gap-1.5"><IconCheck /> Works with your 3CX PBX</span>
              <span className="inline-flex items-center gap-1.5"><IconCheck /> Google Calendar aware</span>
              <span className="inline-flex items-center gap-1.5"><IconCheck /> Configured per company</span>
            </div>
          </div>

          {/* Live call demo visual */}
          <div className="relative mx-auto w-full max-w-[420px] lg:mx-0 lg:ml-auto">
            <div className="absolute -inset-3 -z-10 rounded-[28px] bg-gradient-to-br from-[#3B5BDB]/15 to-[#14B8A6]/15 blur-xl" aria-hidden="true" />
            <div className="rounded-3xl border border-[#E8ECF4] bg-white p-5 shadow-[0_24px_60px_-24px_rgba(13,21,38,0.35)]">
              <div className="flex items-center justify-between border-b border-[#F1F3F8] pb-4">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#22C55E]" />
                  </span>
                  <span className="text-xs font-semibold text-[#0D1526]">Incoming call · 3CX</span>
                </div>
                <span className="text-xs text-[#9CA3AF]">00:14</span>
              </div>
              <div className="flex items-end justify-center gap-1 py-6">
                {[10, 22, 14, 30, 18, 26, 12, 20, 9, 24, 16, 11].map((h, i) => (
                  <span
                    key={i}
                    className="w-1.5 animate-pulse rounded-full bg-gradient-to-t from-[#3B5BDB] to-[#14B8A6]"
                    style={{ height: h, animationDelay: `${i * 90}ms`, animationDuration: "1.2s" }}
                  />
                ))}
              </div>
              <div className="space-y-2.5">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[#F1F5F9] px-3.5 py-2 text-[13px] text-[#374151]">
                  Hi, can I book an appointment for Thursday afternoon?
                </div>
                <div className="mr-auto max-w-[85%] rounded-2xl rounded-tl-sm bg-[#EEF2FF] px-3.5 py-2 text-[13px] text-[#1E3A8A]">
                  Of course — checking the calendar now. I have 2:30pm or 4:00pm open.
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#F0FDF4] px-3 py-2 text-xs font-medium text-[#15803D]">
                <IconCheck /> Handled by Vocalist — no human needed
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Real session entry point — never render simulated call telemetry. */}
      <section aria-labelledby="real-session-title" id="real-session-title" className="mx-auto max-w-5xl px-5 pb-6 pt-4 sm:px-10">
        <div className="grid grid-cols-1 items-center gap-8 rounded-2xl border border-[#E8ECF4] bg-gradient-to-br from-[#F9FAFB] to-white p-7 shadow-[0_1px_2px_rgba(13,21,38,0.04)] sm:p-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#3B5BDB]">
              Real session testing
            </div>
            <h2 style={{ fontFamily: "Bricolage Grotesque" }} className="mb-2 text-[22px] text-[#0D1526]">
              Test your company-configured assistant
            </h2>
            <p className="mb-5 text-[13px] leading-[1.6] text-[#4B5563]">
              Sign in, connect your company&apos;s Google Calendar, and launch a real LiveKit session. This
              public page never fabricates call status, audio, transcripts, or tool activity.
            </p>
            <button
              onClick={goSignIn}
              className="rounded-lg bg-[#3B5BDB] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:shadow-[0_8px_20px_-6px_rgba(59,91,219,0.55)]"
            >
              Sign in to test
            </button>
          </div>
          <div className="rounded-xl border border-[#E8ECF4] bg-white p-5 shadow-sm">
            <div className="mb-3 text-[13px] font-bold text-[#0D1526]">Calendar capabilities</div>
            {["Check availability", "List events", "Book events", "Cancel events"].map((capability) => (
              <div key={capability} className="flex items-center gap-2.5 border-t border-[#F1F3F8] py-2.5 text-[13px] text-[#4B5563] first:border-t-0">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#3B5BDB]">
                  <IconCheck />
                </span>
                {capability}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="flex flex-wrap gap-10 border-t border-[#E8ECF4] px-6 pb-8 pt-10 sm:px-10">
        <div className="flex-[1_1_200px]">
          <div className="mb-2.5 flex items-center gap-2">
            <LogoIcon />
            <span style={{ fontFamily: "Bricolage Grotesque" }} className="text-[15px] font-bold text-[#0D1526]">
              vocalist.ai
            </span>
          </div>
          <div className="text-xs leading-[1.7] text-[#7A8BAD]">
            Company-configured voice assistants with tenant-scoped settings and Google Calendar integration.
          </div>
        </div>
        <div className="max-w-[340px] flex-[0_0_auto] text-[13px] leading-[1.6] text-[#7A8BAD]">
          Voice routing through 3CX is still being validated and is not presented as an active calling
          service. Configure company integrations from your account.
        </div>
      </footer>
    </div>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function OnboardingShell({
  step,
  children,
}: {
  step: 2 | 3;
  children: React.ReactNode;
}) {
  const steps = ["Account Setup", "Company Details", "AI Configuration"];
  return (
    <div style={{ minHeight: "100vh", background: "#F5F7FA", fontFamily: "Inter" }}>
      {/* Top bar */}
      <div
        className="ob-bar"
        style={{
          height: 56,
          background: "white",
          borderBottom: "1px solid #E8ECF4",
          display: "flex",
          alignItems: "center",
          padding: "0 32px",
          gap: 0,
          flexWrap: "wrap",
        }}
      >
        <div className="ob-brand" style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 48 }}>
          <LogoIcon />
          <span style={{ fontFamily: "Bricolage Grotesque", fontWeight: 700, fontSize: 15, color: "#0D1526" }}>vocalist.ai</span>
        </div>
        <div className="ob-steps" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 36 }}>
          {steps.map((s, i) => {
            const n = i + 1;
            const done = n < step;
            const active = n === step;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: done ? "#22C55E" : active ? "#3B5BDB" : "transparent",
                    border: done || active ? "none" : "1.5px solid #D1D5DB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: done || active ? "white" : "#9CA3AF",
                  }}
                >
                  {done ? "✓" : n}
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: active ? 700 : 400,
                    color: active ? "#0D1526" : done ? "#6B7280" : "#9CA3AF",
                  }}
                >
                  {s}
                </span>
              </div>
            );
          })}
        </div>
        <div className="ob-support" style={{ fontSize: 12, color: "#7A8BAD" }}>Support: support@vocalist.ai</div>
      </div>
      <div className="app-content-pad" style={{ padding: "48px 24px" }}>{children}</div>
    </div>
  );
}

type CallRow = {
  did: string;
  direction: "inbound" | "outbound";
  state: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
};

async function getJson(url: string): Promise<any | null> {
  if (url === "/api/company-profile") {
    return getCompanyProfile().then((data) => data ? { status: "success", data } : null);
  }
  try {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function callDuration(c: CallRow) {
  if (!c.endedAt) return "—";
  const s = Math.max(0, Math.round((Date.parse(c.endedAt) - Date.parse(c.createdAt)) / 1000));
  return s < 60 ? `${s} sec` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const callTone = (state: string): Tone => (state === "ended" ? "green" : state === "failed" ? "red" : "indigo");

function DashboardPage({ setPage }: { setPage: (p: Page) => void }) {
  const [state, setState] = useState<{
    loading: boolean;
    company: string | null;
    threeCx: { configured?: boolean; state?: string; dids?: string[] } | null;
    google: boolean | null;
    published: number | null;
    calls: CallRow[] | null;
  }>({ loading: true, company: null, threeCx: null, google: null, published: null, calls: null });

  useEffect(() => {
    let active = true;
    getJson("/api/dashboard/summary").then((summary) => {
      if (!active) return;
      setState({
        loading: false,
        company: String(summary?.company?.company_name || "").trim() || null,
        threeCx: summary?.threeCx || null,
        google: summary?.google ? !!summary.google.connected : null,
        published: typeof summary?.publishedVersion === "number" ? summary.publishedVersion : null,
        calls: Array.isArray(summary?.calls) ? summary.calls : null,
      });
    });
    return () => { active = false; };
  }, []);

  const calls = state.calls ?? [];
  const failed = calls.filter((c) => c.state === "failed").length;
  const completed = calls.filter((c) => c.state === "ended");
  const durations = completed
    .filter((c) => c.endedAt)
    .map((c) => Math.max(0, (Date.parse(c.endedAt as string) - Date.parse(c.createdAt)) / 1000));
  const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const perDay = days.map((d) => {
    const start = d.getTime();
    const end = start + 86400000;
    return calls.filter((c) => {
      const t = Date.parse(c.createdAt);
      return t >= start && t < end;
    }).length;
  });
  const maxDay = Math.max(...perDay, 1);
  const weekTotal = perDay.reduce((a, b) => a + b, 0);

  const checklist: { id: string; title: string; text: string; done: boolean; go: Page; cta: string; icon: Lu.LucideIcon }[] = [
    { id: "company", title: "Company profile", text: "Add your company details for assistant context.", done: !!state.company, go: "company-setup", cta: "Set up", icon: Lu.Building2 },
    { id: "assistant", title: "Publish your AI assistant", text: "Configure the voice, prompt and capabilities.", done: state.published !== null, go: "assistant-config", cta: "Configure", icon: Lu.Bot },
    { id: "google", title: "Connect Google Calendar", text: "Let the assistant check availability and book.", done: state.google === true, go: "integrations", cta: "Connect", icon: Lu.CalendarDays },
    { id: "3cx", title: "Connect 3CX phone system", text: "Store and validate your PBX connection.", done: !!state.threeCx?.configured, go: "integrations", cta: "Connect", icon: Lu.PhoneCall },
  ];
  const doneCount = checklist.filter((i) => i.done).length;
  const pct = Math.round((doneCount / checklist.length) * 100);
  const loadingVal = state.loading ? <Skeleton className="h-8 w-16" /> : null;

  return (
    <AppShell
      page="dashboard"
      setPage={setPage}
      title="Company Dashboard"
      subtitle="Your company profile, configured integrations, and verified voice-session activity."
    >
      <div className="space-y-5 sm:space-y-6">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-6 text-white shadow-xl shadow-indigo-500/20 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-24 right-24 h-56 w-56 rounded-full bg-violet-300/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
                <span className={cn("h-1.5 w-1.5 rounded-full", state.published !== null ? "bg-emerald-300" : "bg-amber-300")} />
                {state.loading ? "Checking status…" : state.published !== null ? `Assistant live · v${state.published}` : "Assistant not published yet"}
              </div>
              <h2 className="mt-3 truncate font-[Bricolage_Grotesque] text-2xl font-bold tracking-tight sm:text-3xl">
                {state.company ? `Welcome back, ${state.company}` : "Welcome to your workspace"}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-indigo-100">
                Monitor call sessions, finish your setup and fine-tune the AI assistant that answers for your company.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="secondary" className="border-0 bg-white text-indigo-700 hover:bg-indigo-50" icon={<Lu.FlaskConical className="h-4 w-4" />} onClick={() => setPage("assistant-config")}>
                Test assistant
              </Button>
              <Button variant="ghost" className="bg-white/10 text-white hover:bg-white/20" icon={<Lu.PhoneCall className="h-4 w-4" />} onClick={() => setPage("calls")}>
                View calls
              </Button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="Total sessions" icon={<Lu.Activity className="h-[18px] w-[18px]" />} value={loadingVal ?? calls.length} hint={state.calls === null && !state.loading ? "Call history unavailable" : "Latest 50 sessions"} />
          <StatCard label="Completed" tone="emerald" icon={<Lu.CheckCircle2 className="h-[18px] w-[18px]" />} value={loadingVal ?? completed.length} hint="Ended normally" />
          <StatCard label="Failed" tone="rose" icon={<Lu.AlertTriangle className="h-[18px] w-[18px]" />} value={loadingVal ?? failed} hint="Needs attention" />
          <StatCard label="Avg. duration" tone="amber" icon={<Lu.Clock className="h-[18px] w-[18px]" />} value={loadingVal ?? (avg === null ? "—" : avg < 60 ? `${avg}s` : `${Math.floor(avg / 60)}m ${avg % 60}s`)} hint="Completed sessions" />
        </div>

        <div className="grid gap-5 sm:gap-6 lg:grid-cols-5">
          {/* Chart */}
          <Card className="lg:col-span-3">
            <CardHeader
              title="Voice session activity"
              description={`${weekTotal} session${weekTotal === 1 ? "" : "s"} in the last 7 days`}
              action={<Badge tone="slate" dot={false}>Last 7 days</Badge>}
            />
            <CardBody>
              {state.calls !== null && calls.length === 0 ? (
                <EmptyState icon={<Lu.BarChart3 className="h-6 w-6" />} title="No call volume data yet" text="Connect your voice and telephony services and sessions will be charted here." />
              ) : (
                <div>
                  <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label="Sessions per day for the last 7 days">
                    {perDay.map((v, i) => (
                      <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${v} session${v === 1 ? "" : "s"}`}>
                        <span className="text-[11px] font-semibold text-slate-500 opacity-0 transition group-hover:opacity-100">{v}</span>
                        <div
                          className={cn("w-full rounded-t-lg transition-all", i === 6 ? "bg-gradient-to-t from-indigo-600 to-violet-500" : "bg-indigo-100 group-hover:bg-indigo-200")}
                          style={{ height: v ? `${Math.max(6, (v / maxDay) * 100)}%` : "4px", minHeight: 4 }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2 sm:gap-3">
                    {days.map((d, i) => (
                      <div key={i} className={cn("flex-1 text-center text-[11px]", i === 6 ? "font-semibold text-indigo-600" : "text-slate-400")}>
                        {d.toLocaleDateString(undefined, { weekday: "short" })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Checklist */}
          <Card className="lg:col-span-2">
            <CardHeader title="Setup progress" description={`${doneCount} of ${checklist.length} steps complete`} />
            <CardBody className="space-y-4">
              <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <ul className="space-y-1">
                {checklist.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setPage(item.go)}
                      className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-slate-50"
                    >
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", item.done ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500")}>
                        {item.done ? <Lu.Check className="h-4 w-4" /> : <item.icon className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-semibold", item.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800")}>{item.title}</span>
                        <span className="block truncate text-xs text-slate-500">{item.text}</span>
                      </span>
                      {!item.done && <span className="hidden text-xs font-semibold text-indigo-600 sm:inline">{item.cta}</span>}
                      <Lu.ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                    </button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        {/* Recent sessions */}
        <Card>
          <CardHeader
            title="Recent sessions"
            description="Latest 3CX session metadata for your company."
            action={<Button variant="soft" size="sm" onClick={() => setPage("calls")}>View all</Button>}
          />
          {calls.length ? (
            <ul className="divide-y divide-slate-100">
              {calls.slice(0, 5).map((c, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", c.direction === "inbound" ? "bg-sky-50 text-sky-600" : "bg-violet-50 text-violet-600")}>
                    {c.direction === "inbound" ? <Lu.PhoneIncoming className="h-4 w-4" /> : <Lu.PhoneOutgoing className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-800">{c.did}</div>
                    <div className="truncate text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()} · {callDuration(c)}</div>
                  </div>
                  <Badge tone={callTone(c.state)}>{c.state}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Lu.PhoneOff className="h-6 w-6" />}
              title={state.loading ? "Loading sessions…" : "No sessions recorded"}
              text="Sessions will appear here once your 3CX connection handles calls. No sample data is shown."
            />
          )}
        </Card>
      </div>
    </AppShell>
  );
}

// ─── Calls Stream ─────────────────────────────────────────────────────────────

function CallsPage({ setPage }: { setPage: (p: Page) => void }) {
  const [selectedCall, setSelectedCall] = useState(0);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"all" | "inbound" | "outbound">("all");

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/3cx/calls?limit=50", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Call history could not be loaded");
        const payload = await response.json();
        if (active) setCalls(Array.isArray(payload.calls) ? payload.calls : []);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const visible = calls.map((c, index) => ({ c, index })).filter(({ c }) => filter === "all" || c.direction === filter);
  const selected = calls[selectedCall];

  const detail = (call: CallRow) => (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
      <KeyValue label="Configured DID">{call.did}</KeyValue>
      <KeyValue label="Direction"><span className="capitalize">{call.direction}</span></KeyValue>
      <KeyValue label="Started">{new Date(call.createdAt).toLocaleString()}</KeyValue>
      <KeyValue label="Last updated">{new Date(call.updatedAt).toLocaleString()}</KeyValue>
      <KeyValue label="Duration">{callDuration(call)}</KeyValue>
      <KeyValue label="Transcript"><span className="text-slate-500">Not stored</span></KeyValue>
    </dl>
  );

  const emptyTitle = loading ? "Loading call sessions" : loadError ? "Call history unavailable" : "No call sessions recorded";
  const emptyText = loadError
    ? "Confirm your sign-in and retry. Call history is loaded only from your company’s protected 3CX session ledger."
    : "Call sessions will appear here after the 3CX event adapter is connected. No sample records are displayed.";

  return (
    <AppShell
      page="calls"
      setPage={setPage}
      title="Call History"
      subtitle="Review 3CX session metadata. Caller identity, transcripts, and call analytics are not stored or displayed."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Company call records"
            description={loading ? "Loading…" : loadError ? "Unavailable" : `${calls.length} session${calls.length === 1 ? "" : "s"}`}
            action={
              <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Filter by direction">
                {(["all", "inbound", "outbound"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition", filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                  >
                    {f}
                  </button>
                ))}
              </div>
            }
          />

          {visible.length === 0 ? (
            <EmptyState icon={<Lu.PhoneOff className="h-6 w-6" />} title={calls.length ? "No sessions match this filter" : emptyTitle} text={calls.length ? "Try another direction filter." : emptyText} />
          ) : (
            <>
              {/* Desktop / tablet table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {["Date / Time", "Configured DID", "Direction", "Duration", "State"].map((h) => (
                        <th key={h} className="whitespace-nowrap px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map(({ c, index }) => (
                      <tr
                        key={index}
                        onClick={() => setSelectedCall(index)}
                        className={cn("cursor-pointer transition", selectedCall === index ? "bg-indigo-50/60" : "hover:bg-slate-50")}
                      >
                        <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{new Date(c.createdAt).toLocaleString()}</td>
                        <td className="whitespace-pre px-5 py-3.5 font-semibold text-slate-900">{c.did}</td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center gap-1.5 capitalize text-slate-600">
                            {c.direction === "inbound" ? <Lu.PhoneIncoming className="h-3.5 w-3.5 text-sky-500" /> : <Lu.PhoneOutgoing className="h-3.5 w-3.5 text-violet-500" />}
                            {c.direction}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{callDuration(c)}</td>
                        <td className="px-5 py-3.5"><Badge tone={callTone(c.state)}>{c.state}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {visible.map(({ c, index }) => (
                  <li key={index}>
                    <button type="button" onClick={() => setSelectedCall(index)} aria-expanded={selectedCall === index} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", c.direction === "inbound" ? "bg-sky-50 text-sky-600" : "bg-violet-50 text-violet-600")}>
                        {c.direction === "inbound" ? <Lu.PhoneIncoming className="h-4 w-4" /> : <Lu.PhoneOutgoing className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{c.did}</span>
                        <span className="block truncate text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</span>
                      </span>
                      <Badge tone={callTone(c.state)}>{c.state}</Badge>
                    </button>
                    {selectedCall === index && <div className="bg-slate-50 px-4 py-4">{detail(c)}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Desktop detail panel */}
        <Card className="hidden self-start lg:sticky lg:top-24 lg:block">
          <CardHeader
            title="Call details"
            description={selected ? `${selected.direction} 3CX session · ${selected.state}` : "Select a session to inspect its safe metadata."}
          />
          <CardBody>
            {selected ? detail(selected) : (
              <EmptyState icon={<Lu.MousePointerClick className="h-6 w-6" />} title="No session selected" text="Caller IDs, PBX call identifiers, LiveKit rooms, claim tokens, and transcripts are not exposed in this view." />
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}

// ─── Phone Numbers ────────────────────────────────────────────────────────────

function PhoneNumbersPage({ setPage }: { setPage: (p: Page) => void }) {
  const [integration, setIntegration] = useState<{
    configured: boolean;
    connectionName?: string;
    pbxHost?: string;
    routePointDn?: string;
    dids?: string[];
    state?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/3cx", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the 3CX configuration");
        const payload = await response.json();
        if (active) setIntegration(payload);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const title = loading ? "Loading your 3CX setup…" : loadError ? "Could not load your 3CX setup" : integration?.configured ? integration.connectionName || "3CX connection" : "No 3CX connection configured";
  const desc = loadError
    ? "Sign in and try again to view your company’s integration."
    : integration?.configured
      ? `${integration.pbxHost || "PBX host unavailable"}`
      : "Add your company’s 3CX details from Integrations to list its configured DIDs.";

  return (
    <AppShell
      page="phone-numbers"
      setPage={setPage}
      title="Phone Numbers"
      subtitle="Review the phone numbers and route point saved for your company’s 3CX connection."
    >
      <div className="space-y-5">
        <Card>
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
                <Lu.Phone className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-[Bricolage_Grotesque] text-lg font-bold text-slate-900">{title}</h2>
                <p className="truncate text-[13px] text-slate-500">{desc}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {integration?.configured && <Badge tone={integration.state === "active" ? "green" : "slate"}>{integration.state || "status unavailable"}</Badge>}
              <Button icon={<Lu.Settings2 className="h-4 w-4" />} onClick={() => setPage("integrations")}>Manage integrations</Button>
            </div>
          </div>
        </Card>

        {integration?.configured && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              <StatCard label="Route point" icon={<Lu.Route className="h-[18px] w-[18px]" />} value={<span className="text-2xl">{integration.routePointDn || "Not set"}</span>} />
              <StatCard label="Configured DIDs" tone="emerald" icon={<Lu.Hash className="h-[18px] w-[18px]" />} value={integration.dids?.length || 0} />
            </div>
            <Card>
              <CardHeader title="Company phone numbers" description="Inbound DIDs assigned to this PBX." />
              {integration.dids?.length ? (
                <ul className="grid gap-px overflow-hidden rounded-b-2xl bg-slate-100 sm:grid-cols-2">
                  {integration.dids.map((did) => (
                    <li key={did} className="flex items-center gap-3 bg-white px-5 py-4 sm:px-6">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600"><Lu.PhoneIncoming className="h-4 w-4" /></span>
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{did}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Lu.Hash className="h-6 w-6" />} title="No DIDs configured" text="Add the phone numbers assigned to this PBX in the 3CX integration settings." />
              )}
            </Card>
          </>
        )}

        <Alert tone="amber" icon={<Lu.Info className="h-4 w-4" />}>
          This page reflects saved 3CX settings only. Live inbound/outbound calling and carrier number purchasing are not enabled yet.
        </Alert>
      </div>
    </AppShell>
  );
}

function AuthRedirect() {
  useEffect(() => {
    window.location.assign("/sign-in?mode=sign-up");
  }, []);
  return <main role="status" style={{ padding: 32 }}>Opening secure account setup…</main>;
}

// ─── Integrations ─────────────────────────────────────────────────────────────

function GoogleCalendarIntegrationCard({ initialStatus }: { initialStatus?: { connected?: boolean; connection_state?: string; google_email?: string; email?: string } | null }) {
  const [connected, setConnected] = useState(!!initialStatus?.connected);
  const [connectionState, setConnectionState] = useState(initialStatus?.connection_state || (initialStatus?.connected ? "connected" : "disconnected"));
  const [connectedEmail, setConnectedEmail] = useState<string | null>(initialStatus?.google_email || initialStatus?.email || null);
  const [loading, setLoading] = useState(initialStatus === undefined);
  const [busy, setBusy] = useState(false);
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/auth/google/status", { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setConnected(!!data.connected);
        setConnectionState(data.connection_state || (data.connected ? "connected" : "disconnected"));
        setConnectedEmail(data.email || data.google_email || null);
      } else {
        setConnected(false);
        setConnectedEmail(null);
      }
    } catch {
      setConnected(false);
      setConnectedEmail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialStatus !== undefined) {
      setConnected(!!initialStatus?.connected);
      setConnectionState(initialStatus?.connection_state || (initialStatus?.connected ? "connected" : "disconnected"));
      setConnectedEmail(initialStatus?.google_email || initialStatus?.email || null);
      setLoading(false);
    }
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === "GOOGLE_AUTH_SUCCESS") {
        checkStatus();
      }
    };
    window.addEventListener("message", handleMsg);
    return () => window.removeEventListener("message", handleMsg);
  }, [checkStatus, initialStatus]);

  const handleConnect = async () => {
    setBusy(true);
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
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setBusy(false);
        checkStatus();
      }
    }, 1000);
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await fetch("/auth/google/disconnect", { method: "POST", credentials: "include" });
      await checkStatus();
    } catch (err) {
      logSafeFailure("Dashboard action failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 p-5 sm:p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-50 to-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Lu.CalendarDays className="h-6 w-6" />
        </div>
        <Badge tone={loading ? "slate" : connectionState === "refreshable" ? "amber" : connected ? "green" : "slate"}>
          {loading ? "Checking..." : connectionState === "refreshable" ? "Connected · refresh on use" : connected ? "Connected" : "Not Connected"}
        </Badge>
      </div>
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <h3 className="font-[Bricolage_Grotesque] text-lg font-bold text-slate-900">Google Calendar Sync</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
          Connect this company&apos;s Google account so the assistant can check availability, list events, book meetings, and cancel them with confirmation.
        </p>
        <dl className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60">
          {[
            { label: "Connected account", value: connectedEmail || "No Google account connected" },
            { label: "Calendar", value: "Primary Google Calendar" },
          ].map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <dt className="text-[13px] font-medium text-slate-600">{row.label}</dt>
              <dd className="min-w-0 break-all text-[13px] text-slate-500 sm:text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5">
          {connected ? (
            <Button variant="danger" block loading={busy} onClick={handleDisconnect}>
              {busy ? "Disconnecting..." : "Disconnect Google Calendar"}
            </Button>
          ) : (
            <Button block loading={busy} onClick={handleConnect} icon={<Lu.Link2 className="h-4 w-4" />}>
              {busy ? "Connecting..." : "Connect Google Calendar"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ThreeCXIntegrationCard({ initialStatus }: { initialStatus?: any | null }) {
  const [connectionName, setConnectionName] = useState("3CX PBX Connection");
  const [pbxUrl, setPbxUrl] = useState("");
  const [appId, setAppId] = useState("");
  const [routePointDn, setRoutePointDn] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [dids, setDids] = useState("");
  const [transferDestinations, setTransferDestinations] = useState("");
  const [failureAction, setFailureAction] = useState<"" | "disconnect" | "transfer">("disconnect");
  const [failureDestination, setFailureDestination] = useState("");
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const applyStatus = useCallback((data: any) => {
    setStatus(data);
    setConnectionName(data.connectionName || "3CX PBX Connection");
    setPbxUrl(data.pbxHost ? `https://${data.pbxHost}` : "");
    setAppId(data.appId || "");
    setRoutePointDn(data.routePointDn || "");
    setDids(Array.isArray(data.dids) ? data.dids.join(", ") : "");
    setTransferDestinations(Array.isArray(data.transferDestinations) ? data.transferDestinations.join(", ") : "");
    setFailureAction(data.failureAction === "disconnect" || data.failureAction === "transfer" ? data.failureAction : "disconnect");
    setFailureDestination(data.failureDestination || "");
    setClientSecret("");
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch("/api/integrations/3cx", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the 3CX connection details");
    applyStatus(await response.json());
  }, [applyStatus]);

  useEffect(() => {
    if (initialStatus !== undefined) applyStatus(initialStatus);
  }, [applyStatus, initialStatus, loadStatus]);

  const save = async () => {
    setBusy(true);
    try {
      const trimmedUrl = pbxUrl.trim();
      const normalizedUrl = trimmedUrl ? (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://") ? trimmedUrl : `https://${trimmedUrl}`) : "";
      const payload = {
        connection_name: connectionName.trim() || "3CX PBX Connection",
        pbx_url: normalizedUrl,
        app_id: appId,
        route_point_dn: routePointDn.trim() || appId.trim(),
        client_secret: clientSecret,
        dids: dids.split(",").map((value) => value.trim()).filter(Boolean),
        transfer_destinations: transferDestinations.split(",").map((value) => value.trim()).filter(Boolean),
        failure_action: failureAction,
        failure_destination: failureAction === "transfer" ? failureDestination : null,
      };
      const response = await fetch("/api/integrations/3cx", { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (failure?.error_code === "RECENT_AUTHENTICATION_REQUIRED") {
          throw new Error("For security, sign out and sign in again before testing or saving 3CX credentials.");
        }
        if (response.status === 429) throw new Error("Too many 3CX setup attempts. Wait before trying again.");
        throw new Error(failure?.detail || failure?.error_message || "3CX connection test and save failed");
      }
      setClientSecret("");
      await loadStatus();
    } catch (error) {
      setStatus((current: any) => ({ ...(current || {}), error: error instanceof Error ? error.message : "3CX connection failed" }));
    } finally {
      setClientSecret("");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!status?.configured || !window.confirm("Disconnect this company's 3CX integration and remove its stored API key?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/integrations/3cx", { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (failure?.error_code === "RECENT_AUTHENTICATION_REQUIRED") {
          throw new Error("For security, sign out and sign in again before disconnecting 3CX.");
        }
        throw new Error(failure?.detail || failure?.error_message || "3CX could not be disconnected");
      }
      setStatus({ configured: false, state: "unconfigured" });
      setConnectionName("");
      setPbxUrl("");
      setAppId("");
      setRoutePointDn("");
      setDids("");
      setTransferDestinations("");
      setFailureAction("");
      setFailureDestination("");
      setClientSecret("");
    } catch (error) {
      setStatus((current: any) => ({ ...(current || {}), error: error instanceof Error ? error.message : "3CX could not be disconnected" }));
    } finally {
      setBusy(false);
    }
  };

  const fields: { label: string; value: string; set: (v: string) => void; secret: boolean; span?: boolean }[] = [
    { label: "Connection name", value: connectionName, set: setConnectionName, secret: false },
    { label: "PBX HTTPS URL", value: pbxUrl, set: setPbxUrl, secret: false },
    { label: "3CX Service Principal client ID", value: appId, set: setAppId, secret: false },
    { label: "Programmable Extension / Route Point DN", value: routePointDn, set: setRoutePointDn, secret: false },
    { label: "3CX client secret (write-only)", value: clientSecret, set: setClientSecret, secret: true },
    { label: "Inbound DIDs (comma-separated)", value: dids, set: setDids, secret: false },
    { label: "Transfer destinations (comma-separated)", value: transferDestinations, set: setTransferDestinations, secret: false, span: true },
  ];
  const approvedDestinations = transferDestinations.split(",").map((value) => value.trim()).filter(Boolean);
  const saveDisabled = busy || !clientSecret || !appId || !pbxUrl || !routePointDn || !failureAction || (failureAction === "transfer" && (!failureDestination || !approvedDestinations.includes(failureDestination)));

  return (
    <Card className="mb-5">
      <CardHeader
        icon={<Lu.PhoneCall className="h-[18px] w-[18px]" />}
        title="3CX PBX"
        description="Store and validate this company’s own 3CX connection. Live call routing is still being implemented."
        action={<Badge tone={status?.state === "active" ? "green" : "slate"}>{status?.state || "Not configured"}</Badge>}
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <Field key={field.label} label={field.label} className={field.span ? "sm:col-span-2" : undefined}>
              <input
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                type={field.secret ? "password" : "text"}
                autoComplete={field.secret ? "new-password" : "off"}
                spellCheck={false}
                className={controlCls}
              />
            </Field>
          ))}
        </div>
        <Field label="If the assistant cannot handle a live call">
          <SelectWrap>
            <select
              value={failureAction}
              onChange={(event) => {
                const value = event.target.value as "" | "disconnect" | "transfer";
                setFailureAction(value);
                if (value !== "transfer") setFailureDestination("");
              }}
              className={selectCls}
            >
              <option value="">Choose an explicit fallback</option>
              <option value="disconnect">Disconnect the caller</option>
              <option value="transfer">Transfer to an approved destination</option>
            </select>
          </SelectWrap>
        </Field>

        {failureAction === "transfer" && (
          <Field label="Approved fallback destination" hint="The fallback must also appear in the approved transfer destinations above.">
            <SelectWrap>
              <select value={failureDestination} onChange={(event) => setFailureDestination(event.target.value)} className={selectCls}>
                <option value="">Choose a configured transfer destination</option>
                {approvedDestinations.map((destination) => <option key={destination} value={destination}>{destination}</option>)}
              </select>
            </SelectWrap>
          </Field>
        )}

        {status?.error && <Alert tone="red" icon={<Lu.AlertCircle className="h-4 w-4" />}>{status.error}</Alert>}

        <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 lg:flex-row lg:items-center lg:justify-between">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
            <Lu.Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Re-authenticate before changes. The client ID and Route Point DN are separate; the client secret is write-only and cleared after submission.
          </p>
          <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
            {status?.configured && <Button variant="danger" loading={busy} onClick={disconnect}>{busy ? "Working…" : "Disconnect"}</Button>}
            <Button disabled={saveDisabled} loading={busy} onClick={save} icon={<Lu.ShieldCheck className="h-4 w-4" />}>
              {busy ? "Testing & saving..." : "Test & save 3CX"}
            </Button>
          </div>

        </div>
      </CardBody>
    </Card>
  );
}

type OnboardingCompanyDraft = {
  company_name: string;
  website_url: string;
  company_phone: string;
  support_email: string;
  timezone: string;
};

type OnboardingAssistantDraft = {
  assistant_name: string;
  voice_engine: string;
  inbound_greeting: string;
  system_prompt: string;
  knowledge_base_notes: string;
  default_language: ResponseLanguage;
  allowed_languages: ResponseLanguage[];
  tone: "professional" | "friendly" | "warm" | "concise";
  business_hours: Record<string, string>;
  escalation_rules: string[];
  faq_entries: FAQEntry[];
  capabilities: CapabilityFlags;
};

type FAQEntry = { question: string; answer: string };
const BUSINESS_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const EMPTY_ASSISTANT_DRAFT: OnboardingAssistantDraft = {
  assistant_name: "", voice_engine: "Aoede", inbound_greeting: "", system_prompt: "",
  knowledge_base_notes: "", default_language: "en", allowed_languages: ["fr-FR", "fr-BE", "en"],
  tone: "friendly", business_hours: {}, escalation_rules: [],
  faq_entries: [], capabilities: { company_receptionist: false, company_faq: false, google_calendar: true },
};

const RESPONSE_LANGUAGE_OPTIONS: Array<{ value: ResponseLanguage; label: string }> = [
  { value: "fr-FR", label: "General French" },
  { value: "fr-BE", label: "Belgian French" },
  { value: "en", label: "English" },
];

function readResponseLanguage(value: unknown): ResponseLanguage {
  return value === "fr-FR" || value === "fr-BE" || value === "en" ? value : "en";
}

function readAllowedLanguages(value: unknown, defaultLanguage: ResponseLanguage): ResponseLanguage[] {
  const languages = Array.isArray(value)
    ? value.filter((item): item is ResponseLanguage => item === "fr-FR" || item === "fr-BE" || item === "en")
    : [];
  const unique = Array.from(new Set(languages));
  if (!unique.includes(defaultLanguage)) unique.unshift(defaultLanguage);
  return unique.length ? unique : ["fr-FR", "fr-BE", "en"];
}

function LanguagePolicyFields({
  defaultLanguage,
  allowedLanguages,
  onChange,
}: {
  defaultLanguage: ResponseLanguage;
  allowedLanguages: ResponseLanguage[];
  onChange: (defaultLanguage: ResponseLanguage, allowedLanguages: ResponseLanguage[]) => void;
}) {
  return <section aria-label="Response language policy" style={{ border: "1px solid #E2E8F0", borderRadius: 9, padding: 14, marginBottom: 18, background: "#FAFBFF" }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", marginBottom: 9 }}>Response languages</div>
    <label style={{ display: "block", fontSize: 12, color: "#374151", marginBottom: 10 }}>
      Default response language
      <select value={defaultLanguage} onChange={(event) => {
        const nextDefault = event.target.value as ResponseLanguage;
        onChange(nextDefault, allowedLanguages.includes(nextDefault) ? allowedLanguages : [...allowedLanguages, nextDefault]);
      }} style={{ ...inputStyle, marginTop: 5 }}>
        {RESPONSE_LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <div style={{ fontSize: 12, color: "#374151", marginBottom: 5 }}>Allowed explicit language switches</div>
    {RESPONSE_LANGUAGE_OPTIONS.map((option) => <label key={option.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, color: "#334155" }}>
      <input type="checkbox" checked={allowedLanguages.includes(option.value)} disabled={option.value === defaultLanguage} onChange={(event) => {
        const next = event.target.checked
          ? [...allowedLanguages, option.value]
          : allowedLanguages.filter((language) => language !== option.value);
        onChange(defaultLanguage, Array.from(new Set(next)));
      }} />
      {option.label}{option.value === defaultLanguage ? " (default)" : ""}
    </label>)}
    <p style={{ margin: "8px 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.45 }}>The assistant switches only after an explicit caller request. Unclear or unsupported speech is never guessed.</p>
  </section>;
}

const inputStyle = {
  width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8,
  padding: "10px 12px", fontSize: 14, fontFamily: "Inter",
  outline: "none", color: "#0D1526",
} as const;

type CapabilityFlags = Pick<Record<CapabilityId, boolean>, "company_receptionist" | "company_faq" | "google_calendar">;
const DEFAULT_CAPABILITY_FLAGS: CapabilityFlags = {
  company_receptionist: false,
  company_faq: false,
  google_calendar: true,
};

function readCapabilityFlags(raw: unknown): CapabilityFlags {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CAPABILITY_FLAGS };
  const values = raw as Record<string, unknown>;
  const enabled = (key: keyof CapabilityFlags) => {
    const hasExplicitValue = Object.prototype.hasOwnProperty.call(values, key);
    const value = values[key];
    if (value && typeof value === "object" && "enabled" in value) {
      return Boolean((value as { enabled?: unknown }).enabled);
    }
    return typeof value === "boolean" ? value : hasExplicitValue ? false : DEFAULT_CAPABILITY_FLAGS[key];
  };
  return {
    company_receptionist: enabled("company_receptionist"),
    company_faq: enabled("company_faq"),
    google_calendar: enabled("google_calendar"),
  };
}

function writeCapabilityFlags(flags: CapabilityFlags) {
  return Object.fromEntries(
    Object.entries(flags).map(([name, enabled]) => [name, { enabled }]),
  );
}

function CapabilityChoices({
  value,
  onChange,
}: {
  value: CapabilityFlags;
  onChange: (key: keyof CapabilityFlags, enabled: boolean) => void;
}) {
  const options: { id: keyof CapabilityFlags; label: string; description: string }[] = [
    { id: "company_receptionist", label: "Company receptionist", description: "Greet callers and guide company-related requests using your approved profile." },
    { id: "company_faq", label: "Company FAQs", description: "Answer company questions only from your profile and approved reference notes." },
    { id: "google_calendar", label: "Google Calendar", description: "Check availability, list events, book, and cancel with confirmation." },
  ];
  return (
    <div className="mb-6">
      <div className="mb-3 text-[13px] font-bold text-slate-800">Enabled company capabilities</div>
      <div className="space-y-2.5">
        {options.map((option) => {
          const on = value[option.id];
          return (
            <label
              key={option.id}
              className={cn("flex cursor-pointer items-start gap-3.5 rounded-xl border p-3.5 transition", on ? "border-indigo-200 bg-indigo-50/60" : "border-slate-200 bg-white hover:bg-slate-50")}
            >
              <input type="checkbox" checked={on} onChange={(event) => onChange(option.id, event.target.checked)} className="peer sr-only" />
              <span className={cn("relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2", on ? "bg-indigo-600" : "bg-slate-300")} aria-hidden="true">
                <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-[22px]" : "translate-x-0.5")} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">Lead qualification and live 3CX call transfer are not available yet. The model cannot enable tools by itself.</p>
    </div>
  );
}

function CompanyOperatingFields({
  tone, onToneChange, businessHours, onBusinessHoursChange,
  escalationRules, onEscalationRulesChange, faqEntries, onFaqEntriesChange, showFaq,
}: {
  tone: OnboardingAssistantDraft["tone"];
  onToneChange: (tone: OnboardingAssistantDraft["tone"]) => void;
  businessHours: Record<string, string>;
  onBusinessHoursChange: (hours: Record<string, string>) => void;
  escalationRules: string[];
  onEscalationRulesChange: (rules: string[]) => void;
  faqEntries: FAQEntry[];
  onFaqEntriesChange: (entries: FAQEntry[]) => void;
  showFaq: boolean;
}) {
  const parseRules = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 10);
  const [escalationText, setEscalationText] = useState(escalationRules.join("\n"));
  const [uploadNote, setUploadNote] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // Keep the raw text (spaces, blank lines) while typing; only replace it when the
  // saved rules change from outside (e.g. the profile finished loading).
  useEffect(() => {
    if (parseRules(escalationText).join("\n") !== escalationRules.join("\n")) {
      setEscalationText(escalationRules.join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escalationRules]);

  const updateEscalation = (text: string) => {
    setEscalationText(text);
    onEscalationRulesChange(parseRules(text));
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 200 * 1024) {
      setUploadNote({ text: "File is too large (max 200 KB).", type: "error" });
      return;
    }
    try {
      const content = (await file.text()).replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
      if (!content.trim()) {
        setUploadNote({ text: "That file is empty.", type: "error" });
        return;
      }
      const combined = escalationText.trim() ? `${escalationText.replace(/\s+$/, "")}\n${content}` : content;
      const total = combined.split("\n").map((line) => line.trim()).filter(Boolean).length;
      updateEscalation(combined);
      setUploadNote({
        text: total > 10 ? `Loaded ${file.name}. Only the first 10 lines are used (${total} found).` : `Loaded ${file.name}.`,
        type: total > 10 ? "error" : "success",
      });
    } catch {
      setUploadNote({ text: "Could not read that file.", type: "error" });
    }
  };

  return (
    <section aria-label="Company operating profile" className="space-y-5 border-t border-slate-100 pt-6">
      <div>
        <h4 className="text-sm font-bold text-slate-800">Company operating profile</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">These company facts and preferences are tenant data. They cannot grant tools or override platform safeguards.</p>
      </div>

      <Field label="Response tone">
        <SelectWrap>
          <select value={tone} onChange={(event) => onToneChange(event.target.value as OnboardingAssistantDraft["tone"])} className={selectCls}>
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="warm">Warm</option>
            <option value="concise">Concise</option>
          </select>
        </SelectWrap>
      </Field>

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="mb-2 text-[13px] font-semibold text-slate-700">Business hours (company timezone)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {BUSINESS_DAYS.map((day) => (
            <label key={day} className="block">
              <span className="mb-1 block text-xs font-medium capitalize text-slate-500">{day}</span>
              <input value={businessHours[day] || ""} onChange={(event) => onBusinessHoursChange({ ...businessHours, [day]: event.target.value })} placeholder="Closed or 09:00–17:00" className={controlCls} />
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="escalation-guidance" className="text-[13px] font-semibold text-slate-700">Escalation guidance</label>
          <div className="flex items-center gap-2">
            <input ref={uploadRef} type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" onChange={handleUpload} className="sr-only" tabIndex={-1} aria-label="Upload escalation guidance text file" />
            <Button variant="soft" size="sm" icon={<Lu.Upload className="h-3.5 w-3.5" />} onClick={() => uploadRef.current?.click()}>
              Upload text file
            </Button>
            {escalationText && (
              <Button variant="ghost" size="sm" onClick={() => { updateEscalation(""); setUploadNote(null); }}>Clear</Button>
            )}
          </div>
        </div>
        <textarea
          id="escalation-guidance"
          rows={4}
          value={escalationText}
          onChange={(event) => updateEscalation(event.target.value)}
          placeholder="One company-specific escalation preference per line"
          className={cn(controlCls, "resize-y")}
        />
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>One preference per line (max 10). Accepts .txt, .md or .csv. Guidance only; automated transfer is not available yet.</span>
          <span className={cn("font-semibold", parseRules(escalationText).length >= 10 ? "text-amber-600" : "text-slate-400")}>{parseRules(escalationText).length}/10 lines</span>
        </div>
        {uploadNote && <div role="status" className={cn("mt-2 text-xs font-semibold", uploadNote.type === "success" ? "text-emerald-600" : "text-rose-600")}>{uploadNote.text}</div>}
      </div>

      {showFaq && (
        <div>
          <div className="mb-2 text-[13px] font-semibold text-slate-700">Approved FAQs</div>
          <div className="space-y-3">
            {faqEntries.map((entry, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
                <Field label="Question" className="mb-3">
                  <input maxLength={240} value={entry.question} onChange={(event) => onFaqEntriesChange(faqEntries.map((item, i) => i === index ? { ...item, question: event.target.value } : item))} className={controlCls} />
                </Field>
                <Field label="Approved answer">
                  <textarea maxLength={1200} rows={2} value={entry.answer} onChange={(event) => onFaqEntriesChange(faqEntries.map((item, i) => i === index ? { ...item, answer: event.target.value } : item))} className={cn(controlCls, "resize-y")} />
                </Field>
                <button type="button" onClick={() => onFaqEntriesChange(faqEntries.filter((_, i) => i !== index))} className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700">
                  <Lu.Trash2 className="h-3.5 w-3.5" /> Remove FAQ
                </button>
              </div>
            ))}
          </div>
          <Button variant="soft" size="sm" className="mt-3" disabled={faqEntries.length >= 20} icon={<Lu.Plus className="h-4 w-4" />} onClick={() => onFaqEntriesChange([...faqEntries, { question: "", answer: "" }])}>
            Add FAQ
          </Button>
          <p className="mt-2 text-xs text-slate-500">Only answers from this approved list and company reference notes may be used for company FAQs.</p>
        </div>
      )}
    </section>
  );
}

function PersistedCompanyOnboardingPage({ setPage }: { setPage: (p: Page) => void }) {
  const [draft, setDraft] = useState<OnboardingCompanyDraft>({ company_name: "", website_url: "", company_phone: "", support_email: "", timezone: "Indian/Mauritius" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getCompanyProfile().then((payload) => {
      if (payload) setDraft((current) => ({ ...current, ...payload }));
    }).catch(() => setMessage("Unable to load the company profile."));
  }, []);

  async function saveCompany() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/company-profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) throw new Error("Company profile could not be saved.");
      setCachedCompanyProfile(draft);
      setPage("onboarding-ai");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Company profile could not be saved."); }
    finally { setBusy(false); }
  }

  const update = (key: keyof OnboardingCompanyDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return <OnboardingShell step={2}>
    <div style={{ maxWidth: 720, margin: "0 auto", background: "white", borderRadius: 12, padding: 28, border: "1px solid #E8ECF4" }}>
      <h3 style={{ fontSize: 20, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 8 }}>Company Profile</h3>
      <p style={{ color: "#64748B", fontSize: 13, marginBottom: 22 }}>This information is stored in your authenticated company workspace and becomes context for the assistant.</p>
      {message && <p role="alert" style={{ color: "#B91C1C", fontSize: 13 }}>{message}</p>}
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Company name<input required value={draft.company_name} onChange={(e) => update("company_name", e.target.value)} placeholder="Your company name" style={inputStyle} /></label>
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Website URL<input value={draft.website_url} onChange={(e) => update("website_url", e.target.value)} placeholder="https://your-company.example" style={inputStyle} /></label>
      <div className="rs-form-row" style={{ display: "flex", gap: 14, marginBottom: 14 }}>
        <label style={{ flex: 1, fontSize: 13, color: "#374151" }}>Company phone<input value={draft.company_phone} onChange={(e) => update("company_phone", e.target.value)} placeholder="+230 ..." style={inputStyle} /></label>
        <label style={{ flex: 1, fontSize: 13, color: "#374151" }}>Support email<input type="email" value={draft.support_email} onChange={(e) => update("support_email", e.target.value)} placeholder="support@your-company.example" style={inputStyle} /></label>
      </div>
      <label style={{ display: "block", marginBottom: 24, fontSize: 13, color: "#374151" }}>Default timezone<select value={draft.timezone} onChange={(e) => update("timezone", e.target.value)} style={inputStyle}><option value="Indian/Mauritius">Indian/Mauritius (UTC+04:00)</option><option value="UTC">UTC</option><option value="America/New_York">America/New_York</option><option value="Europe/London">Europe/London</option></select></label>
      <div className="rs-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}><button type="button" disabled={busy || !draft.company_name.trim()} onClick={saveCompany} style={{ padding: "10px 24px", borderRadius: 8, border: 0, background: busy ? "#93C5FD" : "#3B5BDB", color: "white", fontWeight: 600 }}>{busy ? "Saving…" : "Save & continue"}</button></div>
    </div>
  </OnboardingShell>;
}

function PersistedAssistantOnboardingPage({ setPage }: { setPage: (p: Page) => void }) {
  const [draft, setDraft] = useState<OnboardingAssistantDraft>({ ...EMPTY_ASSISTANT_DRAFT, capabilities: { ...DEFAULT_CAPABILITY_FLAGS } });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/assistant-config", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.data) setDraft((current) => ({ ...current, ...payload.data, capabilities: readCapabilityFlags(payload.data.capabilities) }));
    }).catch(() => setMessage("Unable to load the assistant draft."));
  }, []);
  async function saveAssistant(publish: boolean) {
    setBusy(true); setMessage("");
    try {
      if (publish) {
        const validation = await fetch("/api/assistant-config/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...draft, is_deployed: false }),
        });
        const validationResult = await validation.json().catch(() => null);
        if (!validation.ok || validationResult?.status !== "valid") {
          throw new Error(validationResult?.detail || "Assistant profile validation failed. Review the configuration before publishing.");
        }
      }
      const response = await fetch("/api/assistant-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, capabilities: writeCapabilityFlags(draft.capabilities), is_deployed: publish }) });
      if (!response.ok) throw new Error("Assistant configuration could not be saved.");
      setPage(publish ? "dashboard" : "assistant-config");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Assistant configuration could not be saved."); }
    finally { setBusy(false); }
  }
  const update = (key: keyof OnboardingAssistantDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const updateCapability = (key: keyof CapabilityFlags, enabled: boolean) => setDraft((current) => ({ ...current, capabilities: { ...current.capabilities, [key]: enabled } }));
  return <OnboardingShell step={3}>
    <div style={{ maxWidth: 720, margin: "0 auto", background: "white", borderRadius: 12, padding: 28, border: "1px solid #E8ECF4" }}>
      <h3 style={{ fontSize: 20, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526", marginBottom: 8 }}>Configure your assistant</h3>
      <p style={{ color: "#64748B", fontSize: 13, marginBottom: 22 }}>Choose the company workflows this assistant may handle. The platform still enforces tenant security, confirmations, and the exact tool grants for the published profile.</p>
      {message && <p role="alert" style={{ color: "#B91C1C", fontSize: 13 }}>{message}</p>}
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Assistant name<input required value={draft.assistant_name} onChange={(e) => update("assistant_name", e.target.value)} placeholder="Your calendar assistant" style={inputStyle} /></label>
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Voice<select value={draft.voice_engine} onChange={(e) => update("voice_engine", e.target.value)} style={inputStyle}><option>Aoede</option><option>Puck</option><option>Charon</option><option>Kore</option><option>Fenrir</option></select></label>
      <LanguagePolicyFields defaultLanguage={draft.default_language} allowedLanguages={draft.allowed_languages} onChange={(default_language, allowed_languages) => setDraft((current) => ({ ...current, default_language, allowed_languages }))} />
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Greeting<input maxLength={500} value={draft.inbound_greeting} onChange={(e) => update("inbound_greeting", e.target.value)} placeholder="How can I help with your calendar?" style={inputStyle} /></label>
      <CapabilityChoices value={draft.capabilities} onChange={updateCapability} />
      <CompanyOperatingFields
        tone={draft.tone} onToneChange={(tone) => setDraft((current) => ({ ...current, tone }))}
        businessHours={draft.business_hours} onBusinessHoursChange={(business_hours) => setDraft((current) => ({ ...current, business_hours }))}
        escalationRules={draft.escalation_rules} onEscalationRulesChange={(escalation_rules) => setDraft((current) => ({ ...current, escalation_rules }))}
        faqEntries={draft.faq_entries} onFaqEntriesChange={(faq_entries) => setDraft((current) => ({ ...current, faq_entries }))}
        showFaq={draft.capabilities.company_faq}
      />
      <label style={{ display: "block", marginBottom: 14, fontSize: 13, color: "#374151" }}>Company instructions<textarea rows={5} value={draft.system_prompt} onChange={(e) => update("system_prompt", e.target.value)} placeholder="Describe your services, tone, hours, and operating preferences. These instructions cannot add authority beyond selected capabilities." style={{ ...inputStyle, resize: "vertical" }} /></label>
      <label style={{ display: "block", marginBottom: 24, fontSize: 13, color: "#374151" }}>Approved company reference notes<textarea rows={3} value={draft.knowledge_base_notes} onChange={(e) => update("knowledge_base_notes", e.target.value)} placeholder="Optional facts and answers for the company FAQ capability." style={{ ...inputStyle, resize: "vertical" }} /></label>
      <div className="rs-actions" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><button type="button" onClick={() => setPage("onboarding-company")} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #D1D5DB", background: "white" }}>Back</button><div style={{ display: "flex", gap: 10 }}><button type="button" disabled={busy || !draft.assistant_name.trim()} onClick={() => saveAssistant(false)} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #3B5BDB", background: "white", color: "#3B5BDB", fontWeight: 600 }}>Save draft</button><button type="button" disabled={busy || !draft.assistant_name.trim()} onClick={() => saveAssistant(true)} style={{ padding: "10px 18px", borderRadius: 8, border: 0, background: busy ? "#93C5FD" : "#3B5BDB", color: "white", fontWeight: 600 }}>{busy ? "Saving…" : "Publish assistant"}</button></div></div>
    </div>
  </OnboardingShell>;
}

function IntegrationsPage({ setPage }: { setPage: (p: Page) => void }) {
  const [integrationStatus, setIntegrationStatus] = useState<{ google: any; threeCx: any } | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/status", { credentials: "include", cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setIntegrationStatus(data); })
      .catch(() => { if (active) setIntegrationStatus({ google: null, threeCx: null }); });
    return () => { active = false; };
  }, []);

  return (
    <AppShell
      page="integrations"
      setPage={setPage}
      title="Integrations"
      subtitle="Connect this company’s Google Calendar and configure its optional 3CX integration."
    >
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <GoogleCalendarIntegrationCard initialStatus={integrationStatus ? integrationStatus.google : undefined} />
          <Card className="bg-gradient-to-br from-slate-900 to-slate-800 text-white">
            <div className="flex gap-4 p-5 sm:p-6">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300"><Lu.ShieldCheck className="h-5 w-5" /></span>
              <div>
                <h3 className="font-[Bricolage_Grotesque] text-[15px] font-bold">Data isolation &amp; security</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">
                  Google credentials are encrypted before persistence and are never returned to the browser. Calendar operations use the authenticated company&apos;s connected account. Production KMS and workload-role provisioning remain release gates; no HIPAA or SOC 2 certification is claimed here.
                </p>
              </div>
            </div>
          </Card>
        </div>
        <ThreeCXIntegrationCard initialStatus={integrationStatus ? integrationStatus.threeCx : undefined} />
      </div>
    </AppShell>
  );
}

// ─── Company Setup (app screen) ───────────────────────────────────────────────

function CompanySetupPage({ setPage }: { setPage: (p: Page) => void }) {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [timezone, setTimezone] = useState("Indian/Mauritius");
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    getCompanyProfile().then((data) => {
      if (!data) return;
      setCompanyName(data.company_name || "");
      setWebsiteUrl(data.website_url || "");
      setCompanyPhone(data.company_phone || "");
      setSupportEmail(data.support_email || "");
      setTimezone(data.timezone || "Indian/Mauritius");
    }).catch((error) => logSafeFailure("Company profile load failed", error, "warn"));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          website_url: websiteUrl,
          company_phone: companyPhone,
          support_email: supportEmail,
          timezone: timezone,
        }),
      });
      if (res.ok) {
        setCachedCompanyProfile({ company_name: companyName, website_url: websiteUrl, company_phone: companyPhone, support_email: supportEmail, timezone });
        setStatusMessage({ text: "Company profile saved to database successfully!", type: "success" });
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        setStatusMessage({ text: "Failed to save company profile.", type: "error" });
      }
    } catch (e) {
      setStatusMessage({ text: "Network error saving company profile.", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppShell
      page="company-setup"
      setPage={setPage}
      title="Company Setup"
      subtitle="Manage your organization profile, contact details, and operational settings."
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader
            icon={<Lu.Building2 className="h-[18px] w-[18px]" />}
            title="Company profile"
            description="These details give your assistant bounded context about your business."
            action={<Toast message={statusMessage} />}
          />
          <CardBody className="space-y-5">
            <Field label="Company name">
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company name" className={controlCls} />
            </Field>
            <Field label="Website URL">
              <div className="relative">
                <Lu.Globe className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://your-company.example" className={cn(controlCls, "pl-10")} />
              </div>
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Company phone">
                <div className="relative">
                  <Lu.Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder="+230 ..." className={cn(controlCls, "pl-10")} />
                </div>
              </Field>
              <Field label="Support email">
                <div className="relative">
                  <Lu.Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@your-company.example" className={cn(controlCls, "pl-10")} />
                </div>
              </Field>
            </div>
            <Field label="Default timezone">
              <SelectWrap>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={selectCls}>
                  <option value="Indian/Mauritius">Mauritius — Indian/Mauritius (UTC+04:00)</option>
                  <option value="America/New_York">Eastern Time — America/New_York</option>
                  <option value="America/Los_Angeles">Pacific Time — America/Los_Angeles</option>
                  <option value="America/Chicago">Central Time — America/Chicago</option>
                  <option value="Europe/London">London — Europe/London</option>
                  <option value="UTC">UTC</option>
                </select>
              </SelectWrap>
            </Field>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setPage("dashboard")}>Cancel</Button>
              <Button loading={isSaving} onClick={handleSave} icon={<Lu.Save className="h-4 w-4" />}>{isSaving ? "Saving..." : "Save changes"}</Button>
            </div>
          </CardBody>
        </Card>

        <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 to-white lg:sticky lg:top-24">
          <CardBody>
            <div className="flex items-center gap-2 font-[Bricolage_Grotesque] text-[15px] font-bold text-indigo-700">
              <Lu.Sparkles className="h-4 w-4" /> Setup context
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
              Company details provide bounded context for your assistant. They do not grant new tools or change platform security rules.
            </p>
            <ul className="mt-4 space-y-2.5">
              {["Company-specific assistant profile", "Google Calendar connection is company-scoped", "3CX call handling is not active yet"].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[13px] font-medium text-slate-700">
                  <Lu.CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                  {t}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}

// ─── Assistant Config (app screen) ───────────────────────────────────────────

function AssistantConfigPage({ setPage, onTestDraft }: { setPage: (p: Page) => void; onTestDraft: (version: number) => void }) {
  const [assistantName, setAssistantName] = useState("");
  const [voiceEngine, setVoiceEngine] = useState("Aoede");
  const [inboundGreeting, setInboundGreeting] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [knowledgeBaseNotes, setKnowledgeBaseNotes] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState<ResponseLanguage>("en");
  const [allowedLanguages, setAllowedLanguages] = useState<ResponseLanguage[]>(["fr-FR", "fr-BE", "en"]);
  const [tone, setTone] = useState<OnboardingAssistantDraft["tone"]>("friendly");
  const [businessHours, setBusinessHours] = useState<Record<string, string>>({});
  const [escalationRules, setEscalationRules] = useState<string[]>([]);
  const [faqEntries, setFaqEntries] = useState<FAQEntry[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityFlags>({ ...DEFAULT_CAPABILITY_FLAGS });
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [profileStatus, setProfileStatus] = useState<"loading" | "ready" | "error">("loading");

  const refreshPublishedProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/assistant-config/versions", { cache: "no-store" });
      if (!response.ok) throw new Error("Profile versions unavailable");
      const payload = await response.json();
      const versions = Array.isArray(payload.data) ? payload.data : [];
      const current = versions.find((item: { lifecycle_state?: string }) => item.lifecycle_state === "published");
      setPublishedVersion(typeof current?.version === "number" ? current.version : null);
      setProfileStatus("ready");
    } catch {
      setProfileStatus("error");
    }
  }, []);

  useEffect(() => {
    async function loadAssistant() {
      try {
        const res = await fetch("/api/assistant-config", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            if (json.data.assistant_name) setAssistantName(json.data.assistant_name);
            if (json.data.voice_engine) setVoiceEngine(json.data.voice_engine);
            if (json.data.inbound_greeting) setInboundGreeting(json.data.inbound_greeting);
            if (json.data.system_prompt) setSystemPrompt(json.data.system_prompt);
            if (json.data.knowledge_base_notes) setKnowledgeBaseNotes(json.data.knowledge_base_notes);
            const loadedDefaultLanguage = readResponseLanguage(json.data.default_language);
            setDefaultLanguage(loadedDefaultLanguage);
            setAllowedLanguages(readAllowedLanguages(json.data.allowed_languages, loadedDefaultLanguage));
            if (["professional", "friendly", "warm", "concise"].includes(json.data.tone)) setTone(json.data.tone);
            setBusinessHours(json.data.business_hours || {});
            setEscalationRules(json.data.escalation_rules || []);
            setFaqEntries(json.data.faq_entries || []);
            setCapabilities(readCapabilityFlags(json.data.capabilities));
          }
        }
      } catch (e) {
        logSafeFailure("Assistant configuration load failed", e, "warn");
      }
    }
    loadAssistant();
    refreshPublishedProfile();
  }, [refreshPublishedProfile]);

  const handleSave = async (deploy = false): Promise<number | null> => {
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const config = {
        assistant_name: assistantName,
        voice_engine: voiceEngine,
        inbound_greeting: inboundGreeting,
        system_prompt: systemPrompt,
        knowledge_base_notes: knowledgeBaseNotes,
        default_language: defaultLanguage,
        allowed_languages: allowedLanguages,
        tone,
        business_hours: businessHours,
        escalation_rules: escalationRules,
        faq_entries: faqEntries,
        capabilities: writeCapabilityFlags(capabilities),
      };
      if (deploy) {
        const validation = await fetch("/api/assistant-config/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...config, is_deployed: false }),
        });
        const validationResult = await validation.json().catch(() => null);
        if (!validation.ok || validationResult?.status !== "valid") {
          throw new Error(validationResult?.detail || "Assistant profile validation failed. Review the configuration before publishing.");
        }
      }
      const res = await fetch("/api/assistant-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, is_deployed: deploy }),
      });
      if (res.ok) {
        const saved = await res.json().catch(() => null);
        if (deploy) await refreshPublishedProfile();
        setStatusMessage({
          text: deploy ? "Assistant profile published. New sessions will use this version." : "Assistant draft saved.",
          type: "success",
        });
        setTimeout(() => setStatusMessage(null), 4000);
        return Number.isInteger(saved?.data?.profile_version) ? saved.data.profile_version : null;
      } else {
        const error = await res.json().catch(() => null);
        setStatusMessage({ text: error?.detail || "Failed to save assistant configuration.", type: "error" });
      }
    } catch (e) {
      setStatusMessage({ text: e instanceof Error ? e.message : "Network error saving assistant config.", type: "error" });
    } finally {
      setIsSaving(false);
    }
    return null;
  };

  return (
    <AppShell
      page="assistant-config"
      setPage={setPage}
      title="AI Assistant"
      subtitle="Manage voice engine, prompts, and deployment settings for your AI assistants."
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              icon={<Lu.Bot className="h-[18px] w-[18px]" />}
              title="Identity & voice"
              description="How your assistant is named and how it sounds to callers."
              action={<Toast message={statusMessage} />}
            />
            <CardBody className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Assistant identifier">
                  <input value={assistantName} onChange={(e) => setAssistantName(e.target.value)} placeholder="Name this assistant for your company" className={controlCls} />
                </Field>
                <Field label="Gemini Live voice engine">
                  <SelectWrap>
                    <select value={voiceEngine} onChange={(e) => setVoiceEngine(e.target.value)} className={selectCls}>
                      <option value="Aoede">Aoede (Expressive, Warm, Engaging Female)</option>
                      <option value="Puck">Puck (Natural, Approachable, Dynamic Male)</option>
                      <option value="Charon">Charon (Calm, Confident, Authoritative Male)</option>
                      <option value="Kore">Kore (Clear, Polished, Professional Female)</option>
                      <option value="Fenrir">Fenrir (Resonant, Deep, Energetic Male)</option>
                    </select>
                  </SelectWrap>
                </Field>
              </div>
              <Field label="Inbound greeting phrase" hint={`${inboundGreeting.length}/500 characters`}>
                <input maxLength={500} value={inboundGreeting} onChange={(e) => setInboundGreeting(e.target.value)} placeholder="Write the greeting your callers should hear" className={controlCls} />
              </Field>
              <LanguagePolicyFields
                defaultLanguage={defaultLanguage}
                allowedLanguages={allowedLanguages}
                onChange={(nextDefault, nextAllowed) => {
                  setDefaultLanguage(nextDefault);
                  setAllowedLanguages(nextAllowed);
                }}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={<Lu.MessageSquareText className="h-[18px] w-[18px]" />} title="Instructions" description="Platform security and tool permissions remain enforced regardless of the prompt." />
            <CardBody className="space-y-5">
              <Field label="System instructions (AI prompt)">
                <textarea
                  rows={6}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Describe your company, services, tone, and approved operating rules. Platform security and tool permissions remain enforced."
                  className={cn(controlCls, "resize-y")}
                />
              </Field>
              <Field label="Approved company reference notes" hint={`${knowledgeBaseNotes.length}/16000 characters`}>
                <textarea
                  rows={4}
                  maxLength={16000}
                  value={knowledgeBaseNotes}
                  onChange={(event) => setKnowledgeBaseNotes(event.target.value)}
                  placeholder="Enter company facts and approved answers. File upload is not available yet."
                  className={cn(controlCls, "resize-y")}
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={<Lu.SlidersHorizontal className="h-[18px] w-[18px]" />} title="Capabilities & operations" description="Choose what the assistant can do and how it behaves." />
            <CardBody>
              <CapabilityChoices
                value={capabilities}
                onChange={(key, enabled) => setCapabilities((current) => ({ ...current, [key]: enabled }))}
              />
              <CompanyOperatingFields
                tone={tone} onToneChange={setTone}
                businessHours={businessHours} onBusinessHoursChange={setBusinessHours}
                escalationRules={escalationRules} onEscalationRulesChange={setEscalationRules}
                faqEntries={faqEntries} onFaqEntriesChange={setFaqEntries}
                showFaq={capabilities.company_faq}
              />
            </CardBody>
          </Card>

          {/* Sticky action bar */}
          <div className="sticky bottom-3 z-20 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-[0_10px_40px_-10px_rgba(15,23,42,0.25)] backdrop-blur-xl">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button
                variant="secondary"
                loading={isSaving}
                icon={<Lu.FlaskConical className="h-4 w-4" />}
                onClick={async () => {
                  const version = await handleSave(false);
                  if (version !== null) onTestDraft(version);
                }}
              >
                {isSaving ? "Saving…" : "Save & test draft"}
              </Button>
              <Button variant="secondary" disabled={isSaving} icon={<Lu.Save className="h-4 w-4" />} onClick={() => handleSave(false)}>
                Save draft
              </Button>
              <Button disabled={isSaving} icon={<Lu.Rocket className="h-4 w-4" />} onClick={() => handleSave(true)}>
                Publish assistant profile
              </Button>
            </div>
          </div>
        </div>

        {/* Sandbox launcher */}
        <Card className="overflow-hidden border-indigo-100 lg:sticky lg:top-24">
          <div className="relative bg-gradient-to-br from-indigo-600 to-violet-600 p-5 text-white">
            <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-xl" />
            <div className="relative flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-indigo-100">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" /> Gemini Live voice engine
            </div>
            <h3 className="relative mt-2 font-[Bricolage_Grotesque] text-lg font-bold">Interactive testing sandbox</h3>
            <p className="relative mt-1.5 text-[13px] leading-relaxed text-indigo-100">
              Speak with your live AI assistant with real-time audio, live transcription and waveform feedback.
            </p>
          </div>
          <CardBody className="space-y-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Active voice model</div>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Lu.Sparkles className="h-4 w-4 text-indigo-500" /> {voiceEngine} (Gemini Live)
              </div>
            </div>
            <Button block size="lg" icon={<Lu.Mic className="h-4 w-4" />} onClick={() => setPage("testing-sandbox")}>
              Launch testing sandbox
            </Button>
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("landing");
  const [previewProfileVersion, setPreviewProfileVersion] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const search = typeof window !== "undefined" ? window.location.search : "";
    getSession({ force: Boolean(search), query: search })
      .then(async (sessionPayload) => {
        if (!sessionPayload) {
          if (active) { setPage("landing"); setLoading(false); }
          return;
        }
        const user = sessionPayload?.user || sessionPayload?.session?.user;
        if (!active) return;
        if (!user) {
          setPage("landing");
          setLoading(false);
          return;
        }

        if (typeof window !== "undefined" && window.location.search.includes("neon_auth_session_verifier")) {
          window.history.replaceState({}, "", window.location.pathname);
        }

        // An authenticated user should never remain on the public landing page
        // while their company profile is loading or temporarily unavailable.
        setPage("onboarding-goals");
        try {
          const profilePayload = await getCompanyProfile();
          if (!active) return;
          const companyName = String(profilePayload?.company_name || "").trim();
          setPage(companyName ? "dashboard" : "onboarding-goals");
        } catch {
          if (active) setPage("onboarding-goals");
        } finally {
          if (active) setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setPage("landing");
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  const render = () => {
    if (loading) {
      return (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#090d16", color: "#94a3b8", fontFamily: "Inter" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 36, height: 36, border: "3px solid rgba(255,255,255,0.1)", borderTopColor: "#6366F1", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
            <p style={{ fontSize: 13, letterSpacing: "0.02em" }}>Connecting to your workspace…</p>
          </div>
        </div>
      );
    }
    switch (page) {
      case "landing": return <LandingPage setPage={setPage} />;
      case "signup": return <AuthRedirect />;
      case "onboarding-goals": return <PersistedCompanyOnboardingPage setPage={setPage} />;
      case "onboarding-company": return <PersistedCompanyOnboardingPage setPage={setPage} />;
      case "onboarding-ai": return <PersistedAssistantOnboardingPage setPage={setPage} />;
      case "dashboard": return <DashboardPage setPage={setPage} />;
      case "calls": return <CallsPage setPage={setPage} />;
      case "phone-numbers": return <PhoneNumbersPage setPage={setPage} />;
      case "integrations": return <IntegrationsPage setPage={setPage} />;
      case "company-setup": return <CompanySetupPage setPage={setPage} />;
      case "assistant-config": return <AssistantConfigPage
        setPage={setPage}
        onTestDraft={(version) => { setPreviewProfileVersion(version); setPage("testing-sandbox"); }}
      />;
      case "testing-sandbox": return (
        <AppShell
          page="assistant-config"
          setPage={setPage}
          title="Interactive Voice Testing Sandbox"
          subtitle="Real-time conversational testing with Gemini Live"
        >
          <TestingSandboxPage
            profileVersion={previewProfileVersion}
            onBack={() => { setPreviewProfileVersion(null); setPage("assistant-config"); }}
          />
        </AppShell>
      );
    }
  };

  return <>
    {render()}
    <BookingUpdateCenter enabled={!loading && page !== "landing" && page !== "signup"} />
  </>;
}
