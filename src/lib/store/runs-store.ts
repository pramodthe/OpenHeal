import { readJsonFile, writeJsonFile } from './json-store.ts';

export type RunStatus = 'running' | 'completed' | 'failed' | 'awaiting_approval';
export type RunMode = 'review' | 'heal';

export interface SwarmFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  reproSteps: string[];
  screenshotUrl?: string;
  filePath?: string;
  line?: number;
  hypothesis?: string;
  source: 'explorer' | 'diagnostic';
}

export interface SubagentSummary {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  endedAt?: string;
}

export interface RunRecord {
  sessionId: string;
  mode: RunMode;
  status: RunStatus;
  repoFullName: string;
  repoUrl: string;
  prNumber?: number;
  prUrl?: string;
  headBranch?: string;
  headSha?: string;
  triggerKind?: string;
  composioUserId?: string;
  activeSubagent?: string;
  subagents: SubagentSummary[];
  findings: SwarmFinding[];
  findingsCount: number;
  prCommentUrl?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

const FILE = 'runs.json';

export async function listRuns(limit = 50): Promise<RunRecord[]> {
  const all = await readJsonFile<RunRecord[]>(FILE, []);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function getRun(sessionId: string): Promise<RunRecord | undefined> {
  const all = await readJsonFile<RunRecord[]>(FILE, []);
  return all.find((r) => r.sessionId === sessionId);
}

export async function upsertRun(partial: Partial<RunRecord> & { sessionId: string }): Promise<RunRecord> {
  const all = await readJsonFile<RunRecord[]>(FILE, []);
  const idx = all.findIndex((r) => r.sessionId === partial.sessionId);
  const now = new Date().toISOString();
  const base: RunRecord =
    idx >= 0
      ? all[idx]
      : {
          sessionId: partial.sessionId,
          mode: 'review',
          status: 'running',
          repoFullName: '',
          repoUrl: '',
          subagents: [],
          findings: [],
          findingsCount: 0,
          createdAt: now,
          updatedAt: now,
        };
  const merged: RunRecord = {
    ...base,
    ...partial,
    findings: partial.findings ?? base.findings,
    subagents: partial.subagents ?? base.subagents,
    findingsCount: partial.findingsCount ?? partial.findings?.length ?? base.findingsCount,
    updatedAt: now,
  };
  if (idx >= 0) all[idx] = merged;
  else all.push(merged);
  await writeJsonFile(FILE, all);
  return merged;
}

export async function appendFinding(sessionId: string, finding: SwarmFinding): Promise<void> {
  const run = await getRun(sessionId);
  if (!run) return;
  const findings = [...run.findings, finding];
  await upsertRun({ sessionId, findings, findingsCount: findings.length });
}

export async function updateSubagent(
  sessionId: string,
  subagent: SubagentSummary
): Promise<void> {
  const run = await getRun(sessionId);
  if (!run) return;
  const subagents = [...run.subagents];
  const idx = subagents.findIndex((s) => s.id === subagent.id);
  if (idx >= 0) subagents[idx] = { ...subagents[idx], ...subagent };
  else subagents.push(subagent);
  await upsertRun({ sessionId, subagents, activeSubagent: subagent.status === 'running' ? subagent.label : run.activeSubagent });
}
