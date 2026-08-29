import { AuthConfigTypes, Composio } from '@composio/core';

let client: Composio | null = null;
let cachedAuthConfigId: string | null = null;

export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim());
}

export function getComposio(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'COMPOSIO_API_KEY is not set. Add it to .env so users can Connect GitHub instead of pasting a PAT.'
    );
  }
  if (!client) {
    client = new Composio({
      apiKey,
      toolkitVersions: { github: 'latest' },
    });
  }
  return client;
}

const OPENHEAL_AUTH_CONFIG_NAME = 'OpenHeal GitHub Webhooks';
const REQUIRED_HOOK_SCOPES = ['admin:repo_hook', 'write:repo_hook'] as const;

function authConfigHasHookScopes(item: { credentials?: { scopes?: string[] | string } }): boolean {
  const raw = item.credentials?.scopes;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[\s,]+/)
      : [];
  return REQUIRED_HOOK_SCOPES.some((scope) => list.includes(scope));
}

export async function getGithubAuthConfigId(): Promise<string> {
  const fromEnv = process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID?.trim();
  if (fromEnv) return fromEnv;
  if (cachedAuthConfigId) return cachedAuthConfigId;

  const composio = getComposio();
  const listed = await composio.authConfigs.list({ toolkit: 'github' });
  const withHooks =
    listed.items.find((item) => item.status === 'ENABLED' && authConfigHasHookScopes(item)) ||
    listed.items.find((item) => authConfigHasHookScopes(item));
  if (withHooks?.id) {
    cachedAuthConfigId = withHooks.id;
    return withHooks.id;
  }

  const created = await composio.authConfigs.create('github', {
    type: AuthConfigTypes.COMPOSIO_MANAGED,
    name: OPENHEAL_AUTH_CONFIG_NAME,
    // PR triggers register a repo webhook — GitHub returns 404 without hook scopes.
    credentials: { scopes: 'repo,admin:repo_hook,read:repo_hook,write:repo_hook' },
  });
  cachedAuthConfigId = created.id;
  return created.id;
}

export const GITHUB_WEBHOOK_SCOPES = ['admin:repo_hook', 'write:repo_hook'] as const;

export function githubConnectionHasWebhookScope(connection: unknown): boolean {
  if (!connection || typeof connection !== 'object') return false;
  const c = connection as {
    data?: { scope?: string };
    state?: { val?: unknown };
  };
  const stateVal = c.state?.val;
  const stateScope =
    stateVal && typeof stateVal === 'object' && 'scope' in stateVal
      ? String((stateVal as { scope?: string }).scope || '')
      : '';
  const scopeStr = c.data?.scope || stateScope || '';
  const granted = scopeStr.split(/[\s,]+/).filter(Boolean);
  return GITHUB_WEBHOOK_SCOPES.some((needed) => granted.includes(needed));
}

export async function getActiveGithubConnection(userId: string) {
  const composio = getComposio();
  const listed = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: ['github'],
    statuses: ['ACTIVE'],
  });
  return listed.items[0] || null;
}

export async function executeGithubTool(
  slug: string,
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result = await getComposio().tools.execute(slug, {
    userId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
  if (result && typeof result === 'object' && 'successful' in result && result.successful === false) {
    const error = 'error' in result && typeof result.error === 'string' ? result.error : `${slug} failed`;
    throw new Error(error);
  }
  if (result && typeof result === 'object' && 'data' in result) {
    return parseToolData((result as { data: unknown }).data);
  }
  return parseToolData(result);
}

export function parseToolData(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}
