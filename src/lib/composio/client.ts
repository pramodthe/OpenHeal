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

export async function getGithubAuthConfigId(): Promise<string> {
  const fromEnv = process.env.COMPOSIO_GITHUB_AUTH_CONFIG_ID?.trim();
  if (fromEnv) return fromEnv;
  if (cachedAuthConfigId) return cachedAuthConfigId;

  const composio = getComposio();
  const listed = await composio.authConfigs.list({ toolkit: 'github' });
  const existing = listed.items.find((item) => item.status === 'ENABLED') || listed.items[0];
  if (existing?.id) {
    cachedAuthConfigId = existing.id;
    return existing.id;
  }

  const created = await composio.authConfigs.create('github', {
    type: AuthConfigTypes.COMPOSIO_MANAGED,
    name: 'OpenHeal GitHub',
    credentials: { scopes: 'repo' },
  });
  cachedAuthConfigId = created.id;
  return created.id;
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
