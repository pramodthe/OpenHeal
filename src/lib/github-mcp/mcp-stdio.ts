import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let cached: { token: string; client: Client } | null = null;

export async function getGithubMcpClient(token: string): Promise<Client> {
  if (cached?.token === token) return cached.client;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
  env.GITHUB_TOKEN = token;

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env,
  });

  const client = new Client({ name: 'openheal', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  cached = { token, client };
  return client;
}

export async function callGithubMcpTool(
  token: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const client = await getGithubMcpClient(token);
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const text = Array.isArray(result.content)
      ? result.content.map((part) => ('text' in part ? part.text : '')).join('\n')
      : 'GitHub MCP tool failed';
    throw new Error(text || `GitHub MCP ${name} failed`);
  }
  return result;
}
