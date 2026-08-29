/**
 * PR-triggered agent swarm review pipeline.
 */
import { DaytonaClient } from '../daytona/client.ts';
import type { ISandboxInstance } from '../daytona/types.ts';
import { eventBus } from '../trueforge/event-bus.ts';
import { sessionManager } from '../trueforge/session.ts';
import { harness } from '../trueforge/harness.ts';
import { runReviewOnHarness } from '../trueforge/heal-agent.ts';
import { resolveCredentials } from '../heal/credentials.ts';
import { authenticatedCloneUrl, parseGitHubRepo } from '../heal/github.ts';
import { registerSessionSandbox } from '../heal/sandbox-registry.ts';
import { buildOpsSubagent } from '../trueforge/swarm/buildops.ts';
import { explorerSubagent } from '../trueforge/swarm/explorer.ts';
import { diagnosticSubagent } from '../trueforge/swarm/diagnostic.ts';
import { reporterSubagent } from '../trueforge/swarm/reporter.ts';
import { postPrReviewComment } from '../composio/pr-comment.ts';
import { upsertRun, appendFinding, updateSubagent } from '../store/runs-store.ts';
import { getEnrolledRepo } from '../store/enrolled-repos.ts';
import type { SwarmFinding } from '../store/runs-store.ts';
import { executeGithubTool } from '../composio/client.ts';
import { resolveBundledScenarioDir } from '../heal/scenarios.ts';

export interface ReviewSwarmInput {
  sessionId?: string;
  repoUrl: string;
  repoFullName?: string;
  scenarioId?: string;
  prNumber?: number;
  prUrl?: string;
  headBranch?: string;
  headSha?: string;
  composioUserId?: string;
  triggerPrompt?: string;
  autoFix?: boolean;
}

const SUBAGENTS = ['orchestrator', 'buildops', 'explorer', 'diagnostic', 'reporter'] as const;

export async function startReviewSwarm(input: ReviewSwarmInput) {
  const sessionId = input.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const repoUrl = input.repoUrl;
  const parsed = parseGitHubRepo(repoUrl);
  const repoFullName = input.repoFullName || (parsed ? `${parsed.owner}/${parsed.repo}` : repoUrl);
  const creds = resolveCredentials({});
  const enrolled = input.composioUserId
    ? await getEnrolledRepo(repoFullName, input.composioUserId)
    : undefined;
  const autoFix = input.autoFix ?? enrolled?.autoFix ?? false;

  await upsertRun({
    sessionId,
    mode: 'review',
    status: 'running',
    repoFullName,
    repoUrl,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    headBranch: input.headBranch,
    headSha: input.headSha,
    triggerKind: 'prOpened',
    composioUserId: input.composioUserId,
    subagents: SUBAGENTS.map((id) => ({ id, label: id, status: id === 'orchestrator' ? 'running' : 'pending' })),
  });

  await harness.startSession(
    {
      sessionId,
      repoUrl,
      autoApprovePR: false,
      targetBranch: input.headBranch || 'main',
      githubOwner: parsed?.owner,
      githubRepo: parsed?.repo,
      composioUserId: input.composioUserId,
      triggerKind: 'prOpened',
      prNumber: input.prNumber,
      autoFix,
    },
    { deferLoop: true }
  );

  const threadId = sessionManager.createThread(sessionId, 'orchestrator');
  sessionManager.transitionStatus(sessionId, 'PROVISIONING_SANDBOX');

  try {
    eventBus.emitEvent(sessionId, threadId, 'session.started', { sessionId, repoUrl });

    // TrueForge owns its own sandbox for the review swarm — try it before local Daytona setup.
    const harnessRun = await runReviewOnHarness({
      sessionId,
      threadId,
      repoUrl,
      repoFullName,
      prNumber: input.prNumber,
      headBranch: input.headBranch,
      composioUserId: input.composioUserId,
      model: creds.model,
      daytonaKey: creds.daytonaKey,
      triggerPrompt: input.triggerPrompt,
      autoFix,
    });

    if (harnessRun.started) {
      return sessionManager.getRequiredSession(sessionId);
    }

    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'orchestrator',
      status: 'running',
      message: `TrueForge did not take the run (${harnessRun.reason}). Falling back to the local review swarm.`,
    });

    const sandbox = await provisionSandbox(creds.daytonaKey, input.scenarioId || 'demo-web-app');
    registerSessionSandbox(sessionId, sandbox);

    const bundledDir = resolveBundledScenarioDir(input.scenarioId || 'demo-web-app');
    const cloneTarget = bundledDir || authenticatedCloneUrl(repoUrl, creds.githubToken);
    await sandbox.cloneRepository(cloneTarget, input.headBranch);
    if (input.headBranch) {
      await sandbox.executeCommand(`git checkout ${input.headBranch}`, {
        cwd: `${sandbox.workspaceDir}/repo`,
      });
    }

    await runLocalReviewSwarm({
      sessionId,
      threadId,
      sandbox,
      repoFullName,
      repoUrl,
      prNumber: input.prNumber,
      composioUserId: input.composioUserId,
      headBranch: input.headBranch,
      autoFix,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sessionManager.transitionStatus(sessionId, 'FAILED', message);
    eventBus.emitEvent(sessionId, threadId, 'session.error', { error: message });
    eventBus.emitEvent(sessionId, threadId, 'session.completed', { sessionId, status: 'FAILED' });
    await upsertRun({ sessionId, status: 'failed', errorMessage: message });
    throw err;
  }

  return sessionManager.getRequiredSession(sessionId);
}

async function runLocalReviewSwarm(ctx: {
  sessionId: string;
  threadId: string;
  sandbox: ISandboxInstance;
  repoFullName: string;
  repoUrl: string;
  prNumber?: number;
  composioUserId?: string;
  headBranch?: string;
  autoFix: boolean;
}) {
  const { sessionId, threadId, sandbox } = ctx;
  let changedFiles: string[] = [];

  if (ctx.composioUserId && ctx.prNumber && ctx.repoFullName.includes('/')) {
    const [owner, repo] = ctx.repoFullName.split('/');
    try {
      const diff = await executeGithubTool('GITHUB_GET_CODE_CHANGES_IN_PULL_REQUEST', ctx.composioUserId, {
        owner,
        repo,
        pull_number: ctx.prNumber,
      });
      changedFiles = extractChangedFiles(diff);
    } catch {
      changedFiles = [];
    }
  }

  await updateSubagent(sessionId, { id: 'buildops', label: 'BuildOps', status: 'running', startedAt: new Date().toISOString() });
  sessionManager.transitionStatus(sessionId, 'BUILDING');
  const build = await buildOpsSubagent.run(sessionId, sessionManager.createThread(sessionId, 'buildops'), sandbox, {
    branch: ctx.headBranch,
  });
  await updateSubagent(sessionId, { id: 'buildops', label: 'BuildOps', status: 'completed', endedAt: new Date().toISOString() });

  await updateSubagent(sessionId, { id: 'explorer', label: 'Explorer', status: 'running', startedAt: new Date().toISOString() });
  sessionManager.transitionStatus(sessionId, 'EXPLORING');
  const explorerFindings = await explorerSubagent.explore(
    sessionId,
    sessionManager.createThread(sessionId, 'explorer'),
    sandbox,
    { appUrl: build.appUrl, changedFiles }
  );
  for (const f of explorerFindings) await appendFinding(sessionId, f);
  await updateSubagent(sessionId, { id: 'explorer', label: 'Explorer', status: 'completed', endedAt: new Date().toISOString() });

  await updateSubagent(sessionId, { id: 'diagnostic', label: 'Diagnostic', status: 'running', startedAt: new Date().toISOString() });
  sessionManager.transitionStatus(sessionId, 'DIAGNOSING');
  const diagThread = sessionManager.createThread(sessionId, 'diagnostic');
  const baselineLog = build.buildLog || explorerFindings.map((f) => f.title).join('\n');
  const diagnosticReport = await diagnosticSubagent.diagnose(sessionId, diagThread, baselineLog, undefined, ctx.repoUrl);
  eventBus.emitEvent(sessionId, diagThread, 'diagnostic.completed', diagnosticReport);

  const enriched: SwarmFinding[] = explorerFindings.map((f) => ({
    ...f,
    filePath: diagnosticReport.primaryRootCauseLocation?.filePath || f.filePath,
    line: diagnosticReport.primaryRootCauseLocation?.startLine || f.line,
    hypothesis: diagnosticReport.hypotheses?.[0]?.title || f.hypothesis,
    source: 'diagnostic' as const,
  }));
  await upsertRun({ sessionId, findings: enriched, findingsCount: enriched.length });
  await updateSubagent(sessionId, { id: 'diagnostic', label: 'Diagnostic', status: 'completed', endedAt: new Date().toISOString() });

  await updateSubagent(sessionId, { id: 'reporter', label: 'Reporter', status: 'running', startedAt: new Date().toISOString() });
  const { markdown } = await reporterSubagent.report(sessionId, sessionManager.createThread(sessionId, 'reporter'), {
    prNumber: ctx.prNumber,
    repoFullName: ctx.repoFullName,
    findings: enriched,
    buildStatus: 'passed',
    appUrl: build.appUrl,
  });
  await updateSubagent(sessionId, { id: 'reporter', label: 'Reporter', status: 'completed', endedAt: new Date().toISOString() });

  let prCommentUrl: string | undefined;
  if (ctx.composioUserId && ctx.prNumber && ctx.repoFullName.includes('/')) {
    const [owner, repo] = ctx.repoFullName.split('/');
    const posted = await postPrReviewComment({
      userId: ctx.composioUserId,
      owner,
      repo,
      issueNumber: ctx.prNumber,
      body: markdown,
    });
    prCommentUrl = posted.url;
    eventBus.emitEvent(sessionId, threadId, 'github.pr_comment', { url: prCommentUrl, prNumber: ctx.prNumber });
  }

  await upsertRun({
    sessionId,
    status: 'completed',
    prCommentUrl,
    findings: enriched,
    findingsCount: enriched.length,
  });

  if (ctx.autoFix && enriched.length > 0) {
    sessionManager.transitionStatus(sessionId, 'SYNTHESIZING');
    await harness.runAutonomousTurnLoop(sessionId, {
      sandbox: sandbox as never,
      baselineLog,
      testCommand: 'npm test',
    });
  } else {
    sessionManager.transitionStatus(sessionId, 'COMPLETED');
    eventBus.emitEvent(sessionId, threadId, 'session.completed', { sessionId, status: 'COMPLETED', prCommentUrl });
  }
}

function extractChangedFiles(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const files = record.files || record.changed_files;
  if (Array.isArray(files)) {
    return files
      .map((f) => (typeof f === 'string' ? f : f && typeof f === 'object' ? String((f as { filename?: string }).filename || '') : ''))
      .filter(Boolean);
  }
  return [];
}

async function provisionSandbox(apiKey?: string, scenarioId?: string): Promise<ISandboxInstance> {
  const bundledDir = resolveBundledScenarioDir(scenarioId || 'demo-web-app');
  const client = new DaytonaClient({ apiKey, mode: bundledDir || !apiKey ? 'mock' : 'auto' });
  await client.init();
  return client.createSandbox({ language: 'node', envVars: apiKey ? { DAYTONA_API_KEY: apiKey } : undefined });
}
