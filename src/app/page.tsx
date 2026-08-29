'use client';

import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { HealMark } from '@/components/HealMark';
import {
  Activity,
  GitPullRequest,
  ShieldCheck,
  Box,
  Search,
  Wrench,
  UserCheck,
} from 'lucide-react';

const STEPS = [
  { icon: Box, title: 'Isolate', detail: 'Daytona sandbox runs the failing suite and captures the baseline trace.' },
  { icon: Search, title: 'Diagnose', detail: 'TrueForge diagnostic agent localizes the AST node behind the failure.' },
  { icon: Wrench, title: 'Patch', detail: 'A bounded patch is synthesized — no drive-by refactors.' },
  { icon: ShieldCheck, title: 'Verify', detail: 'Tests re-run green; Qodo scores quality before anyone sees a PR.' },
  { icon: UserCheck, title: 'Approve', detail: 'The turn pauses. You allow or deny. Nothing merges itself.' },
  { icon: GitPullRequest, title: 'PR', detail: 'GitHub branch + pull request with evidence, via Composio or MCP.' },
];

export default function Page() {
  return (
    <div className="min-h-screen bg-[#07110d] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.12),_transparent_55%)]" />
      <Navbar sessionStatus="IDLE" />

      <header className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 md:pt-24">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-emerald-300">
          <Activity className="h-3.5 w-3.5" />
          Autonomous heal loop
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl md:leading-[1.05]">
          Failing tests in.
          <span className="text-emerald-400"> A verified PR out.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
          OpenHeal is mission control for a self-healing swarm: TrueForge runs the agent loop,
          Daytona isolates the repo, Qodo scores the patch, and a human still signs the GitHub PR.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-3 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
          >
            <HealMark className="h-4 w-4" />
            Launch mission control
          </Link>
          <a
            href="#pipeline"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-5 py-3 text-sm text-slate-300 hover:border-emerald-500/40 hover:text-white"
          >
            See the heal loop
          </a>
        </div>
      </header>

      <section id="pipeline" className="relative border-y border-emerald-500/10 bg-black/20">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80">The loop</h2>
          <p className="mt-2 max-w-xl text-2xl font-medium text-white">
            Not another bug dashboard. The same six steps the console actually runs.
          </p>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <article
                  key={step.title}
                  className="rounded-xl border border-slate-800 bg-slate-950/50 p-5"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <span className="font-mono text-[10px] text-emerald-500/70">0{i + 1}</span>
                    <Icon className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-white">{step.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-400">{step.detail}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="stack" className="relative mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400/80">What it runs on</h2>
        <p className="mt-2 text-2xl font-medium text-white">The harness, sandbox, scorecard, and forge — not a mock of them.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {[
            ['TrueForge', 'Session, turns, HITL pause, subagents'],
            ['Daytona', 'Isolated kernel + filesystem for tests'],
            ['Qodo', 'Quality / security score on the diff'],
            ['GitHub', 'OAuth via Composio, or MCP + REST'],
          ].map(([name, blurb]) => (
            <div key={name} className="rounded-xl border border-slate-800 px-4 py-5">
              <div className="text-sm font-semibold text-emerald-300">{name}</div>
              <p className="mt-2 text-sm text-slate-400">{blurb}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-8 text-center">
          <p className="text-lg text-white">Pick a broken fixture, watch the swarm, approve the PR.</p>
          <Link
            href="/app"
            className="mt-5 inline-flex rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-100"
          >
            Open the console
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center font-mono text-[11px] text-slate-500">
        OpenHeal · TrueForge harness · Daytona sandbox · human-gated GitHub PR
      </footer>
    </div>
  );
}
