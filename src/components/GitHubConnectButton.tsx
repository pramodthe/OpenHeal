'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, GitBranch, Loader2 } from 'lucide-react';

interface GithubStatus {
  configured: boolean;
  connected: boolean;
  message?: string;
  error?: string;
}

export function GitHubConnectButton() {
  const [status, setStatus] = useState<GithubStatus>({ configured: false, connected: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/github/status');
      const data = await res.json();
      setStatus({
        configured: Boolean(data.configured),
        connected: Boolean(data.connected),
        message: data.message,
        error: data.error,
      });
    } catch (err) {
      setStatus({ configured: false, connected: false, error: err instanceof Error ? err.message : 'Status check failed' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('github') === 'connected') {
      void refresh();
    }
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/github/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not start GitHub OAuth');
      if (data.alreadyConnected) {
        setStatus((prev) => ({ ...prev, connected: true, configured: true }));
        return;
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      throw new Error('Composio did not return a redirect URL');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed');
    } finally {
      setBusy(false);
    }
  };

  if (status.connected) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
        <div className="flex items-center gap-2 font-mono text-[11px] font-semibold text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          GitHub connected
        </div>
        <p className="mt-1 font-mono text-[10px] text-emerald-400/70">PRs open with this account after you approve.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-black/30 px-3 py-2">
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 font-mono text-[11px] text-white hover:border-emerald-500/50 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
        Connect GitHub
      </button>
      <p className="font-mono text-[10px] leading-relaxed text-slate-500">
        Browser OAuth via Composio — no PAT.
        {status.configured ? '' : ' Needs COMPOSIO_API_KEY in .env.'}
      </p>
      {(error || status.error || status.message) && (
        <p className="font-mono text-[10px] text-rose-400">{error || status.error || status.message}</p>
      )}
    </div>
  );
}
