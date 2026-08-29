/**
 * Shared entry for Composio trigger payloads (webhook or websocket subscribe).
 */
import { alreadyHandled, classifyTriggerPayload } from './triggers.ts';
import { resolveComposioUserForRepo } from '../store/enrolled-repos.ts';
import { startHealPipeline } from '../heal/run-session.ts';
import { startReviewSwarm } from '../review/run-review-swarm.ts';

export interface TriggerHandleResult {
  acted: boolean;
  reason: string;
  sessionId?: string;
  kind?: string;
  mode?: string;
  repo?: string;
}

function payloadUserId(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.userId === 'string') return payload.userId;
  if (typeof payload.user_id === 'string') return payload.user_id;
  const metadata = payload.metadata;
  if (metadata && typeof metadata === 'object') {
    const meta = metadata as { user_id?: string; userId?: string; connectedAccount?: { userId?: string } };
    if (meta.user_id) return meta.user_id;
    if (meta.userId) return meta.userId;
    if (meta.connectedAccount?.userId) return meta.connectedAccount.userId;
  }
  return undefined;
}

/** Normalize subscribe/webhook payloads into the shape classifyTriggerPayload expects. */
export function normalizeComposioTriggerPayload(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.triggerSlug || raw.trigger_slug) return raw;

  const metadata = raw.metadata;
  const triggerSlug =
    typeof raw.triggerSlug === 'string'
      ? raw.triggerSlug
      : typeof raw.trigger_slug === 'string'
        ? raw.trigger_slug
        : typeof raw.trigger_name === 'string'
          ? raw.trigger_name
          : metadata && typeof metadata === 'object'
            ? String((metadata as { trigger_slug?: string }).trigger_slug || '') || undefined
            : undefined;

  const inner =
    raw.payload && typeof raw.payload === 'object'
      ? (raw.payload as Record<string, unknown>)
      : raw.data && typeof raw.data === 'object'
        ? (raw.data as Record<string, unknown>)
        : raw;

  return {
    ...raw,
    triggerSlug,
    data: inner,
    userId: payloadUserId(raw),
  };
}

export async function handleComposioTriggerPayload(
  raw: Record<string, unknown>,
  options: { useAfter?: boolean } = {}
): Promise<TriggerHandleResult> {
  const payload = normalizeComposioTriggerPayload(raw);
  const decision = classifyTriggerPayload(payload);

  if (!decision.act) {
    return { acted: false, reason: decision.reason };
  }

  if (decision.dedupeKey && alreadyHandled(decision.dedupeKey)) {
    return { acted: false, reason: `Already handling ${decision.dedupeKey}` };
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  let composioUserId = payloadUserId(payload);
  if (!composioUserId && decision.repoFullName) {
    composioUserId = await resolveComposioUserForRepo(decision.repoFullName);
  }

  const run = () => {
    const base = {
      sessionId,
      repoUrl: decision.repoUrl!,
      repoFullName: decision.repoFullName,
      composioUserId,
      triggerPrompt: decision.prompt,
    };

    if (decision.mode === 'review' || decision.kind === 'prOpened') {
      startReviewSwarm({
        ...base,
        prNumber: decision.prNumber,
        prUrl: decision.prUrl,
        headBranch: decision.headBranch,
        headSha: decision.headSha,
        autoFix: decision.autoFix,
      }).catch((err) => console.error('[composio-trigger] review swarm failed', err));
      return;
    }

    startHealPipeline(base).catch((err) => console.error('[composio-trigger] heal failed', err));
  };

  if (options.useAfter !== false) {
    const { after } = await import('next/server');
    after(run);
  } else {
    run();
  }

  return {
    acted: true,
    reason: decision.reason,
    sessionId,
    kind: decision.kind,
    mode: decision.mode || 'heal',
    repo: decision.repoFullName,
  };
}
