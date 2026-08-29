/**
 * Explorer subagent — browser-style exploration via curl + optional Playwright script.
 */
import type { ISandboxInstance } from '../../daytona/types.ts';
import { eventBus } from '../event-bus.ts';
import type { SwarmFinding } from '../../store/runs-store.ts';
import { randomUUID } from 'node:crypto';

export interface ExplorerInput {
  appUrl: string;
  changedFiles?: string[];
  routes?: string[];
}

export class ExplorerSubagent {
  public async explore(
    sessionId: string,
    threadId: string,
    sandbox: ISandboxInstance,
    input: ExplorerInput
  ): Promise<SwarmFinding[]> {
    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'explorer',
      status: 'running',
      message: 'Explorer: exercising user flows affected by the PR...',
    });

    const routes = input.routes?.length
      ? input.routes
      : inferRoutes(input.changedFiles || [], input.appUrl);
    const findings: SwarmFinding[] = [];

    for (const route of routes) {
      const url = `${input.appUrl.replace(/\/$/, '')}${route.startsWith('/') ? route : `/${route}`}`;
      eventBus.emitDelta(sessionId, threadId, 'agent.thought.delta', {
        delta: `Probing ${url}...\n`,
      });
      const probe = await sandbox.executeCommand(`curl -sS -o /tmp/openheal_body.html -w "%{http_code}" "${url}"`, {
        timeoutMs: 30000,
      });
      const status = (probe.stdout || '').trim();
      const body = await sandbox.executeCommand('head -c 2000 /tmp/openheal_body.html 2>/dev/null || true', {});
      const snippet = (body.stdout || '').slice(0, 500);

      if (status.startsWith('5') || status === '000' || /error|exception|failed/i.test(snippet)) {
        const finding: SwarmFinding = {
          id: randomUUID().slice(0, 8),
          severity: status.startsWith('5') ? 'high' : 'medium',
          title: `Route ${route} returned HTTP ${status || 'error'}`,
          reproSteps: [`Navigate to ${url}`, `Observe HTTP ${status || 'connection failure'}`],
          source: 'explorer',
        };
        findings.push(finding);
        eventBus.emitEvent(sessionId, threadId, 'explorer.finding', finding);
      }

      if (/broken-submit|data-bug|openheal-bug/i.test(snippet)) {
        const finding: SwarmFinding = {
          id: randomUUID().slice(0, 8),
          severity: 'high',
          title: `Behavioral marker detected on ${route}`,
          reproSteps: [`Open ${url}`, 'Interact with primary action', 'Expected success state missing'],
          source: 'explorer',
        };
        findings.push(finding);
        eventBus.emitEvent(sessionId, threadId, 'explorer.finding', finding);
      }
    }

    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'explorer',
      status: 'completed',
      message: `Explorer finished with ${findings.length} finding(s)`,
    });
    return findings;
  }
}

function inferRoutes(changedFiles: string[], appUrl: string): string[] {
  const routes = new Set<string>(['/']);
  for (const file of changedFiles) {
    if (file.includes('tasks') || file.includes('todo')) routes.add('/tasks');
    if (file.includes('api')) routes.add('/api/health');
    if (file.includes('page.tsx') || file.includes('page.jsx')) {
      const m = file.match(/app\/(.+)\/page\.(tsx|jsx|ts|js)/);
      if (m) routes.add(`/${m[1]}`);
    }
  }
  if (routes.size === 1 && appUrl) routes.add('/tasks');
  return [...routes];
}

export const explorerSubagent = new ExplorerSubagent();
