'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

interface GithubStatus {
  configured: boolean;
  connected: boolean;
  webhookScopeOk?: boolean;
  message?: string;
  error?: string;
}

export function GitHubConnectButton({ onConnected }: { onConnected?: () => void }) {
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
        webhookScopeOk: data.webhookScopeOk !== false,
        message: data.message,
        error: data.error,
      });
    } catch (err) {
      setStatus({
        configured: false,
        connected: false,
        error: err instanceof Error ? err.message : 'Could not check the GitHub connection.',
      });
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
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not start GitHub sign-in.');
      if (data.alreadyConnected) {
        setStatus((prev) => ({ ...prev, connected: true, configured: true }));
        onConnected?.();
        return;
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      throw new Error('GitHub sign-in did not return a redirect address.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to GitHub.');
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async () => {
    setBusy(true);
    setError('');
    try {
      await fetch('/api/github/disconnect', { method: 'POST' });
      await connect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reconnect GitHub.');
      setBusy(false);
    }
  };

  if (status.connected) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded border border-pass/40 bg-pass-wash px-2.5 py-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-pass" strokeWidth={2.5} />
          <div>
            <p className="text-[12px] font-medium text-ink">GitHub connected</p>
            <p className="text-[11px] leading-snug text-ink-2">
              {status.webhookScopeOk
                ? 'PR webhooks can be armed on enrolled repos.'
                : 'Missing webhook permission — reconnect to auto-run on PRs.'}
            </p>
          </div>
        </div>
        {!status.webhookScopeOk ? (
          <button
            type="button"
            onClick={reconnect}
            disabled={busy}
            className="rounded border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-ink hover:bg-amber-500/20 disabled:opacity-60"
          >
            {busy ? 'Reconnecting…' : 'Reconnect GitHub (webhook scopes)'}
          </button>
        ) : null}
      </div>
    );
  }

  const note = error || status.error || status.message;

  return (
    <div>
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded border border-rule-strong bg-card px-3 py-2 text-[12px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
        Connect GitHub
      </button>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-3">
        {status.configured
          ? 'Signs in through your browser — no token to paste.'
          : 'Add COMPOSIO_API_KEY to your .env to enable browser sign-in.'}
      </p>
      {note && <p className="mt-1 text-[11px] leading-snug text-fail">{note}</p>}
    </div>
  );
}

export default GitHubConnectButton;
