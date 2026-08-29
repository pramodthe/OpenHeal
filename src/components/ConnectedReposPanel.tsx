'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GitHubConnectButton } from '@/components/GitHubConnectButton';

interface RepoItem {
  fullName: string;
  htmlUrl: string;
  private: boolean;
  description?: string;
}

interface TriggerFailure {
  slug: string;
  error: string;
}

interface EnrolledRepo {
  fullName: string;
  watchPrs: boolean;
  autoFix: boolean;
  triggerArmed?: string[];
  triggerFailed?: TriggerFailure[];
}

export function ConnectedReposPanel() {
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [enrolled, setEnrolled] = useState<EnrolledRepo[]>([]);
  const [connected, setConnected] = useState(false);
  const [webhookScopeOk, setWebhookScopeOk] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prInputs, setPrInputs] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [reposRes, enrolledRes] = await Promise.all([
        fetch('/api/github/repos'),
        fetch('/api/github/repos/enroll'),
      ]);
      const reposData = await reposRes.json();
      const enrolledData = await enrolledRes.json();
      setConnected(Boolean(reposData.connected));
      setWebhookScopeOk(reposData.webhookScopeOk !== false);
      setRepos(reposData.repos || []);
      setEnrolled(enrolledData.repos || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load repositories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isEnrolled = (fullName: string) =>
    enrolled.find((e) => e.fullName.toLowerCase() === fullName.toLowerCase());

  const toggleWatch = async (repo: RepoItem) => {
    const existing = isEnrolled(repo.fullName);
    const res = await fetch('/api/github/repos/enroll', {
      method: existing?.watchPrs ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: repo.fullName,
        htmlUrl: repo.htmlUrl,
        watchPrs: !existing?.watchPrs,
        autoFix: existing?.autoFix ?? false,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Failed to update repository');
      return;
    }
    if (data.needsReconnect) {
      setWebhookScopeOk(false);
    }
    await refresh();
  };

  const startManualReview = async (fullName: string) => {
    const prNumber = Number(prInputs[fullName]);
    if (!Number.isFinite(prNumber) || prNumber < 1) {
      setError('Enter a valid PR number');
      return;
    }
    setStarting(fullName);
    setError('');
    try {
      const res = await fetch('/api/review/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, prNumber }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to start review');
        return;
      }
      window.location.href = `/app/runs/${data.sessionId}`;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start review');
    } finally {
      setStarting(null);
    }
  };

  const enrolledWatching = enrolled.filter((e) => e.watchPrs);
  const anyTriggerFailed = enrolledWatching.some((e) => (e.triggerFailed?.length ?? 0) > 0);

  return (
    <section className="rounded border border-rule bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-label">Connected repositories</h2>
        <GitHubConnectButton onConnected={refresh} />
      </div>

      {!webhookScopeOk || anyTriggerFailed ? (
        <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-ink">
          <p className="font-medium">PR auto-trigger is not fully armed.</p>
          <p className="mt-1 text-ink-2">
            Composio needs an HTTPS webhook to arm PR triggers. In a second terminal run{' '}
            <code className="t-mono text-[11px]">npm run tunnel</code>, restart dev, then toggle Watch PRs.
            (Uses cloudflared — no ngrok account needed.)
          </p>
          <p className="mt-1 text-ink-2">
            Until then, use <strong>Run review</strong> with a PR number — it works without webhooks.
          </p>
        </div>
      ) : null}

      {loading ? <p className="text-[13px] text-ink-2">Loading repositories…</p> : null}
      {error ? <p className="mb-2 text-[13px] text-fail">{error}</p> : null}
      {!loading && !connected ? (
        <p className="text-[13px] text-ink-2">Connect GitHub to list your repositories and watch PRs.</p>
      ) : null}
      {!loading && connected ? (
        <ul className="max-h-[480px] space-y-2 overflow-y-auto">
          {repos.map((repo) => {
            const en = isEnrolled(repo.fullName);
            const triggerError = en?.triggerFailed?.[0]?.error;
            return (
              <li
                key={repo.fullName}
                className="rounded border border-rule bg-paper px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <a
                      href={repo.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="t-mono block truncate text-[13px] text-ink hover:underline"
                    >
                      {repo.fullName}
                    </a>
                    {repo.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">
                        {repo.description}
                      </p>
                    ) : null}
                    {en?.watchPrs && triggerError ? (
                      <p className="mt-1 text-[11px] text-amber-700">{triggerError.slice(0, 160)}…</p>
                    ) : null}
                    {en?.watchPrs && en.triggerArmed?.length ? (
                      <p className="mt-1 text-[11px] text-signal">Auto-trigger armed</p>
                    ) : null}
                  </div>
                  <button
                    onClick={() => toggleWatch(repo)}
                    className={`shrink-0 rounded px-2.5 py-1 text-[12px] font-medium ${
                      en?.watchPrs
                        ? 'bg-signal text-white'
                        : 'border border-rule-strong bg-card text-ink hover:bg-paper-2'
                    }`}
                  >
                    {en?.watchPrs ? 'Watching PRs' : 'Watch PRs'}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-rule pt-2">
                  <label className="sr-only" htmlFor={`pr-${repo.fullName}`}>
                    PR number for {repo.fullName}
                  </label>
                  <input
                    id={`pr-${repo.fullName}`}
                    type="number"
                    min={1}
                    placeholder="PR #"
                    value={prInputs[repo.fullName] || ''}
                    onChange={(e) =>
                      setPrInputs((prev) => ({ ...prev, [repo.fullName]: e.target.value }))
                    }
                    className="w-20 rounded border border-rule bg-card px-2 py-1 text-[12px]"
                  />
                  <button
                    type="button"
                    disabled={starting === repo.fullName}
                    onClick={() => startManualReview(repo.fullName)}
                    className="rounded border border-rule-strong bg-card px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
                  >
                    {starting === repo.fullName ? 'Starting…' : 'Run review'}
                  </button>
                  {!en?.watchPrs ? (
                    <span className="text-[11px] text-ink-3">Watch PRs for auto-trigger on new PRs</span>
                  ) : (
                    <Link href="/app/lab" className="text-[11px] text-ink-3 underline">
                      or use Lab
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
