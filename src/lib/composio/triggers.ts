/**
 * Inbound GitHub events → heal runs.
 *
 * Composio delivers repository events either over a websocket (`subscribe`, no
 * public URL needed) or to a webhook. Both land in `handleTriggerPayload`, which
 * decides whether the event is worth a heal and guards against the obvious
 * failure mode: OpenHeal opens a PR, the PR event fires, OpenHeal heals again.
 */
import { getComposio } from './client.ts';

/** The branch prefix OpenHeal pushes to. Events on these branches are our own. */
export const OPENHEAL_BRANCH_PREFIX = 'openheal/';

export const HEAL_TRIGGER_SLUGS = {
  /** PR opened, synchronized, or reopened — primary Ito-like entry. */
  prOpened: 'GITHUB_PULL_REQUEST_EVENT',
  /** A failing CI check already contains a real failure trace — the cleanest entry. */
  checkRun: 'GITHUB_CHECK_RUN_STATUS_CHANGED_TRIGGER',
  issueOpened: 'GITHUB_ISSUE_ADDED_EVENT',
  reviewComment: 'GITHUB_PR_REVIEW_COMMENT_CREATED_TRIGGER',
} as const;

export type HealTriggerKind = keyof typeof HEAL_TRIGGER_SLUGS;

export interface TriggerDecision {
  act: boolean;
  reason: string;
  kind?: HealTriggerKind;
  repoUrl?: string;
  repoFullName?: string;
  prNumber?: number;
  prUrl?: string;
  headBranch?: string;
  headSha?: string;
  prompt?: string;
  dedupeKey?: string;
  mode?: 'review' | 'heal';
  autoFix?: boolean;
}

/**
 * Recently handled events. A heal takes minutes and GitHub redelivers, so the
 * window has to outlive a run rather than just dedupe instant retries.
 */
const seen = new Map<string, number>();
const DEDUPE_TTL_MS = 30 * 60 * 1000;

export function alreadyHandled(key: string, now = Date.now()): boolean {
  for (const [k, at] of seen) {
    if (now - at > DEDUPE_TTL_MS) seen.delete(k);
  }
  if (seen.has(key)) return true;
  seen.set(key, now);
  return false;
}

export function resetDedupe(): void {
  seen.clear();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pick(source: Record<string, unknown>, ...path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Decide whether an inbound event should start a heal.
 *
 * Every "no" here is deliberate: without the actor and branch checks OpenHeal
 * reacts to its own pull requests and loops until it exhausts sandbox quota.
 */
export function classifyTriggerPayload(payload: Record<string, unknown>): TriggerDecision {
  const slug = str(payload.triggerSlug || payload.trigger_slug || payload.type).toUpperCase();
  const data = (payload.data && typeof payload.data === 'object'
    ? (payload.data as Record<string, unknown>)
    : payload) as Record<string, unknown>;

  const repoFullName =
    str(pick(data, 'repository', 'full_name')) || str(data.repository_full_name) || str(data.repo);
  const repoUrl =
    str(pick(data, 'repository', 'html_url')) ||
    (repoFullName ? `https://github.com/${repoFullName}` : '');

  const actor =
    str(pick(data, 'sender', 'login')) ||
    str(pick(data, 'actor', 'login')) ||
    str(data.sender_login);

  // Loop guard 1: never react to our own writes.
  const selfActor = process.env.OPENHEAL_BOT_LOGIN?.trim();
  if (selfActor && actor && actor.toLowerCase() === selfActor.toLowerCase()) {
    return { act: false, reason: `Ignoring event authored by OpenHeal itself (${actor})` };
  }

  // Loop guard 2: never react to branches OpenHeal pushed.
  const branch =
    str(pick(data, 'check_run', 'check_suite', 'head_branch')) ||
    str(pick(data, 'pull_request', 'head', 'ref')) ||
    str(data.branch);
  if (branch.startsWith(OPENHEAL_BRANCH_PREFIX)) {
    return { act: false, reason: `Ignoring event on OpenHeal's own branch ${branch}` };
  }

  if (!repoUrl) {
    return { act: false, reason: 'Event carried no repository reference' };
  }

  if (slug.includes('PULL_REQUEST') || slug.includes('PR_EVENT')) {
    const action = str(pick(data, 'action') || data.action).toLowerCase();
    if (action && !['opened', 'synchronize', 'reopened'].includes(action)) {
      return { act: false, reason: `PR action "${action}" does not start a review run` };
    }
    const draft = pick(data, 'pull_request', 'draft') ?? data.draft;
    if (draft === true) {
      return { act: false, reason: 'Draft pull requests are skipped' };
    }
    const number = Number(pick(data, 'pull_request', 'number') ?? data.number ?? 0);
    const prUrl = str(pick(data, 'pull_request', 'html_url') || data.html_url);
    const headRef = str(pick(data, 'pull_request', 'head', 'ref') || data.head_ref);
    const headSha = str(pick(data, 'pull_request', 'head', 'sha') || data.head_sha);
    return {
      act: true,
      kind: 'prOpened',
      mode: 'review',
      reason: `Pull request #${number || '?'} ${action || 'updated'}`,
      repoUrl,
      repoFullName,
      prNumber: number || undefined,
      prUrl: prUrl || undefined,
      headBranch: headRef || undefined,
      headSha: headSha || undefined,
      dedupeKey: `pr:${repoFullName}:${number}:${headSha || action}`,
      prompt:
        `Review pull request #${number} on ${repoFullName}. ` +
        `Head branch: ${headRef || 'unknown'}. ` +
        'Spawn the swarm in order: BuildOps → Explorer → Diagnostic → Reporter. ' +
        'Build and run the app, explore user flows affected by the diff, diagnose root causes, ' +
        'and post a structured review comment on the PR with severity, repro steps, and evidence.',
    };
  }

  if (slug.includes('CHECK_RUN') || slug.includes('CHECK_SUITE')) {
    const conclusion = str(pick(data, 'check_run', 'conclusion') || data.conclusion).toLowerCase();
    if (conclusion !== 'failure' && conclusion !== 'timed_out') {
      return { act: false, reason: `Check finished as "${conclusion || 'unknown'}" — nothing to heal` };
    }
    const sha = str(pick(data, 'check_run', 'head_sha') || data.head_sha);
    const name = str(pick(data, 'check_run', 'name') || data.name) || 'CI';
    return {
      act: true,
      kind: 'checkRun',
      mode: 'heal',
      reason: `CI check "${name}" failed`,
      repoUrl,
      repoFullName,
      dedupeKey: `check:${repoFullName}:${sha || name}`,
      prompt:
        `The CI check "${name}" failed on ${repoFullName}${sha ? ` at commit ${sha}` : ''}. ` +
        'Reproduce the failure in your sandbox, fix the root cause, verify the suite is green, ' +
        'and open a pull request with the evidence.',
    };
  }

  if (slug.includes('ISSUE') && !slug.includes('COMMENT')) {
    const number = pick(data, 'issue', 'number') ?? data.issue_number;
    const title = str(pick(data, 'issue', 'title') || data.title);
    const body = str(pick(data, 'issue', 'body') || data.body);

    // Opt-in: healing every filed issue is rarely what a repo owner wants.
    const label = process.env.OPENHEAL_ISSUE_LABEL?.trim() || 'openheal';
    const labels = (pick(data, 'issue', 'labels') as Array<{ name?: string }> | undefined) || [];
    const hasLabel = labels.some((l) => str(l?.name).toLowerCase() === label.toLowerCase());
    if (!hasLabel) {
      return { act: false, reason: `Issue #${number} is not labelled "${label}" — skipping` };
    }

    return {
      act: true,
      kind: 'issueOpened',
      mode: 'heal',
      reason: `Issue #${number} labelled "${label}"`,
      repoUrl,
      repoFullName,
      dedupeKey: `issue:${repoFullName}:${number}`,
      prompt:
        `Issue #${number} on ${repoFullName}: "${title}".\n\n${body}\n\n` +
        'Reproduce this as a failing test first, then fix it, verify, and open a pull request.',
    };
  }

  if (slug.includes('REVIEW_COMMENT')) {
    const number = pick(data, 'pull_request', 'number') ?? data.pr_number;
    const comment = str(pick(data, 'comment', 'body') || data.body);
    if (!/@openheal\b/i.test(comment)) {
      return { act: false, reason: 'Review comment does not mention @openheal' };
    }
    return {
      act: true,
      kind: 'reviewComment',
      mode: 'heal',
      reason: `Review comment on PR #${number} mentions @openheal`,
      repoUrl,
      repoFullName,
      dedupeKey: `review:${repoFullName}:${number}:${comment.slice(0, 40)}`,
      prompt: `A reviewer on PR #${number} of ${repoFullName} asked:\n\n${comment}\n\nAddress it.`,
    };
  }

  return { act: false, reason: `No heal rule for trigger "${slug}"` };
}

export const WEBHOOK_SCOPE_HINT =
  'GitHub OAuth is missing webhook permissions (admin:repo_hook). Disconnect and reconnect GitHub, then re-enroll the repo.';

export const LOCAL_TRIGGER_HINT =
  'Composio PR triggers need HTTPS. In another terminal run `npm run tunnel`, restart dev, then toggle Watch PRs.';

function formatComposioError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { message?: string } };
      const message = parsed.error?.message;
      if (message) return message;
    } catch {
      // fall through
    }
  }
  return raw;
}

/** Composio rejects http:// — project webhooks must be HTTPS (ngrok, cloudflare tunnel, etc.). */
export async function ensureComposioProjectWebhook(
  publicUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const base = publicUrl.trim().replace(/\/$/, '');
  if (!base.startsWith('https://')) {
    return {
      ok: false,
      error: 'Composio requires an HTTPS webhook URL. Set OPENHEAL_PUBLIC_URL to your ngrok or tunnel URL.',
    };
  }
  try {
    await registerWebhook(base);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatComposioError(err) };
  }
}

/** Arm the GitHub triggers for a connected Composio user. */
export async function armHealTriggers(
  userId: string,
  kinds: HealTriggerKind[] = ['prOpened'],
  repoFullName?: string,
  connectedAccountId?: string
): Promise<{ armed: string[]; failed: Array<{ slug: string; error: string }> }> {
  const composio = getComposio();
  const armed: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];

  const [owner, repo] = (repoFullName || '').split('/');
  if (!owner || !repo) {
    return {
      armed,
      failed: [{ slug: '*', error: 'repoFullName must be owner/repo to arm PR triggers' }],
    };
  }
  const triggerConfig = { owner, repo };

  for (const kind of kinds) {
    const slug = HEAL_TRIGGER_SLUGS[kind];
    // These triggers need PR/check IDs at runtime — not repo-level enrollment.
    if ((kind === 'checkRun' || kind === 'reviewComment') && !repoFullName) {
      failed.push({
        slug,
        error: `${kind} triggers require a specific PR or check context, not repo enrollment`,
      });
      continue;
    }
    try {
      await composio.triggers.create(userId, slug, {
        connectedAccountId,
        triggerConfig,
      });
      armed.push(slug);
    } catch (err) {
      let message = formatComposioError(err);
      if (/invalid webhook configuration/i.test(message)) {
        message = `${message} Set OPENHEAL_PUBLIC_URL to a public HTTPS URL (ngrok), restart the app, then toggle Watch PRs again.`;
      } else if (/repository .* not found/i.test(message)) {
        message = `${message} ${WEBHOOK_SCOPE_HINT}`;
      }
      failed.push({ slug, error: message });
    }
  }
  return { armed, failed };
}

/** Point Composio's webhook delivery at this deployment. */
export async function registerWebhook(publicUrl: string): Promise<void> {
  await getComposio().triggers.setWebhookSubscription({
    webhookUrl: `${publicUrl.replace(/\/$/, '')}/api/webhooks/composio`,
  });
}
