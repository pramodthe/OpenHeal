import { DaytonaClient } from '../daytona/client.ts';
import type { ISandboxInstance, SupportedLanguage } from '../daytona/types.ts';
import { eventBus } from '../trueforge/event-bus.ts';
import { harness } from '../trueforge/harness.ts';
import { sessionManager } from '../trueforge/session.ts';
import { runHealOnHarness } from '../trueforge/heal-agent.ts';
import { resolveCredentials, type HealLaunchCredentials } from './credentials.ts';
import { authenticatedCloneUrl, isPlaceholderRepo, parseGitHubRepo } from './github.ts';
import { collectRepoFiles, overlayCustomCode } from './sandbox-files.ts';
import { defaultTestCommand, languageForScenario, resolveBundledScenarioDir, testCommandForScenario } from './scenarios.ts';
import { registerSessionSandbox } from './sandbox-registry.ts';

export interface HealStartInput extends HealLaunchCredentials {
  sessionId?: string;
  repoUrl?: string;
  language?: string;
  scenarioId?: string;
  testCommand?: string;
  customCode?: string;
  customFilePath?: string;
  autoApprovePR?: boolean;
  targetBranch?: string;
  /** Set when a GitHub event started this run; describes what to repair. */
  triggerPrompt?: string;
}

export async function startHealPipeline(input: HealStartInput) {
  const creds = resolveCredentials(input);
  const language = normalizeLanguage(input.language ?? languageForScenario(input.scenarioId));
  const sessionId = input.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const repoUrl = input.repoUrl || 'https://github.com/openheal-demo/python-calculator';
  const parsedRepo = parseGitHubRepo(repoUrl);
  const testCommand =
    input.testCommand?.trim() ||
    testCommandForScenario(input.scenarioId) ||
    defaultTestCommand(language, input.testCommand);

  await harness.startSession(
    {
      sessionId,
      repoUrl,
      language,
      autoApprovePR: Boolean(input.autoApprovePR),
      testCommandOverride: testCommand,
      targetBranch: input.targetBranch || 'main',
      githubToken: creds.githubToken,
      composioUserId: creds.composioUserId,
      githubOwner: parsedRepo?.owner,
      githubRepo: parsedRepo?.repo,
      llmApiKey: creds.openaiKey,
      llmModel: creds.model,
      llmProvider: creds.llmProvider,
    },
    { deferLoop: true }
  );

  const threadId = sessionManager.createThread(sessionId, 'orchestrator');
  sessionManager.transitionStatus(sessionId, 'PROVISIONING_SANDBOX');

  const emitLog = (text: string) => {
    eventBus.emitDelta(sessionId, threadId, 'sandbox.log.delta', { stream: 'stdout', text });
  };

  try {
    const bundledDir = resolveBundledScenarioDir(input.scenarioId);
    let harnessRun: { started: boolean; reason?: string } = { started: false };

    if (bundledDir) {
      // Bundled lab scenarios ship as local fixtures — the placeholder GitHub URLs
      // are not real repos, so TrueForge's remote sandbox cannot clone them.
      eventBus.emitEvent(sessionId, threadId, 'agent.status', {
        agent: 'orchestrator',
        status: 'running',
        message: `Bundled lab scenario "${input.scenarioId}" — using local workspace (${bundledDir}).`,
      });
    } else {
      // TrueForge owns its own sandbox — try the harness before provisioning a local one.
      harnessRun = await runHealOnHarness({
        sessionId,
        threadId,
        repoUrl,
        testCommand,
        composioUserId: creds.composioUserId,
        model: creds.model,
        daytonaKey: creds.daytonaKey,
        triggerPrompt: input.triggerPrompt,
      });

      if (harnessRun.started) {
        return sessionManager.getRequiredSession(sessionId);
      }

      eventBus.emitEvent(sessionId, threadId, 'agent.status', {
        agent: 'orchestrator',
        status: 'running',
        message: `TrueForge did not take the run (${harnessRun.reason}). Falling back to the local swarm.`,
      });
    }

    const sandbox = await provisionSandbox(language, creds.daytonaKey, input.scenarioId);
    registerSessionSandbox(sessionId, sandbox);

    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'orchestrator',
      status: 'running',
      message: creds.daytonaKey
        ? 'Provisioning Daytona sandbox via @daytona/sdk...'
        : 'No DAYTONA_API_KEY — using local isolated sandbox (set a key for a real Daytona workspace).',
    });

    const source = resolveSource(input, creds.githubToken);
    emitLog(`$ source: ${source.label}\n`);

    if (source.cloneTarget) {
      eventBus.emitEvent(sessionId, threadId, 'agent.status', {
        agent: 'orchestrator',
        status: 'running',
        message: `Loading workspace from ${source.label}`,
      });
      await sandbox.cloneRepository(source.cloneTarget);
      emitLog(`cloned into ${sandbox.workspaceDir}\n`);
    }

    if (input.customCode?.trim()) {
      const overlayPath = await overlayCustomCode(sandbox, language, input.customCode, input.customFilePath);
      emitLog(`overlayed custom source at ${overlayPath}\n`);
    }

    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'orchestrator',
      status: 'running',
      message: 'Installing dependencies...',
    });
    const install = await sandbox.installDependencies();
    emitLog((install.combinedOutput || install.stdout || install.stderr || '') + '\n');

    const repoFiles = await collectRepoFiles(sandbox);
    emitLog(`indexed ${repoFiles.size} source files for diagnostic analysis\n`);

    await harness.runAutonomousTurnLoop(sessionId, {
      sandbox: sandbox as never,
      repoFiles,
      testCommand,
      scenarioId: input.scenarioId,
      llmConfig: {
        apiKey: creds.openaiKey,
        provider: creds.llmProvider,
        model: creds.model,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sessionManager.transitionStatus(sessionId, 'FAILED', message);
    eventBus.emitEvent(sessionId, threadId, 'session.error', { error: message });
    eventBus.emitEvent(sessionId, threadId, 'session.completed', {
      sessionId,
      status: 'FAILED',
      durationMs: 0,
    });
    const { destroySessionSandbox } = await import('./sandbox-registry.ts');
    await destroySessionSandbox(sessionId);
    throw err;
  }

  return sessionManager.getRequiredSession(sessionId);
}

async function provisionSandbox(
  language: SupportedLanguage,
  apiKey?: string,
  scenarioId?: string
): Promise<ISandboxInstance> {
  const bundledDir = resolveBundledScenarioDir(scenarioId);
  const client = new DaytonaClient({
    apiKey,
    mode: bundledDir || !apiKey ? 'mock' : 'auto',
  });
  await client.init();
  return client.createSandbox({
    language,
    scenarioId,
    envVars: apiKey ? { DAYTONA_API_KEY: apiKey } : undefined,
  });
}

function resolveSource(input: HealStartInput, githubToken?: string): { cloneTarget?: string; label: string } {
  const bundledDir = resolveBundledScenarioDir(input.scenarioId);
  if (bundledDir) {
    return { cloneTarget: bundledDir, label: `bundled scenario ${input.scenarioId}` };
  }

  if (input.repoUrl && !isPlaceholderRepo(input.repoUrl)) {
    return {
      cloneTarget: authenticatedCloneUrl(input.repoUrl, githubToken),
      label: input.repoUrl,
    };
  }

  if (input.customCode?.trim()) {
    return { label: 'custom in-memory source overlay' };
  }

  const fallback = resolveBundledScenarioDir('python-calculator');
  return {
    cloneTarget: fallback || undefined,
    label: fallback ? 'bundled scenario python-calculator (fallback)' : 'empty workspace',
  };
}

function normalizeLanguage(language?: string): SupportedLanguage {
  switch (language) {
    case 'python':
    case 'node':
    case 'rust':
    case 'go':
      return language;
    default:
      return 'python';
  }
}
