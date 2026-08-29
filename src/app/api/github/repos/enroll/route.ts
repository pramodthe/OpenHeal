import { NextRequest, NextResponse } from 'next/server';
import { ensureComposioUserId } from '@/lib/composio/user';
import { armRepoPrTrigger } from '@/lib/composio/webhook-setup';
import {
  getActiveGithubConnection,
  githubConnectionHasWebhookScope,
  isComposioConfigured,
} from '@/lib/composio/client';
import { getEnrolledRepo, listEnrolledRepos, upsertEnrolledRepo } from '@/lib/store/enrolled-repos';

export async function GET() {
  const userId = await ensureComposioUserId();
  const repos = await listEnrolledRepos(userId);
  return NextResponse.json({ success: true, repos });
}

async function enrollWatchTriggers(
  userId: string,
  fullName: string,
  watchPrs: boolean
): Promise<{
  armed: string[];
  failed: Array<{ slug: string; error: string }>;
  delivery?: Awaited<ReturnType<typeof armRepoPrTrigger>>['delivery'];
}> {
  if (!watchPrs) {
    return { armed: [], failed: [] };
  }

  const connection = await getActiveGithubConnection(userId);
  if (!connection) {
    return {
      armed: [],
      failed: [{ slug: 'GITHUB_PULL_REQUEST_EVENT', error: 'Connect GitHub before enrolling.' }],
    };
  }

  return armRepoPrTrigger({
    userId,
    fullName,
    connectedAccountId: connection.id,
    hasWebhookScope: githubConnectionHasWebhookScope(connection),
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isComposioConfigured()) {
      return NextResponse.json({ success: false, error: 'Composio is not configured' }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const fullName = String(body.fullName || '').trim();
    if (!fullName.includes('/')) {
      return NextResponse.json({ success: false, error: 'fullName must be owner/repo' }, { status: 400 });
    }
    const userId = await ensureComposioUserId();
    const connection = await getActiveGithubConnection(userId);
    if (!connection) {
      return NextResponse.json(
        { success: false, error: 'Connect GitHub before enrolling a repository.' },
        { status: 400 }
      );
    }

    const htmlUrl = String(body.htmlUrl || `https://github.com/${fullName}`);
    const watchPrs = body.watchPrs !== false;
    const autoFix = Boolean(body.autoFix);
    const hasWebhookScope = githubConnectionHasWebhookScope(connection);

    const triggerResult = await enrollWatchTriggers(userId, fullName, watchPrs);

    const record = await upsertEnrolledRepo({
      fullName,
      htmlUrl,
      composioUserId: userId,
      watchPrs,
      autoFix,
      triggerArmed: triggerResult.armed,
      triggerFailed: triggerResult.failed.length ? triggerResult.failed : undefined,
    });

    return NextResponse.json({
      success: true,
      repo: record,
      armed: triggerResult.armed,
      failed: triggerResult.failed,
      needsReconnect: !hasWebhookScope,
      delivery: triggerResult.delivery,
      listenerActive: triggerResult.delivery?.subscribeActive ?? false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to enroll repository';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const fullName = String(body.fullName || '').trim();
  const userId = await ensureComposioUserId();
  const existing = await getEnrolledRepo(fullName, userId);
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Repository not enrolled' }, { status: 404 });
  }

  const watchPrs = body.watchPrs ?? existing.watchPrs;
  const autoFix = body.autoFix ?? existing.autoFix;

  let triggerArmed = existing.triggerArmed;
  let triggerFailed = existing.triggerFailed;

  if (watchPrs && !existing.watchPrs) {
    const triggerResult = await enrollWatchTriggers(userId, fullName, true);
    triggerArmed = triggerResult.armed;
    triggerFailed = triggerResult.failed.length ? triggerResult.failed : undefined;
  } else if (!watchPrs) {
    triggerArmed = [];
    triggerFailed = undefined;
  }

  const record = await upsertEnrolledRepo({
    fullName,
    htmlUrl: existing.htmlUrl,
    composioUserId: userId,
    watchPrs,
    autoFix,
    triggerArmed,
    triggerFailed,
  });
  return NextResponse.json({ success: true, repo: record });
}
