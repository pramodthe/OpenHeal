/**
 * Turn-level tracing for TrueForge agent runs.
 * Mirrors trueforge.dev/api/use-agent turn events for SSE + JSONL + optional Langfuse.
 */
import fs from 'node:fs';
import path from 'node:path';

import { eventBus } from './event-bus.ts';

export interface TurnTraceRecord {
  seq: number;
  sessionId: string;
  turnId?: string;
  threadId?: string | null;
  type: string;
  summary: string;
  event: Record<string, unknown>;
  timestamp: string;
}

const seqBySession = new Map<string, number>();
const turnIdsBySession = new Map<string, string>();
const langfuseTraceBySession = new Map<string, string>();

function nextSeq(sessionId: string): number {
  const n = (seqBySession.get(sessionId) ?? 0) + 1;
  seqBySession.set(sessionId, n);
  return n;
}

function traceDir(): string {
  const base = process.env.OPENHEAL_DATA_DIR?.trim() || '.openheal-data';
  const dir = path.resolve(process.cwd(), base, 'traces');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendJsonl(sessionId: string, record: TurnTraceRecord): void {
  try {
    const file = path.join(traceDir(), `${sessionId}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    console.warn('[turn-tracer] failed to write trace', err);
  }
}

function field(event: Record<string, unknown>, camel: string, snake: string): unknown {
  return event[camel] ?? event[snake];
}

/** Human-readable one-liner per TrueForge turn event type. */
export function summarizeTurnEvent(event: Record<string, unknown>): string {
  const type = String(event.type || 'unknown');

  switch (type) {
    case 'turn.created':
      return `Turn started (${field(event, 'turnId', 'turn_id') ?? '?'})`;
    case 'turn.done': {
      const state = event.state as Record<string, unknown> | undefined;
      const status = state?.status ?? 'unknown';
      const message = state?.message ? ` — ${state.message}` : '';
      const metrics = state?.metrics as Record<string, unknown> | undefined;
      const tokens = metrics?.total_tokens ?? metrics?.totalTokens;
      const cost = metrics?.total_cost_in_usd ?? metrics?.totalCostInUsd;
      const extra =
        tokens != null ? ` · ${tokens} tokens${cost != null ? ` · $${cost}` : ''}` : '';
      return `Turn finished: ${status}${message}${extra}`;
    }
    case 'thread.created':
      return `Subagent started: ${field(event, 'title', 'title') ?? field(event, 'threadId', 'thread_id')}`;
    case 'thread.done': {
      const state = event.state as Record<string, unknown> | undefined;
      return `Subagent done: ${field(event, 'title', 'title') ?? field(event, 'threadId', 'thread_id')} (${state?.status ?? 'done'})`;
    }
    case 'sandbox.created':
      return `Sandbox provisioned (${field(event, 'sandboxId', 'sandbox_id') ?? 'id unknown'})`;
    case 'model.message': {
      const content = extractText(event);
      const calls = (event.toolCalls ?? event.tool_calls) as unknown[] | undefined;
      const names =
        Array.isArray(calls) && calls.length
          ? calls
              .map((c) => {
                const fn = (c as { function?: { name?: string }; name?: string }).function?.name;
                return fn || (c as { name?: string }).name;
              })
              .filter(Boolean)
              .join(', ')
          : '';
      if (names) return `Model → tool call(s): ${names}`;
      const preview = content.slice(0, 160).replace(/\s+/g, ' ').trim();
      return preview ? `Model: ${preview}${content.length > 160 ? '…' : ''}` : 'Model message (empty)';
    }
    case 'model.message.delta': {
      const text = extractText(event);
      if (!text) return 'Model streaming…';
      const preview = text.slice(0, 120).replace(/\s+/g, ' ').trim();
      return `Model Δ: ${preview}${text.length > 120 ? '…' : ''}`;
    }
    case 'tool.response': {
      const toolCallId = field(event, 'toolCallId', 'tool_call_id');
      const content = extractText(event).slice(0, 200).replace(/\s+/g, ' ').trim();
      return `Tool result (${toolCallId}): ${content || '(empty)'}`;
    }
    case 'tool.approval_required': {
      const calls = field(event, 'toolCalls', 'tool_calls');
      const count = Array.isArray(calls) ? calls.length : 0;
      return `Approval required for ${count} tool call(s)`;
    }
    case 'tool.response_required':
      return 'Agent question — response required';
    case 'mcp.initialize':
      return 'MCP servers initialized';
    case 'mcp.auth_required':
      return 'MCP OAuth required';
    default:
      return type;
  }
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

function sanitizeEvent(event: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...event };
  // Keep traces readable — trim huge tool outputs.
  const content = copy.content ?? copy.output;
  if (typeof content === 'string' && content.length > 4000) {
    copy.content = `${content.slice(0, 4000)}… [truncated ${content.length - 4000} chars]`;
  }
  return copy;
}

/** Publish a turn event to SSE, JSONL, and optional Langfuse. */
export function traceTurnEvent(
  sessionId: string,
  threadId: string,
  event: Record<string, unknown>,
  meta?: { seq?: number; turnId?: string; summary?: string }
): TurnTraceRecord {
  const type = String(event.type || 'unknown');
  const turnId =
    meta?.turnId ??
    (type === 'turn.created' ? String(field(event, 'turnId', 'turn_id') ?? '') : undefined) ??
    turnIdsBySession.get(sessionId);

  if (type === 'turn.created') {
    const id = field(event, 'turnId', 'turn_id');
    if (typeof id === 'string') turnIdsBySession.set(sessionId, id);
  }

  const record: TurnTraceRecord = {
    seq: meta?.seq ?? nextSeq(sessionId),
    sessionId,
    turnId: turnId || undefined,
    threadId: (field(event, 'threadId', 'thread_id') as string | null | undefined) ?? threadId,
    type,
    summary: meta?.summary ?? summarizeTurnEvent(event),
    event: sanitizeEvent(event),
    timestamp: new Date().toISOString(),
  };

  eventBus.emitEvent(sessionId, threadId, 'turn.trace', {
    seq: record.seq,
    turnId: record.turnId,
    threadId: record.threadId,
    type: record.type,
    summary: record.summary,
    event: record.event,
    timestamp: record.timestamp,
  });

  appendJsonl(sessionId, record);
  void pushLangfuse(record);

  return record;
}

/** Synthetic turn events for the local OpenHeal swarm (no TrueForge session). */
export function traceLocalStep(
  sessionId: string,
  threadId: string,
  type: string,
  payload: Record<string, unknown>,
  summaryOverride?: string
): TurnTraceRecord {
  return traceTurnEvent(
    sessionId,
    threadId,
    { type, thread_id: threadId, ...payload },
    { summary: summaryOverride }
  );
}

export function readTraceLog(sessionId: string): TurnTraceRecord[] {
  const file = path.join(traceDir(), `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TurnTraceRecord);
}

async function pushLangfuse(record: TurnTraceRecord): Promise<void> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) return;

  const host = (process.env.LANGFUSE_HOST?.trim() || 'https://cloud.langfuse.com').replace(/\/$/, '');

  let traceId = langfuseTraceBySession.get(record.sessionId);
  if (!traceId) {
    traceId = record.sessionId;
    langfuseTraceBySession.set(record.sessionId, traceId);
  }

  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
  const body = {
    batch: [
      {
        id: `turn-${record.sessionId}-${record.seq}`,
        type: 'trace-create',
        timestamp: record.timestamp,
        body: {
          id: traceId,
          name: 'openheal-heal-session',
          sessionId: record.sessionId,
        },
      },
      {
        id: `span-${record.sessionId}-${record.seq}`,
        type: 'span-create',
        timestamp: record.timestamp,
        body: {
          traceId,
          name: record.type,
          input: { summary: record.summary, turnId: record.turnId, threadId: record.threadId },
          output: record.event,
        },
      },
    ],
  };

  try {
    await fetch(`${host}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn('[turn-tracer] Langfuse push failed', err);
  }
}
