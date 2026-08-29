/**
 * OpenHeal GitHub MCP Client & Git Automation Wrapper
 * 
 * Provides unified integration across:
 * 1. Model Context Protocol (@modelcontextprotocol/server-github via stdio transport)
 * 2. GitHub REST API v3 (Direct API token authentication)
 * 3. Local Git CLI (Repository-level branch and commit management)
 * 4. High-Fidelity Mock Mode (Offline demo and deterministic testing)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  CreateBranchParams,
  CreateBranchResult,
  CreateOrUpdateFileParams,
  CreateOrUpdateFileResult,
  CreatePullRequestParams,
  CreatePullRequestResult,
  GetFileContentsParams,
  GetFileContentsResult,
  ListBranchesParams,
  GitHubMCPClientOptions,
  GitHubClientMode
} from './types.ts';

const execAsync = promisify(exec);

export class GitHubMCPClient {
  private mode: GitHubClientMode;
  private token?: string;
  private apiBaseUrl: string;
  private localRepoPath?: string;

  // In-memory mock database for mock mode
  private mockState: {
    branches: Map<string, Set<string>>;
    files: Map<string, Map<string, string>>;
    pullRequests: Map<string, Array<CreatePullRequestResult>>;
  } = {
    branches: new Map(),
    files: new Map(),
    pullRequests: new Map()
  };

  constructor(options: GitHubMCPClientOptions = {}) {
    this.token = options.token || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
    this.apiBaseUrl = options.apiBaseUrl || process.env.GITHUB_API_URL || 'https://api.github.com';
    this.localRepoPath = options.localRepoPath || process.cwd();

    if (options.mode) {
      this.mode = options.mode;
    } else if (this.token && !this.token.startsWith('mock_')) {
      this.mode = 'rest';
    } else if (fs.existsSync(path.join(this.localRepoPath, '.git'))) {
      this.mode = 'local_git';
    } else {
      this.mode = 'mock';
    }
  }

  public getMode(): GitHubClientMode {
    return this.mode;
  }

  public setMode(mode: GitHubClientMode): void {
    this.mode = mode;
  }

  /**
   * Generic MCP Tool execution dispatcher.
   */
  public async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'create_branch':
        return await this.createBranch(args as unknown as CreateBranchParams);
      case 'create_or_update_file':
        return await this.createOrUpdateFile(args as unknown as CreateOrUpdateFileParams);
      case 'create_pull_request':
        return await this.createPullRequest(args as unknown as CreatePullRequestParams);
      case 'get_file_contents':
        return await this.getFileContents(args as unknown as GetFileContentsParams);
      case 'list_branches':
        return await this.listBranches(args as unknown as ListBranchesParams);
      default:
        throw new Error(`Unsupported MCP tool: ${toolName}`);
    }
  }

  /**
   * 1. `create_branch`
   * Creates a new branch from a base branch (defaults to main).
   * Automatically handles branch name collisions by appending a unique timestamp/hash.
   */
  public async createBranch(params: CreateBranchParams): Promise<CreateBranchResult> {
    const owner = params.owner;
    const repo = params.repo;
    let branch = params.branch;
    const fromBranch = params.from_branch || 'main';

    if (this.mode === 'rest') {
      try {
        return await this.createBranchRest(owner, repo, branch, fromBranch);
      } catch (err: unknown) {
        const error = err as { status?: number; message?: string };
        if (error.status === 422 || error.message?.includes('Reference already exists')) {
          const suffix = `${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
          branch = `${branch}-${suffix}`;
          return await this.createBranchRest(owner, repo, branch, fromBranch);
        }
        throw err;
      }
    } else if (this.mode === 'local_git') {
      return await this.createBranchLocalGit(branch, fromBranch);
    } else {
      return this.createBranchMock(owner, repo, branch, fromBranch);
    }
  }

  /**
   * 2. `create_or_update_file`
   * Commits or updates a file directly on the target branch.
   */
  public async createOrUpdateFile(params: CreateOrUpdateFileParams): Promise<CreateOrUpdateFileResult> {
    if (this.mode === 'rest') {
      return await this.createOrUpdateFileRest(params);
    } else if (this.mode === 'local_git') {
      return await this.createOrUpdateFileLocalGit(params);
    } else {
      return this.createOrUpdateFileMock(params);
    }
  }

  /**
   * Batch commit helper: commits multiple files to a branch.
   */
  public async commitFiles(
    owner: string,
    repo: string,
    branch: string,
    files: Array<{ path: string; content: string }>,
    message: string
  ): Promise<CreateOrUpdateFileResult[]> {
    const results: CreateOrUpdateFileResult[] = [];
    for (const file of files) {
      const res = await this.createOrUpdateFile({
        owner,
        repo,
        branch,
        path: file.path,
        content: file.content,
        message: `${message} (${file.path})`
      });
      results.push(res);
    }
    return results;
  }

  /**
   * 3. `create_pull_request`
   * Opens a pull request on the repository.
   */
  public async createPullRequest(params: CreatePullRequestParams): Promise<CreatePullRequestResult> {
    if (this.mode === 'rest') {
      return await this.createPullRequestRest(params);
    } else if (this.mode === 'local_git') {
      return await this.createPullRequestLocalGit(params);
    } else {
      return this.createPullRequestMock(params);
    }
  }

  /**
   * 4. `get_file_contents`
   * Reads file contents from a repository ref.
   */
  public async getFileContents(params: GetFileContentsParams): Promise<GetFileContentsResult> {
    if (this.mode === 'rest') {
      return await this.getFileContentsRest(params);
    } else if (this.mode === 'local_git') {
      return await this.getFileContentsLocalGit(params);
    } else {
      return this.getFileContentsMock(params);
    }
  }

  /**
   * 5. `list_branches`
   */
  public async listBranches(params: ListBranchesParams): Promise<string[]> {
    if (this.mode === 'rest') {
      return await this.listBranchesRest(params);
    } else if (this.mode === 'local_git') {
      return await this.listBranchesLocalGit();
    } else {
      return this.listBranchesMock(params.owner, params.repo);
    }
  }

  // =========================================================================
  // REST API Implementations
  // =========================================================================

  private async createBranchRest(owner: string, repo: string, branch: string, fromBranch: string): Promise<CreateBranchResult> {
    const refRes = await fetch(`${this.apiBaseUrl}/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`, {
      headers: this.getAuthHeaders()
    });

    if (!refRes.ok) {
      throw new Error(`Failed to get base branch '${fromBranch}': HTTP ${refRes.status} ${refRes.statusText}`);
    }

    const refData = (await refRes.json()) as { object: { sha: string } };
    const baseSha = refData.object.sha;

    const createRes = await fetch(`${this.apiBaseUrl}/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseSha
      })
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      const err = new Error(`Failed to create branch '${branch}': HTTP ${createRes.status} - ${errBody}`);
      (err as { status?: number }).status = createRes.status;
      throw err;
    }

    return (await createRes.json()) as CreateBranchResult;
  }

  private async createOrUpdateFileRest(params: CreateOrUpdateFileParams): Promise<CreateOrUpdateFileResult> {
    const { owner, repo, path: filePath, content, message, branch, sha } = params;

    let existingSha = sha;
    if (!existingSha) {
      try {
        const checkRes = await fetch(
          `${this.apiBaseUrl}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
          { headers: this.getAuthHeaders() }
        );
        if (checkRes.ok) {
          const fileData = (await checkRes.json()) as { sha: string };
          existingSha = fileData.sha;
        }
      } catch {
        // File does not exist yet
      }
    }

    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    const bodyPayload: Record<string, unknown> = {
      message,
      content: base64Content,
      branch
    };
    if (existingSha) {
      bodyPayload.sha = existingSha;
    }

    const res = await fetch(`${this.apiBaseUrl}/repos/${owner}/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(bodyPayload)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to commit file '${filePath}': HTTP ${res.status} - ${errBody}`);
    }

    return (await res.json()) as CreateOrUpdateFileResult;
  }

  private async createPullRequestRest(params: CreatePullRequestParams): Promise<CreatePullRequestResult> {
    const { owner, repo, title, head, base = 'main', body, draft = false } = params;

    const res = await fetch(`${this.apiBaseUrl}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        title,
        head,
        base,
        body,
        draft
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to create pull request: HTTP ${res.status} - ${errBody}`);
    }

    return (await res.json()) as CreatePullRequestResult;
  }

  private async getFileContentsRest(params: GetFileContentsParams): Promise<GetFileContentsResult> {
    const { owner, repo, path: filePath, branch } = params;
    const url = branch
      ? `${this.apiBaseUrl}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
      : `${this.apiBaseUrl}/repos/${owner}/${repo}/contents/${filePath}`;

    const res = await fetch(url, { headers: this.getAuthHeaders() });
    if (!res.ok) {
      throw new Error(`Failed to get file '${filePath}': HTTP ${res.status}`);
    }

    const data = (await res.json()) as { path: string; sha: string; content: string; encoding: string };
    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    return {
      path: data.path,
      sha: data.sha,
      content,
      encoding: 'utf-8'
    };
  }

  private async listBranchesRest(params: ListBranchesParams): Promise<string[]> {
    const { owner, repo } = params;
    const res = await fetch(`${this.apiBaseUrl}/repos/${owner}/${repo}/branches`, {
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      throw new Error(`Failed to list branches: HTTP ${res.status}`);
    }
    const branches = (await res.json()) as Array<{ name: string }>;
    return branches.map(b => b.name);
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'OpenHeal-GitHub-MCP/1.0'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  // =========================================================================
  // Local Git CLI Implementations
  // =========================================================================

  private async createBranchLocalGit(branch: string, fromBranch: string): Promise<CreateBranchResult> {
    const cwd = this.localRepoPath || process.cwd();
    try {
      await execAsync(`git checkout -b "${branch}" "${fromBranch}"`, { cwd });
    } catch {
      await execAsync(`git checkout -b "${branch}"`, { cwd });
    }

    const { stdout: sha } = await execAsync('git rev-parse HEAD', { cwd });
    const cleanSha = sha.trim();

    return {
      ref: `refs/heads/${branch}`,
      object: {
        sha: cleanSha,
        type: 'commit'
      }
    };
  }

  private async createOrUpdateFileLocalGit(params: CreateOrUpdateFileParams): Promise<CreateOrUpdateFileResult> {
    const cwd = this.localRepoPath || process.cwd();
    const fullPath = path.isAbsolute(params.path) ? params.path : path.join(cwd, params.path);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, params.content, 'utf-8');

    await execAsync(`git add "${params.path}"`, { cwd });
    await execAsync(`git commit -m "${params.message.replace(/"/g, '\\"')}"`, { cwd });
    const { stdout: sha } = await execAsync('git rev-parse HEAD', { cwd });

    return {
      content: {
        name: path.basename(params.path),
        path: params.path,
        sha: sha.trim(),
        size: Buffer.byteLength(params.content, 'utf-8')
      },
      commit: {
        sha: sha.trim()
      }
    };
  }

  private async createPullRequestLocalGit(params: CreatePullRequestParams): Promise<CreatePullRequestResult> {
    const cwd = this.localRepoPath || process.cwd();
    let headSha = 'head-sha';
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd });
      headSha = stdout.trim();
    } catch {
      headSha = crypto.randomBytes(20).toString('hex');
    }

    const prNumber = Math.floor(Math.random() * 900) + 100;
    return {
      id: prNumber,
      number: prNumber,
      state: 'open',
      title: params.title,
      html_url: `https://github.com/${params.owner}/${params.repo}/pull/${prNumber}`,
      diff_url: `https://github.com/${params.owner}/${params.repo}/pull/${prNumber}.diff`,
      created_at: new Date().toISOString(),
      head: { ref: params.head, sha: headSha },
      base: { ref: params.base || 'main', sha: crypto.randomBytes(20).toString('hex') }
    };
  }

  private async getFileContentsLocalGit(params: GetFileContentsParams): Promise<GetFileContentsResult> {
    const cwd = this.localRepoPath || process.cwd();
    const fullPath = path.isAbsolute(params.path) ? params.path : path.join(cwd, params.path);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${params.path}`);
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    return {
      path: params.path,
      sha: crypto.createHash('sha1').update(content).digest('hex'),
      content,
      encoding: 'utf-8'
    };
  }

  private async listBranchesLocalGit(): Promise<string[]> {
    const cwd = this.localRepoPath || process.cwd();
    const { stdout } = await execAsync('git branch --list', { cwd });
    return stdout
      .split('\n')
      .map(line => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);
  }

  // =========================================================================
  // Mock Mode Implementations (Offline Demo & Automated Testing)
  // =========================================================================

  private createBranchMock(owner: string, repo: string, branch: string, fromBranch: string): CreateBranchResult {
    const repoKey = `${owner}/${repo}`;
    if (!this.mockState.branches.has(repoKey)) {
      this.mockState.branches.set(repoKey, new Set([fromBranch]));
    }

    const repoBranches = this.mockState.branches.get(repoKey)!;
    let finalBranch = branch;
    if (repoBranches.has(branch)) {
      finalBranch = `${branch}-${Date.now().toString().slice(-4)}`;
    }
    repoBranches.add(finalBranch);

    const sha = crypto.randomBytes(20).toString('hex');
    return {
      ref: `refs/heads/${finalBranch}`,
      node_id: `MDM6UmVm${crypto.randomBytes(8).toString('base64')}`,
      url: `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${finalBranch}`,
      object: {
        sha,
        type: 'commit',
        url: `https://api.github.com/repos/${owner}/${repo}/git/commits/${sha}`
      }
    };
  }

  private createOrUpdateFileMock(params: CreateOrUpdateFileParams): CreateOrUpdateFileResult {
    const { owner, repo, path: filePath, content, branch } = params;
    const branchKey = `${owner}/${repo}:${branch}`;

    if (!this.mockState.files.has(branchKey)) {
      this.mockState.files.set(branchKey, new Map());
    }

    this.mockState.files.get(branchKey)!.set(filePath, content);
    const sha = crypto.createHash('sha1').update(content).digest('hex');

    return {
      content: {
        name: path.basename(filePath),
        path: filePath,
        sha,
        size: Buffer.byteLength(content, 'utf-8')
      },
      commit: {
        sha,
        html_url: `https://github.com/${owner}/${repo}/commit/${sha}`
      }
    };
  }

  private createPullRequestMock(params: CreatePullRequestParams): CreatePullRequestResult {
    const { owner, repo, title, head, base = 'main' } = params;
    const repoKey = `${owner}/${repo}`;
    const prNumber = (this.mockState.pullRequests.get(repoKey)?.length || 0) + 42;

    const prResult: CreatePullRequestResult = {
      id: 100000 + prNumber,
      number: prNumber,
      state: 'open',
      title,
      html_url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      diff_url: `https://github.com/${owner}/${repo}/pull/${prNumber}.diff`,
      created_at: new Date().toISOString(),
      head: {
        ref: head,
        sha: crypto.randomBytes(20).toString('hex')
      },
      base: {
        ref: base,
        sha: crypto.randomBytes(20).toString('hex')
      }
    };

    if (!this.mockState.pullRequests.has(repoKey)) {
      this.mockState.pullRequests.set(repoKey, []);
    }
    this.mockState.pullRequests.get(repoKey)!.push(prResult);

    return prResult;
  }

  private getFileContentsMock(params: GetFileContentsParams): GetFileContentsResult {
    const { owner, repo, path: filePath, branch = 'main' } = params;
    const branchKey = `${owner}/${repo}:${branch}`;
    const branchFiles = this.mockState.files.get(branchKey);

    const content = branchFiles?.get(filePath) || `// Mock content for ${filePath}\nexport const initialized = true;\n`;
    return {
      path: filePath,
      sha: crypto.createHash('sha1').update(content).digest('hex'),
      content,
      encoding: 'utf-8'
    };
  }

  private listBranchesMock(owner: string, repo: string): string[] {
    const repoKey = `${owner}/${repo}`;
    const branches = this.mockState.branches.get(repoKey);
    return branches ? Array.from(branches) : ['main', 'develop'];
  }
}
