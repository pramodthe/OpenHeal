/**
 * The heal loop, run by the real TrueForge harness.
 *
 * Everything the swarm used to hand-roll is delegated here:
 *   - the sandbox comes from `config.sandbox` (Daytona, via the harness)
 *   - the subagents come from `config.dynamicSubAgents`
 *   - GitHub comes from the Composio MCP server
 *   - the human gate comes from `requireApprovalForTools`, which pauses the turn
 *     with tool.approval_required instead of us inventing a resume token
 */
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { isEventDelta, mergeEventDelta } from '@truefoundry/trueforge-sdk';
import { eventBus } from './event-bus.ts';
import { sessionManager } from './session.ts';
import { createTrueForgeClient } from './sdk-client.ts';
import { bootstrapTrueForge, registerRemoteMcpServer } from './bootstrap.ts';
import {
  OPENHEAL_APPROVAL_TOOLS,
  composioMcpHeaders,
  generateGithubMcpUrl,
} from '../composio/mcp.ts';

export const GITHUB_MCP_NAME = 'openheal-github';

export interface PendingApproval {
  toolCallId: string;
  threadId: string;
  toolName?: string;
  arguments?: unknown;
}

interface HarnessRun {
  client: ReturnType<typeof createTrueForgeClient>;
  tfSessionId: string;
  pending: PendingApproval[];
  /** tool call id → tool name, harvested from model.message events. */
  toolNames: Map<string, string>;
}

const runs = new Map<string, HarnessRun>();

export function getHarnessRun(openhealSessionId: string): HarnessRun | undefined {
  return runs.get(openhealSessionId);
}

function instructions(repoUrl: string, testCommand: string): string {
  return `You are OpenHeal, an autonomous self-healing agent running on the TrueForge harness.

Repository under repair: ${repoUrl}
Test command: ${testCommand}

Work in this order, using your sandbox shell for every step:
1. DIAGNOSE — clone the repo, install dependencies, run the test command, and capture the
   failing output. Name the exact file and line responsible. Do not guess; read the source.
2. PATCH — apply the smallest change that makes the failing test pass. Never edit the tests
   to force a pass, and never touch code unrelated to the failure.
3. VERIFY — re-run the full test command. The patch is only acceptable at exit code 0.
   If it still fails, go back to step 2. Report the before/after test output.
4. SHIP — once green, use the GitHub tools to create a branch, commit the patched file, and
   open a pull request describing the root cause and the verification evidence.

The GitHub write tools pause for human approval. That pause is expected: state what you are
about to do and wait. Keep status updates short and factual.`;
}

/** Attach the Composio-hosted GitHub toolkit so the agent calls GitHub itself. */
async function attachGithubMcp(composioUserId: string): Promise<boolean> {
  try {
    const url = await generateGithubMcpUrl(composioUserId);
    await registerRemoteMcpServer({
      name: GITHUB_MCP_NAME,
      url,
      description: 'GitHub via Composio: read repos, create branches, commit files, open pull requests.',
      headers: composioMcpHeaders(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function runHealOnHarness(input: {
  sessionId: string;
  threadId: string;
  repoUrl: string;
  testCommand: string;
  composioUserId?: string;
  model?: string;
  daytonaKey?: string;
  /** Supplied when a GitHub event started the run instead of the dashboard. */
  triggerPrompt?: string;
}): Promise<{ started: boolean; reason?: string }> {
  const { sessionId, threadId } = input;

  const status = (message: string) =>
    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'orchestrator',
      status: 'running',
      message,
    });

  const report = await bootstrapTrueForge({
    requestedModel: input.model,
    daytonaKey: input.daytonaKey,
  });
  for (const warning of report.warnings) status(`TrueForge: ${warning}`);
  if (!report.reachable || !report.model) {
    return { started: false, reason: report.warnings[0] || 'TrueForge unreachable' };
  }
  if (report.modelRewritten) {
    status(`Model "${report.requestedModel}" resolved to "${report.model}" from the TrueForge catalog.`);
  }
  status(
    `TrueForge ${report.baseUrl} · model ${report.model} · sandbox ${report.sandboxProvider}`
  );

  const githubAttached = input.composioUserId ? await attachGithubMcp(input.composioUserId) : false;
  status(
    githubAttached
      ? `GitHub attached as MCP server "${GITHUB_MCP_NAME}" — writes pause at the human gate.`
      : 'GitHub MCP not attached; the agent will diagnose and patch but cannot open a PR.'
  );

  const client = createTrueForgeClient();
  const spec: TrueForgeApi.AgentSpec = {
    model: { name: report.model },
    instructions: instructions(input.repoUrl, input.testCommand),
    config: {
      sandbox: { enabled: true },
      dynamicSubAgents: { enabled: true },
      iterationLimit: 120,
    },
    ...(githubAttached
      ? {
          mcpServers: [
            {
              name: GITHUB_MCP_NAME,
              // Load the write tools eagerly so the approval card names the real
              // action; deferred discovery would surface them as `call_tool`.
              preloadTools: OPENHEAL_APPROVAL_TOOLS,
              requireApprovalForTools: OPENHEAL_APPROVAL_TOOLS,
            },
          ],
        }
      : {}),
  };

  const created = await client.sessions.create({ agent: { spec } });
  const tfSessionId = (created as { data?: { id?: string }; id?: string }).data?.id
    ?? (created as { id?: string }).id;
  if (!tfSessionId) throw new Error('TrueForge sessions.create returned no session id');

  const run: HarnessRun = { client, tfSessionId, pending: [], toolNames: new Map() };
  runs.set(sessionId, run);
  status(`TrueForge session ${tfSessionId} opened. Handing the repair to the harness.`);

  const opening =
    input.triggerPrompt || `Heal ${input.repoUrl}. Begin with DIAGNOSE.`;
  await streamTurn(run, sessionId, threadId, {
    input: [{ type: 'user.message', content: opening }],
  });

  return { started: true };
}

/**
 * Drive one turn to a terminal event, republishing the harness's own events on
 * the bus the dashboard already listens to.
 */
async function streamTurn(
  run: HarnessRun,
  sessionId: string,
  threadId: string,
  body: Record<string, unknown>
): Promise<void> {
  const merged = new Map<string, Record<string, unknown>>();
  run.pending = [];

  const stream = await run.client.sessions.createTurnStream(run.tfSessionId, body as never);

  for await (const raw of stream as AsyncIterable<unknown>) {
    const event = unwrapEvent(raw);
    if (!event) continue;

    const id = typeof event.id === 'string' ? event.id : undefined;
    if (id && isEventDelta(event as never)) {
      const base = merged.get(id) || { ...event };
      mergeEventDelta(base as never, event as never);
      merged.set(id, base);
    } else if (id) {
      merged.set(id, event);
    }

    routeEvent(event, sessionId, threadId, run, merged);
  }

  if (run.pending.length > 0) {
    sessionManager.transitionStatus(sessionId, 'AWAITING_HUMAN_APPROVAL');
  }
}

/** Events arrive camelCased from the SDK and snake_cased from raw SSE. */
function field(event: Record<string, unknown>, camel: string, snake: string): unknown {
  return event[camel] ?? event[snake];
}

function routeEvent(
  event: Record<string, unknown>,
  sessionId: string,
  threadId: string,
  run: HarnessRun,
  merged: Map<string, Record<string, unknown>>
): void {
  const type = String(event.type || '');
  const rawThread = field(event, 'threadId', 'thread_id');
  const thread = typeof rawThread === 'string' && rawThread ? rawThread : threadId;

  // tool.approval_required carries only call ids, so names are harvested from
  // the model.message that requested them — which is assembled from deltas.
  harvestToolNames(event, run);

  switch (type) {
    case 'sandbox.created':
      eventBus.emitEvent(sessionId, threadId, 'agent.status', {
        agent: 'orchestrator',
        status: 'running',
        message: 'TrueForge provisioned the agent sandbox.',
      });
      sessionManager.transitionStatus(sessionId, 'PROVISIONING_SANDBOX');
      break;

    case 'model.message.delta': {
      const text = extractText(event);
      if (text) eventBus.emitDelta(sessionId, thread, 'agent.thought.delta', { delta: text });
      break;
    }

    case 'tool.call': {
      const name = String(field(event, 'toolName', 'tool_name') || event.name || 'tool');
      eventBus.emitEvent(sessionId, thread, 'agent.status', {
        agent: subagentFor(thread),
        status: 'running',
        message: `${name}`,
      });
      break;
    }

    case 'tool.response': {
      const text = extractText(event);
      if (text) {
        eventBus.emitDelta(sessionId, thread, 'sandbox.log.delta', {
          stream: 'stdout',
          text: text.endsWith('\n') ? text : `${text}\n`,
        });
      }
      break;
    }

    case 'tool.approval_required': {
      // One event can gate several calls at once; every one must be answered.
      const calls = field(event, 'toolCalls', 'tool_calls');
      const refs = Array.isArray(calls) ? calls : [];
      for (const ref of refs) {
        const { id, sourceEventId, source_event_id: snakeSource } =
          ref as { id?: string; sourceEventId?: string; source_event_id?: string };
        if (!id) continue;
        // The name may still be sitting unmerged in the source model.message.
        const source = merged.get(sourceEventId || snakeSource || '');
        if (source) harvestToolNames(source, run);
        run.pending.push({
          toolCallId: id,
          threadId: thread,
          toolName: run.toolNames.get(id),
        });
      }
      if (refs.length === 0) break;
      const names = refs
        .map((ref) => run.toolNames.get((ref as { id?: string }).id || ''))
        .filter(Boolean);
      eventBus.emitEvent(sessionId, thread, 'agent.status', {
        agent: 'orchestrator',
        status: 'awaiting_approval',
        message: `Human approval required for ${names.length ? names.join(', ') : 'a GitHub write'}.`,
      });
      break;
    }

    case 'turn.done': {
      const state = event.state as { status?: string; message?: string } | undefined;
      if (state?.status === 'error') {
        eventBus.emitEvent(sessionId, threadId, 'session.error', {
          error: state.message || 'TrueForge turn failed',
        });
      }
      break;
    }
  }
}

function harvestToolNames(event: Record<string, unknown>, run: HarnessRun): void {
  const calls = event.toolCalls ?? event.tool_calls;
  if (!Array.isArray(calls)) return;
  for (const call of calls) {
    const record = call as { id?: string; function?: { name?: string }; name?: string };
    const name = record.function?.name || record.name;
    if (record.id && name) run.toolNames.set(record.id, name);
  }
}

/** Subagent threads carry their own thread_id; `main` is the orchestrator. */
function subagentFor(threadId: string): string {
  return !threadId || threadId === 'main' ? 'orchestrator' : threadId;
}

function extractText(event: Record<string, unknown>): string {
  const direct = event.content ?? event.delta ?? event.text ?? event.output;
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) {
    return direct
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('');
  }
  return '';
}

function unwrapEvent(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  return record;
}

/** Resume the paused turn once the operator decides. */
export async function resolveHarnessApproval(
  sessionId: string,
  threadId: string,
  allow: boolean,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const run = runs.get(sessionId);
  if (!run) return { success: false, error: 'No TrueForge run for this session' };
  if (run.pending.length === 0) return { success: false, error: 'No pending tool approval' };

  const decisions = run.pending.map((item) => ({
    type: 'user.tool_approval' as const,
    threadId: item.threadId || 'main',
    toolCallId: item.toolCallId,
    approval: allow
      ? ({ status: 'allow' } as const)
      : ({ status: 'deny', reason: reason || 'Rejected by Mission Control operator' } as const),
  }));

  sessionManager.transitionStatus(sessionId, allow ? 'EXECUTING_PR' : 'REJECTED');
  await streamTurn(run, sessionId, threadId, { input: decisions });
  return { success: true };
}
