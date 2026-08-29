import { NextResponse } from 'next/server';
import { ensureComposioUserId } from '@/lib/composio/user';
import { executeGithubTool, getActiveGithubConnection, githubConnectionHasWebhookScope, isComposioConfigured } from '@/lib/composio/client';

export async function GET() {
  try {
    if (!isComposioConfigured()) {
      return NextResponse.json({ success: true, configured: false, repos: [] });
    }
    const userId = await ensureComposioUserId();
    const connection = await getActiveGithubConnection(userId);
    if (!connection) {
      return NextResponse.json({ success: true, connected: false, repos: [] });
    }

    const data = await executeGithubTool('GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER', userId, {
      per_page: 100,
      sort: 'updated',
    });

    const items = extractRepos(data);
    return NextResponse.json({
      success: true,
      connected: true,
      userId,
      webhookScopeOk: githubConnectionHasWebhookScope(connection),
      repos: items,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to list repositories';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function extractRepos(data: unknown): Array<{ fullName: string; htmlUrl: string; private: boolean; description?: string }> {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { repositories?: unknown }).repositories)
      ? (data as { repositories: unknown[] }).repositories
      : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
        ? (data as { items: unknown[] }).items
        : [];

  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const r = item as Record<string, unknown>;
      const fullName = String(r.full_name || `${r.owner && typeof r.owner === 'object' ? (r.owner as { login?: string }).login : ''}/${r.name || ''}`);
      if (!fullName || fullName === '/') return null;
      return {
        fullName,
        htmlUrl: String(r.html_url || `https://github.com/${fullName}`),
        private: Boolean(r.private),
        description: typeof r.description === 'string' ? r.description : undefined,
      };
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
}
