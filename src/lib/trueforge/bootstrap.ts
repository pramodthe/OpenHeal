/**
 * TrueForge preflight.
 *
 * The harness only drives the agents if the server is reachable, the model name
 * resolves against its live catalog, and the connectors the agent needs are
 * registered. Each of those used to fail silently and drop OpenHeal onto its
 * local fallback, so every check here reports loudly instead.
 */
import { getTrueForgeBaseUrl } from './sdk-client.ts';

export interface BootstrapReport {
  baseUrl: string;
  reachable: boolean;
  model?: string;
  requestedModel?: string;
  modelRewritten: boolean;
  availableModels: string[];
  sandboxProvider?: 'daytona' | 'local-fallback';
  mcpServers: string[];
  warnings: string[];
}

async function tfFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getTrueForgeBaseUrl().replace(/\/$/, '');
  const token = process.env.TRUEFORGE_TOKEN?.trim();
  const isLocal = /localhost|127\.0\.0\.1/.test(base);
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token && !isLocal ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(15000),
  });
}

export async function listTrueForgeModels(): Promise<string[]> {
  const res = await tfFetch('/api/v1/models');
  if (!res.ok) throw new Error(`TrueForge /models returned ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ name?: string }> };
  return (body.data || []).map((m) => m.name).filter((n): n is string => Boolean(n));
}

/**
 * The catalog spells versions with dashes (`openai/gpt-5-6-luna`) while .env and
 * the docs use dots (`openai/gpt-5.6-luna`). An unresolved name is a hard 400
 * from sessions.create, so normalize before giving up.
 */
export function normalizeModelName(name: string): string {
  return name.trim().toLowerCase().replace(/\./g, '-');
}

export function resolveModelAgainstCatalog(requested: string, catalog: string[]): string | undefined {
  if (catalog.includes(requested)) return requested;
  const wanted = normalizeModelName(requested);
  return catalog.find((candidate) => normalizeModelName(candidate) === wanted);
}

export async function ensureDaytonaSandboxProvider(apiKey?: string): Promise<'daytona' | 'local-fallback'> {
  const key = apiKey?.trim() || process.env.DAYTONA_API_KEY?.trim();
  if (!key) return 'local-fallback';

  const existing = await tfFetch('/api/v1/settings/sandbox-providers').catch(() => null);
  if (existing?.ok) return 'daytona';

  const res = await tfFetch('/api/v1/settings/sandbox-providers', {
    method: 'PUT',
    body: JSON.stringify({
      manifest: {
        type: 'daytona',
        auth: { api_key: key },
        exec_timeout_ms: 180000,
        auto_stop_interval_in_minutes: 5,
        auto_archive_interval_in_minutes: 60,
        auto_delete_interval_in_minutes: 7200,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Daytona sandbox provider registration failed (${res.status}): ${await res.text()}`);
  }
  return 'daytona';
}

export async function listRegisteredMcpServers(): Promise<string[]> {
  const res = await tfFetch('/api/v1/settings/mcp-servers');
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: Array<{ name?: string; manifest?: { name?: string } }> };
  return (body.data || [])
    .map((item) => item.name || item.manifest?.name)
    .filter((n): n is string => Boolean(n));
}

/**
 * TrueForge only accepts `remote` MCP servers (an HTTPS URL), so stdio servers
 * such as @modelcontextprotocol/server-github cannot be attached directly —
 * Composio's hosted MCP URL is what makes GitHub reachable from the harness.
 */
export async function registerRemoteMcpServer(input: {
  name: string;
  url: string;
  description: string;
  headers?: Record<string, string>;
}): Promise<void> {
  const manifest: Record<string, unknown> = {
    type: 'remote',
    name: input.name,
    url: input.url,
    description: input.description,
  };
  if (input.headers && Object.keys(input.headers).length > 0) {
    manifest.auth = { type: 'header', headers: input.headers };
  }

  const existing = await listRegisteredMcpServers();
  const method = existing.includes(input.name) ? 'PUT' : 'POST';
  const res = await tfFetch('/api/v1/settings/mcp-servers', {
    method,
    body: JSON.stringify({ manifest }),
  });
  if (!res.ok) {
    throw new Error(`MCP server "${input.name}" registration failed (${res.status}): ${await res.text()}`);
  }
}

export async function bootstrapTrueForge(input: {
  requestedModel?: string;
  daytonaKey?: string;
} = {}): Promise<BootstrapReport> {
  const baseUrl = getTrueForgeBaseUrl();
  const warnings: string[] = [];
  const report: BootstrapReport = {
    baseUrl,
    reachable: false,
    modelRewritten: false,
    availableModels: [],
    mcpServers: [],
    warnings,
  };

  let catalog: string[];
  try {
    catalog = await listTrueForgeModels();
  } catch (err) {
    report.warnings.push(
      `TrueForge is not reachable at ${baseUrl} (${err instanceof Error ? err.message : String(err)}). ` +
        'Start it with: npm run trueforge'
    );
    return report;
  }

  report.reachable = true;
  report.availableModels = catalog;

  const requested = input.requestedModel?.trim() || process.env.TRUEFORGE_MODEL?.trim() || '';
  report.requestedModel = requested || undefined;
  if (requested) {
    const resolved = resolveModelAgainstCatalog(requested, catalog);
    if (resolved) {
      report.model = resolved;
      report.modelRewritten = resolved !== requested;
    } else {
      warnings.push(
        `Model "${requested}" is not in the TrueForge catalog. Available: ${catalog.join(', ')}`
      );
    }
  }
  if (!report.model) report.model = catalog[0];

  try {
    report.sandboxProvider = await ensureDaytonaSandboxProvider(input.daytonaKey);
  } catch (err) {
    report.sandboxProvider = 'local-fallback';
    warnings.push(err instanceof Error ? err.message : String(err));
  }

  report.mcpServers = await listRegisteredMcpServers().catch(() => []);
  return report;
}
