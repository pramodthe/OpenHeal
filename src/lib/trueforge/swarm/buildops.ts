/**
 * BuildOps subagent — clone PR branch, install, build, start dev server.
 */
import type { ISandboxInstance } from '../../daytona/types.ts';
import { eventBus } from '../event-bus.ts';

function repoDir(sandbox: ISandboxInstance): string {
  return `${sandbox.workspaceDir}/repo`;
}

export interface BuildOpsResult {
  appUrl: string;
  startCommand: string;
  buildLog: string;
  stack: 'next' | 'vite' | 'node' | 'generic';
}

export class BuildOpsSubagent {
  public async run(
    sessionId: string,
    threadId: string,
    sandbox: ISandboxInstance,
    options: { branch?: string; port?: number } = {}
  ): Promise<BuildOpsResult> {
    const port = options.port ?? 3000;
    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'buildops',
      status: 'running',
      message: 'BuildOps: detecting stack and preparing workspace...',
    });

    const detect = await sandbox.executeCommand(
      'test -f package.json && cat package.json | head -c 4000 || echo "{}"',
      { cwd: repoDir(sandbox) }
    );
    const pkg = detect.stdout || '';
    let stack: BuildOpsResult['stack'] = 'generic';
    let startCommand = `npm start -- -p ${port} || npx serve -l ${port} public`;

    const hasServerJs = await sandbox.executeCommand('test -f server.js && echo yes', {
      cwd: repoDir(sandbox),
    });
    if ((hasServerJs.stdout || '').includes('yes')) {
      stack = 'node';
      startCommand = `PORT=${port} node server.js & sleep 2`;
    } else if (/\"next\"/.test(pkg)) {
      stack = 'next';
      startCommand = `npm run build && npm run start -- -p ${port}`;
    } else if (/\"vite\"/.test(pkg)) {
      stack = 'vite';
      startCommand = `npm run build && npm run preview -- --port ${port}`;
    } else if (/\"express\"/.test(pkg)) {
      stack = 'node';
      startCommand = `PORT=${port} npm start`;
    }

    eventBus.emitDelta(sessionId, threadId, 'agent.thought.delta', {
      delta: `Detected ${stack} stack. Installing dependencies...\n`,
    });
    const install = await sandbox.installDependencies();
    const installLog = (install.combinedOutput || install.stdout || '').slice(0, 4000);

    eventBus.emitDelta(sessionId, threadId, 'agent.thought.delta', {
      delta: `Building and starting app on port ${port}...\n`,
    });
    const build = await sandbox.executeCommand(startCommand, {
      cwd: repoDir(sandbox),
      timeoutMs: 180000,
      env: { PORT: String(port), HOSTNAME: '0.0.0.0' },
    });
    const buildLog = `${installLog}\n${build.stdout || ''}\n${build.stderr || ''}`.trim();
    const appUrl = `http://127.0.0.1:${port}`;

    const result: BuildOpsResult = { appUrl, startCommand, buildLog, stack };
    eventBus.emitEvent(sessionId, threadId, 'buildops.completed', result);
    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'buildops',
      status: 'completed',
      message: `App ready at ${appUrl}`,
    });
    return result;
  }
}

export const buildOpsSubagent = new BuildOpsSubagent();
