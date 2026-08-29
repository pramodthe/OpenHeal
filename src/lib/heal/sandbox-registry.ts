import type { ISandboxInstance } from '../daytona/types.ts';

const activeSandboxes = new Map<string, ISandboxInstance>();

export function registerSessionSandbox(sessionId: string, sandbox: ISandboxInstance): void {
  activeSandboxes.set(sessionId, sandbox);
}

export function getSessionSandbox(sessionId: string): ISandboxInstance | undefined {
  return activeSandboxes.get(sessionId);
}

export async function destroySessionSandbox(sessionId: string): Promise<void> {
  const sandbox = activeSandboxes.get(sessionId);
  if (!sandbox) return;
  activeSandboxes.delete(sessionId);
  try {
    await sandbox.destroy();
  } catch {
    // ignore teardown errors
  }
}
