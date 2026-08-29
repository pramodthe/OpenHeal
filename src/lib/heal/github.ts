import { GitHubMCPClient } from '../github-mcp/client.ts';
import { generatePRBody, generatePRTitle } from '../github-mcp/pr-generator.ts';
import type { SessionState, PullRequestResult } from '../trueforge/types.ts';

export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
}

const PLACEHOLDER_REPOS = new Set(['my-org/backend-service', 'org/repo', 'example/repo']);

export function parseGitHubRepo(repoUrl?: string): ParsedGitHubRepo | null {
  if (!repoUrl) return null;
  const trimmed = repoUrl.trim();

  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/([^\s]+?)(?:\.git)?$/i);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2].replace(/\.git$/i, '') };
  }

  try {
    const url = new URL(trimmed);
    if (!url.hostname.replace(/^www\./, '').endsWith('github.com')) return null;
    const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
  } catch {
    const fallback = trimmed.match(/github\.com[/:]([^/]+)\/([^/\s]+)/i);
    if (!fallback) return null;
    return { owner: fallback[1], repo: fallback[2].replace(/\.git$/i, '') };
  }
}

export function isPlaceholderRepo(repoUrl?: string): boolean {
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) return true;
  return PLACEHOLDER_REPOS.has(`${parsed.owner}/${parsed.repo}`.toLowerCase());
}

export function authenticatedCloneUrl(repoUrl: string, token?: string): string {
  if (!token) return repoUrl;
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) return repoUrl;
  return `https://x-access-token:${token}@github.com/${parsed.owner}/${parsed.repo}.git`;
}

export async function createPullRequestFromSession(
  session: SessionState,
  options: { approver?: string; resumeToken?: string } = {}
): Promise<{ result: PullRequestResult; mocked: boolean; warning?: string }> {
  const config = session.config as SessionState['config'] & {
    githubToken?: string;
    githubOwner?: string;
    githubRepo?: string;
  };

  const parsed = parseGitHubRepo(config.repoUrl);
  const owner = config.githubOwner || parsed?.owner || 'openheal';
  const repo = config.githubRepo || parsed?.repo || 'target-repo';
  const token = typeof config.githubToken === 'string' ? config.githubToken : undefined;
  const composioUserId =
    typeof config.composioUserId === 'string' ? config.composioUserId : undefined;
  const activePatch = session.activePatch;
  const branch =
    `openheal/fix-${session.config.sessionId.slice(0, 8)}`.replace(/[^a-zA-Z0-9._/-]/g, '-');
  const diagnostic = session.diagnosticReport;
  const scorecard = session.qodoScorecard;
  const filesChanged = activePatch?.patches.map((p) => p.filePath) || [];
  const title = generatePRTitle({
    type: 'fix',
    scope: diagnostic?.frameworkDetected || session.config.language || 'core',
    description: `resolve ${diagnostic?.failureType || 'failing tests'}`,
  });
  const body = generatePRBody({
    owner,
    repo,
    filePath: diagnostic?.primaryRootCauseLocation.filePath || filesChanged[0] || 'unknown',
    lineNumber: diagnostic?.primaryRootCauseLocation.startLine,
    errorMessage: diagnostic?.primaryFailureMessage,
    rootCauseExplanation: diagnostic?.hypotheses?.[0]?.title || diagnostic?.primaryFailureMessage,
    astNodeType: diagnostic?.primaryRootCauseLocation.nodeType,
    scorecard: scorecard || {
      overallScore: 0,
      qualityScore: 0,
      securityScore: 0,
      coverageScore: 0,
      performanceScore: 0,
      grade: 'F',
      verdict: 'REQUIRES_MANUAL_REVIEW',
      breakdown: { ruleViolations: [], securityRisks: [], complexityIndex: 0, synthesizedTests: 0 },
      passed: false,
      summary: 'Scorecard unavailable',
      markdownSummary: 'Scorecard unavailable',
    },
    baselineExitCode: 1,
    baselineErrorLogSnippet: (session.baselineLog || '').slice(0, 1200),
    verificationLogSnippet: (session.latestVerification?.stdoutExcerpt || 'All tests passed.').slice(0, 1200),
    generatedTestCode: filesChanged.join('\n'),
    language: session.config.language || 'python',
    approverName: options.approver || 'Mission Control operator',
    resumeToken: options.resumeToken || session.hitlApproval?.resumeToken,
    diff: activePatch?.combinedUnifiedDiff || '',
    branch,
    filesChanged,
    durationMs: Date.now() - new Date(session.createdAt).getTime(),
  });

  const files = (activePatch?.patches || []).map((p) => ({
    path: p.filePath,
    content: p.patchedContent,
  }));

  if (composioUserId && process.env.COMPOSIO_API_KEY?.trim()) {
    try {
      const { createPullRequestViaComposio } = await import('../composio/github-pr.ts');
      const pr = await createPullRequestViaComposio({
        userId: composioUserId,
        owner,
        repo,
        branch,
        baseBranch: config.targetBranch || 'main',
        title,
        body,
        files,
      });
      return {
        mocked: false,
        result: {
          prNumber: pr.prNumber,
          prUrl: pr.prUrl,
          branchName: branch,
          title,
          body,
        },
      };
    } catch (err: unknown) {
      const warning = err instanceof Error ? err.message : String(err);
      if (!token) {
        const mock = await createMockPullRequest(owner, repo, branch, title, body);
        return { ...mock, warning: `Composio GitHub PR failed (${warning}). Emitted a demo PR URL instead.` };
      }
    }
  }

  if (token) {
    try {
      const mcpPr = await createPullRequestViaGithubMcp({
        token,
        owner,
        repo,
        branch,
        base: config.targetBranch || 'main',
        title,
        body,
        files,
      });
      return {
        mocked: false,
        result: {
          prNumber: mcpPr.prNumber,
          prUrl: mcpPr.prUrl,
          branchName: branch,
          title,
          body,
        },
      };
    } catch (mcpErr) {
      console.warn('[github] MCP server-github failed, using REST', mcpErr);
    }

    try {
      const client = new GitHubMCPClient({ token, mode: 'rest' });
      await client.createBranch({
        owner,
        repo,
        branch,
        from_branch: config.targetBranch || 'main',
      });
      if (files.length > 0) {
        await client.commitFiles(owner, repo, branch, files, title);
      }
      const pr = await client.createPullRequest({
        owner,
        repo,
        title,
        head: branch,
        base: config.targetBranch || 'main',
        body,
      });
      return {
        mocked: false,
        result: {
          prNumber: pr.number,
          prUrl: pr.html_url,
          branchName: branch,
          title,
          body,
        },
      };
    } catch (err: unknown) {
      const warning = err instanceof Error ? err.message : String(err);
      const mock = await createMockPullRequest(owner, repo, branch, title, body);
      return { ...mock, warning: `GitHub API failed (${warning}). Emitted a demo PR URL instead.` };
    }
  }

  const mock = await createMockPullRequest(owner, repo, branch, title, body);
  return {
    ...mock,
    warning:
      'GitHub is not connected. Click Connect GitHub (Composio OAuth) or set GITHUB_TOKEN. Emitted a demo PR URL instead.',
  };
}

async function createMockPullRequest(
  owner: string,
  repo: string,
  branch: string,
  title: string,
  body: string
): Promise<{ result: PullRequestResult; mocked: boolean }> {
  const client = new GitHubMCPClient({ mode: 'mock' });
  const pr = await client.createPullRequest({
    owner,
    repo,
    title,
    head: branch,
    base: 'main',
    body,
  });
  return {
    mocked: true,
    result: {
      prNumber: pr.number,
      prUrl: pr.html_url,
      branchName: branch,
      title,
      body,
    },
  };
}

async function createPullRequestViaGithubMcp(input: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  base: string;
  title: string;
  body: string;
  files: Array<{ path: string; content: string }>;
}): Promise<{ prNumber: number; prUrl: string }> {
  const { callGithubMcpTool } = await import('../github-mcp/mcp-stdio.ts');
  await callGithubMcpTool(input.token, 'create_branch', {
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    from_branch: input.base,
  });
  if (input.files.length > 0) {
    await callGithubMcpTool(input.token, 'push_files', {
      owner: input.owner,
      repo: input.repo,
      branch: input.branch,
      files: input.files,
      message: input.title,
    });
  }
  const created = await callGithubMcpTool(input.token, 'create_pull_request', {
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    body: input.body,
    head: input.branch,
    base: input.base,
  });
  const parsed = parseMcpPayload(created);
  return {
    prNumber: Number(parsed.number || parsed.prNumber || 1),
    prUrl:
      (typeof parsed.html_url === 'string' && parsed.html_url) ||
      (typeof parsed.url === 'string' && parsed.url) ||
      `https://github.com/${input.owner}/${input.repo}/pull/${parsed.number || 'new'}`,
  };
}

function parseMcpPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: string }).text || '') : ''))
      .join('\n');
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object') return json as Record<string, unknown>;
    } catch {
      return { body: text };
    }
  }
  return record;
}
