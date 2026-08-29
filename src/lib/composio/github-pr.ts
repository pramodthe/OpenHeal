import { executeGithubTool, parseToolData } from './client.ts';

export interface ComposioPullRequestInput {
  userId: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  files: Array<{ path: string; content: string }>;
}

export interface ComposioPullRequestResult {
  prNumber: number;
  prUrl: string;
}

export async function createPullRequestViaComposio(
  input: ComposioPullRequestInput
): Promise<ComposioPullRequestResult> {
  const sha = await resolveBranchSha(input);
  try {
    await executeGithubTool('GITHUB_CREATE_A_REFERENCE', input.userId, {
      owner: input.owner,
      repo: input.repo,
      ref: `refs/heads/${input.branch}`,
      sha,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(message)) throw err;
  }

  for (const file of input.files) {
    await executeGithubTool('GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS', input.userId, {
      owner: input.owner,
      repo: input.repo,
      path: file.path.replace(/^\//, ''),
      content: file.content,
      message: input.title,
      branch: input.branch,
    });
  }

  const created = await executeGithubTool('GITHUB_CREATE_A_PULL_REQUEST', input.userId, {
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    body: input.body,
    head: input.branch,
    base: input.baseBranch,
  });

  const parsed = asRecord(created);
  const nested = asRecord(parsed.data) || parsed;
  const prNumber = Number(nested.number ?? nested.prNumber ?? 0);
  const prUrl =
    (typeof nested.html_url === 'string' && nested.html_url) ||
    (typeof nested.url === 'string' && nested.url) ||
    `https://github.com/${input.owner}/${input.repo}/pull/${prNumber || 'new'}`;

  return { prNumber: prNumber || 1, prUrl };
}

async function resolveBranchSha(input: ComposioPullRequestInput): Promise<string> {
  try {
    const repo = await executeGithubTool('GITHUB_GET_A_REPOSITORY', input.userId, {
      owner: input.owner,
      repo: input.repo,
    });
    const defaultBranch =
      typeof asRecord(repo)?.default_branch === 'string'
        ? String(asRecord(repo)?.default_branch)
        : input.baseBranch;
    const ref = await executeGithubTool('GITHUB_GET_A_REFERENCE', input.userId, {
      owner: input.owner,
      repo: input.repo,
      ref: `heads/${defaultBranch}`,
    });
    const sha = extractSha(ref);
    if (sha) return sha;
  } catch {
    // Fall through to the configured base branch.
  }

  const fallback = await executeGithubTool('GITHUB_GET_A_REFERENCE', input.userId, {
    owner: input.owner,
    repo: input.repo,
    ref: `heads/${input.baseBranch}`,
  });
  const sha = extractSha(fallback);
  if (!sha) throw new Error(`Could not resolve SHA for ${input.owner}/${input.repo}@${input.baseBranch}`);
  return sha;
}

function extractSha(data: unknown): string | undefined {
  const parsed = asRecord(parseToolData(data));
  if (!parsed) return undefined;
  if (typeof parsed.sha === 'string') return parsed.sha;
  const object = asRecord(parsed.object);
  if (typeof object?.sha === 'string') return object.sha;
  const nested = asRecord(parsed.data);
  if (nested) return extractSha(nested);
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
