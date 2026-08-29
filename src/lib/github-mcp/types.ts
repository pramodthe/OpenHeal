/**
 * OpenHeal GitHub MCP Tool Schemas and Types
 * 
 * Implements tool contracts for @modelcontextprotocol/server-github:
 * 1. `create_branch`
 * 2. `create_or_update_file`
 * 3. `create_pull_request`
 * 4. `get_file_contents`
 * 5. `list_branches`
 */

import type { QodoScorecardReport, QodoScorecardResult } from '../qodo/types.ts';

export interface CreateBranchParams {
  owner: string;
  repo: string;
  branch: string;
  from_branch?: string;
}

export interface CreateBranchResult {
  ref: string;
  node_id?: string;
  url?: string;
  object: {
    sha: string;
    type: string;
    url?: string;
  };
}

export interface CreateOrUpdateFileParams {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  branch: string;
  sha?: string;
}

export interface CreateOrUpdateFileResult {
  content: {
    name: string;
    path: string;
    sha: string;
    size: number;
  };
  commit: {
    sha: string;
    html_url?: string;
  };
}

export interface CreatePullRequestParams {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base?: string;
  body: string;
  draft?: boolean;
}

export interface CreatePullRequestResult {
  id: number;
  number: number;
  state: string;
  title: string;
  html_url: string;
  diff_url?: string;
  created_at: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
}

export interface GetFileContentsParams {
  owner: string;
  repo: string;
  path: string;
  branch?: string;
}

export interface GetFileContentsResult {
  path: string;
  sha: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

export interface ListBranchesParams {
  owner: string;
  repo: string;
}

export interface ListBranchesResult {
  branches: Array<{
    name: string;
    commit: {
      sha: string;
      url?: string;
    };
  }>;
}

export type GitHubClientMode = 'mcp' | 'rest' | 'local_git' | 'mock';

export interface GitHubMCPClientOptions {
  mode?: GitHubClientMode;
  token?: string;
  apiBaseUrl?: string;
  mcpServerCommand?: string;
  mcpServerArgs?: string[];
  localRepoPath?: string;
}

export interface PRGeneratorOptions {
  owner: string;
  repo: string;
  filePath: string;
  lineNumber?: number;
  errorMessage?: string;
  rootCauseExplanation?: string;
  astNodeType?: string;
  scorecard: QodoScorecardReport | QodoScorecardResult;
  baselineExitCode?: number;
  baselineErrorLogSnippet?: string;
  verificationLogSnippet?: string;
  generatedTestCode?: string;
  language?: string;
  approverName?: string;
  approvalTimestamp?: string;
  resumeToken?: string;
  diff?: string;
  branch?: string;
  filesChanged?: string[];
  durationMs?: number;
}

export interface PRTitleOptions {
  scope?: string;
  description: string;
  type?: 'fix' | 'feat' | 'refactor' | 'perf' | 'test';
}

export interface DiffStatistics {
  filesChanged: number;
  additions: number;
  deletions: number;
  fileList: string[];
}
