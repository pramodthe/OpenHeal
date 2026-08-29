import { TrueForge } from '@truefoundry/trueforge-sdk';

export function getTrueForgeBaseUrl(): string {
  return process.env.TRUEFORGE_BASE_URL?.trim() || 'http://localhost:8790';
}

export function createTrueForgeClient(): TrueForge {
  // Local `npx @truefoundry/trueforge` has no login — omit token.
  // Only hosted OIDC deployments need a Bearer ID token.
  const token = process.env.TRUEFORGE_TOKEN?.trim();
  const baseUrl = getTrueForgeBaseUrl();
  const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
  return new TrueForge({
    baseUrl,
    ...(token && !isLocal ? { token } : {}),
    timeoutInSeconds: 600,
  });
}

export async function probeTrueForge(): Promise<{ ok: boolean; baseUrl: string; error?: string }> {
  const baseUrl = getTrueForgeBaseUrl();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return { ok: true, baseUrl };
    return { ok: false, baseUrl, error: `TrueForge health ${res.status}` };
  } catch (err) {
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404 || res.status === 401) return { ok: true, baseUrl };
      return { ok: false, baseUrl, error: `TrueForge ${res.status}` };
    } catch (inner) {
      const message = inner instanceof Error ? inner.message : String(err);
      return { ok: false, baseUrl, error: message };
    }
  }
}
