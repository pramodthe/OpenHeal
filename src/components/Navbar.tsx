'use client';

import Link from 'next/link';
import { HealMark } from '@/components/HealMark';

export interface NavbarProps {
  sessionId?: string;
  sessionStatus: string;
  isStreaming?: boolean;
  onResetSession?: () => void;
}

export function Navbar({
  sessionId,
  sessionStatus,
  isStreaming,
  onResetSession,
}: NavbarProps) {
  const badge = statusBadge(sessionStatus);

  return (
    <nav className="sticky top-0 z-50 border-b border-emerald-500/15 bg-[#07110d]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 text-emerald-300">
          <HealMark className="h-6 w-6" />
          <span className="text-sm font-semibold tracking-tight text-white">
            OpenHeal
          </span>
          <span className="hidden rounded border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-400/80 sm:inline">
            Self-heal
          </span>
        </Link>

        <div className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
          <a href="#pipeline" className="hover:text-emerald-300">
            Heal loop
          </a>
          <a href="#stack" className="hover:text-emerald-300">
            Stack
          </a>
          <Link href="/app" className="hover:text-emerald-300">
            Mission control
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`hidden items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider sm:flex ${badge.className}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
            {isStreaming ? 'Live' : badge.label}
          </div>
          {sessionId && onResetSession ? (
            <button
              onClick={onResetSession}
              className="rounded-md border border-slate-700 px-3 py-1.5 font-mono text-[11px] text-slate-300 hover:border-emerald-500/40 hover:text-white"
            >
              Reset
            </button>
          ) : (
            <Link
              href="/app"
              className="rounded-md bg-emerald-500 px-3 py-1.5 font-mono text-[11px] font-semibold text-emerald-950 hover:bg-emerald-400"
            >
              Open console
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case 'IDLE':
      return { label: 'Idle', className: 'border-slate-700 text-slate-400', dot: 'bg-slate-500' };
    case 'PROVISIONING_SANDBOX':
    case 'CAPTURING_BASELINE':
      return { label: 'Sandbox', className: 'border-amber-500/30 text-amber-300', dot: 'bg-amber-400 animate-pulse' };
    case 'DIAGNOSING':
      return { label: 'Diagnosing', className: 'border-sky-500/30 text-sky-300', dot: 'bg-sky-400 animate-ping' };
    case 'SYNTHESIZING':
      return { label: 'Patching', className: 'border-cyan-500/30 text-cyan-300', dot: 'bg-cyan-400 animate-ping' };
    case 'VERIFYING':
      return { label: 'Verifying', className: 'border-yellow-500/30 text-yellow-300', dot: 'bg-yellow-400 animate-pulse' };
    case 'AWAITING_HUMAN_APPROVAL':
      return { label: 'Needs you', className: 'border-emerald-400/40 text-emerald-300', dot: 'bg-emerald-400 animate-ping' };
    case 'EXECUTING_PR':
      return { label: 'Opening PR', className: 'border-violet-500/30 text-violet-300', dot: 'bg-violet-400' };
    case 'COMPLETED':
      return { label: 'Healed', className: 'border-emerald-500/40 text-emerald-300', dot: 'bg-emerald-400' };
    case 'REJECTED':
    case 'FAILED':
      return { label: status === 'FAILED' ? 'Failed' : 'Rejected', className: 'border-rose-500/30 text-rose-300', dot: 'bg-rose-400' };
    default:
      return { label: status || 'Idle', className: 'border-slate-700 text-slate-400', dot: 'bg-slate-500' };
  }
}

export default Navbar;
