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
  const rawModel = trimKey(input.model) || process.env.OPENHEAL_LLM_MODEL || 'gpt-5.6-luna';
  const llmProvider = inferProvider(rawModel, openaiKey);
  const model = resolveModelForProvider(rawModel, llmProvider);

  return {
    openaiKey,
    githubToken,
    daytonaKey,
    model,
    llmProvider,
    composioUserId: trimKey(input.composioUserId),
  };
}

function trimKey(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function defaultModelForProvider(
  provider: ResolvedHealCredentials['llmProvider']
): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-5';
    case 'gemini':
      return 'gemini-1.5-pro';
    case 'openrouter':
      return 'gpt-4o';
    default:
      return 'gpt-5.6-luna';
  }
}

export function modelBelongsToProvider(
  model: string,
  provider: ResolvedHealCredentials['llmProvider']
): boolean {
  const lower = model.toLowerCase();
  if (provider === 'anthropic') return lower.includes('claude');
  if (provider === 'gemini') return lower.includes('gemini');
  if (provider === 'openrouter') return true;
  return (
    lower.includes('gpt') ||
    lower.includes('o1') ||
    lower.includes('luna') ||
    lower.includes('terra') ||
    lower.includes('sol')
  );
}

export function resolveModelForProvider(
  model: string,
  provider: ResolvedHealCredentials['llmProvider']
): string {
  return modelBelongsToProvider(model, provider) ? model : defaultModelForProvider(provider);
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
