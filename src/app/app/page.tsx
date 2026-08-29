'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HealMark } from '@/components/HealMark';
import { GitHubConnectButton } from '@/components/GitHubConnectButton';
import { ConnectedReposPanel } from '@/components/ConnectedReposPanel';
import { RunsTable } from '@/components/RunsTable';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-rule bg-card">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2 text-ink">
            <HealMark className="h-5 w-5" />
            <span className="t-display text-[17px]">OpenHeal</span>
          </Link>
          <div className="flex items-center gap-3">
            <GitHubConnectButton />
            <Link
              href="/app/lab"
              className="rounded border border-rule-strong bg-card px-3 py-1.5 text-[13px] text-ink hover:bg-paper-2"
            >
              Lab runs
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        <section>
          <p className="t-label">Agent swarm PR review</p>
          <h1 className="t-display mt-2 text-[32px] leading-tight">Your repositories and review runs</h1>
          <p className="mt-3 max-w-2xl text-[15px] text-ink-2">
            Connect GitHub, watch a repository, and OpenHeal&apos;s swarm (BuildOps → Explorer → Diagnostic →
            Reporter) runs automatically on every pull request — then posts evidence on the PR.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <ConnectedReposPanel />
          <RunsTable />
        </div>

        <section className="rounded border border-rule bg-card p-4">
          <h2 className="t-label mb-2">How it works</h2>
          <ol className="space-y-2 text-[13px] text-ink-2">
            <li>1. Connect GitHub and toggle <strong>Watch PRs</strong> on a repository.</li>
            <li>2. Open or update a pull request — Composio webhook starts a swarm run.</li>
            <li>3. Agents build the app, explore flows, diagnose root causes, comment on the PR.</li>
            <li>4. Open a run from the table to watch the live swarm timeline.</li>
          </ol>
          <Link
            href="/app/lab"
            className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-signal hover:underline"
          >
            Try a manual lab run
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>
    </div>
  );
}
