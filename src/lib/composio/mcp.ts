/**
 * Composio-hosted GitHub MCP server.
 *
 * TrueForge only attaches `remote` MCP servers (an HTTPS URL), so the stdio
 * @modelcontextprotocol/server-github cannot be handed to the harness directly.
 * Composio hosts the same GitHub toolkit behind a URL, which is what lets the
 * agent call GitHub itself instead of OpenHeal calling it on the agent's behalf.
 */
import { getComposio, getGithubAuthConfigId } from './client.ts';

export const OPENHEAL_MCP_CONFIG_NAME = 'openheal-github';

/** Tools the healing agent is allowed to reach. Read for context, write for the PR. */
export const OPENHEAL_GITHUB_TOOLS = [
  'GITHUB_GET_A_REPOSITORY',
  'GITHUB_GET_A_REFERENCE',
  'GITHUB_CREATE_A_REFERENCE',
  'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS',
  'GITHUB_CREATE_A_PULL_REQUEST',
  'GITHUB_LIST_PULL_REQUESTS',
  'GITHUB_GET_AN_ISSUE',
  'GITHUB_CREATE_AN_ISSUE_COMMENT',
];

/** Writes that must pause at the human gate before the harness may run them. */
export const OPENHEAL_APPROVAL_TOOLS = [
  'GITHUB_CREATE_A_REFERENCE',
  'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS',
  'GITHUB_CREATE_A_PULL_REQUEST',
  'GITHUB_CREATE_AN_ISSUE_COMMENT',
];

interface McpLike {
  id?: string;
  name?: string;
}

async function findExistingConfig(): Promise<McpLike | undefined> {
  const composio = getComposio();
  const listed = await composio.mcp.list({
    name: OPENHEAL_MCP_CONFIG_NAME,
    toolkits: ['github'],
    authConfigs: [],
    page: 1,
    limit: 20,
  });
  const items = (listed as { items?: McpLike[] }).items || [];
  return items.find((item) => item.name === OPENHEAL_MCP_CONFIG_NAME) || items[0];
}

export async function ensureGithubMcpConfig(): Promise<string> {
  const fromEnv = process.env.COMPOSIO_MCP_CONFIG_ID?.trim();
  if (fromEnv) return fromEnv;

  const existing = await findExistingConfig().catch(() => undefined);
  if (existing?.id) return existing.id;

  const composio = getComposio();
  const authConfigId = await getGithubAuthConfigId();
  const created = await composio.mcp.create(OPENHEAL_MCP_CONFIG_NAME, {
    toolkits: [{ toolkit: 'github', authConfigId }],
    allowedTools: OPENHEAL_GITHUB_TOOLS,
    manuallyManageConnections: false,
  });
  const id = (created as { id?: string }).id;
  if (!id) throw new Error('Composio mcp.create returned no config id');
  return id;
}

/**
 * Mint the per-user MCP URL. The URL is scoped to the Composio user, so the
 * agent acts as whoever clicked "Connect GitHub" — never a shared PAT.
 */
export async function generateGithubMcpUrl(userId: string): Promise<string> {
  const configId = await ensureGithubMcpConfig();
  const instance = await getComposio().mcp.generate(userId, configId);
  const url = extractUrl(instance);
  if (!url) throw new Error('Composio mcp.generate returned no server URL');
  return canonicalizeMcpUrl(url);
}

/**
 * `mcp.generate` hands back a /v3.1/mcp/<id> URL that 307s to /v3/mcp/<id>/mcp.
 * TrueForge does not follow that redirect and reports the hop as a 401, so
 * resolve it here rather than registering a URL the harness cannot reach.
 */
export function canonicalizeMcpUrl(url: string): string {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/v3(?:\.\d+)?\/mcp\/([^/]+)\/?(?:mcp)?$/);
  if (match) parsed.pathname = `/v3/mcp/${match[1]}/mcp`;
  return parsed.toString();
}

/** Composio authenticates its hosted MCP endpoint with the project API key. */
export function composioMcpHeaders(): Record<string, string> {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) throw new Error('COMPOSIO_API_KEY is required to attach the GitHub MCP server.');
  return { 'x-api-key': key };
}

function extractUrl(instance: unknown): string | undefined {
  if (!instance || typeof instance !== 'object') return undefined;
  const record = instance as Record<string, unknown>;
  for (const key of ['url', 'mcpUrl', 'serverUrl']) {
    const value = record[key];
    if (typeof value === 'string' && value.startsWith('http')) return value;
    if (value instanceof URL) return value.toString();
  }
  return undefined;
}
