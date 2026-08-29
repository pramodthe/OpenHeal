export interface HealLaunchCredentials {
  openaiKey?: string;
  githubToken?: string;
  daytonaKey?: string;
  model?: string;
  composioUserId?: string;
}

export interface ResolvedHealCredentials {
  openaiKey?: string;
  githubToken?: string;
  daytonaKey?: string;
  model: string;
  llmProvider: 'openai' | 'anthropic' | 'gemini' | 'openrouter';
  composioUserId?: string;
}

export function resolveCredentials(input: HealLaunchCredentials = {}): ResolvedHealCredentials {
  const openaiKey =
    trimKey(input.openaiKey) ||
    trimKey(process.env.OPENAI_API_KEY) ||
    trimKey(process.env.ANTHROPIC_API_KEY) ||
    trimKey(process.env.GEMINI_API_KEY) ||
    trimKey(process.env.OPENROUTER_API_KEY);

  const githubToken =
    trimKey(input.githubToken) ||
    trimKey(process.env.GITHUB_TOKEN) ||
    trimKey(process.env.GITHUB_PERSONAL_ACCESS_TOKEN);

  const daytonaKey = trimKey(input.daytonaKey) || trimKey(process.env.DAYTONA_API_KEY);
  const model = trimKey(input.model) || process.env.OPENHEAL_LLM_MODEL || 'gpt-5.6-luna';

  return {
    openaiKey,
    githubToken,
    daytonaKey,
    model,
    llmProvider: inferProvider(model, openaiKey),
    composioUserId: trimKey(input.composioUserId),
  };
}

function trimKey(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function inferProvider(
  model: string,
  apiKey?: string
): 'openai' | 'anthropic' | 'gemini' | 'openrouter' {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (lower.includes('gemini') || process.env.GEMINI_API_KEY) return 'gemini';
  if (apiKey?.startsWith('sk-or-') || process.env.OPENROUTER_API_KEY) return 'openrouter';
  return 'openai';
}
