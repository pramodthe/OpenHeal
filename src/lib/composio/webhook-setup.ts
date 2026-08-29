/**
 * Composio trigger delivery — project webhook (HTTPS) + optional Pusher subscribe.
 *
 * Local dev: run `npm run tunnel` (cloudflared, no ngrok account), or set OPENHEAL_PUBLIC_URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getActiveGithubConnection, githubConnectionHasWebhookScope, isComposioConfigured } from './client.ts';
import { listEnrolledRepos, upsertEnrolledRepo } from '../store/enrolled-repos.ts';
import {
  armHealTriggers,
  ensureComposioProjectWebhook,
  LOCAL_TRIGGER_HINT,
  WEBHOOK_SCOPE_HINT,
} from './triggers.ts';
import { ensureComposioTriggerListener, isComposioTriggerListenerActive } from './trigger-listener.ts';

export interface TriggerDeliveryStatus {
  publicUrl?: string;
  source: 'env' | 'tunnel-file' | 'ngrok' | 'none';
  webhookRegistered: boolean;
  subscribeActive: boolean;
  error?: string;
}

const TUNNEL_URL_FILE = path.join(process.cwd(), '.openheal-tunnel-url');

function readTunnelFileUrl(): string | undefined {
  try {
    const raw = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim();
    if (raw.startsWith('https://')) return raw.replace(/\/$/, '');
  } catch {
    // no tunnel file yet
  }
  return undefined;
}

/** Read the first HTTPS tunnel from a local ngrok agent (http://127.0.0.1:4040). */
export async function discoverNgrokPublicUrl(): Promise<string | undefined> {
  try {
    const res = await fetch('http://127.0.0.1:4040/api/tunnels', {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      tunnels?: Array<{ public_url?: string; proto?: string }>;
    };
    const tunnel = body.tunnels?.find((t) => t.public_url?.startsWith('https://'));
    return tunnel?.public_url?.replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** OPENHEAL_PUBLIC_URL → .openheal-tunnel-url → ngrok API. */
export async function resolveComposioPublicUrl(): Promise<{ url?: string; source: TriggerDeliveryStatus['source'] }> {
  const fromEnv = process.env.OPENHEAL_PUBLIC_URL?.trim();
  if (fromEnv?.startsWith('https://')) {
    return { url: fromEnv.replace(/\/$/, ''), source: 'env' };
  }
  const fromFile = readTunnelFileUrl();
  if (fromFile) {
    return { url: fromFile, source: 'tunnel-file' };
  }
  const fromNgrok = await discoverNgrokPublicUrl();
  if (fromNgrok) {
    return { url: fromNgrok, source: 'ngrok' };
  }
  return { source: 'none' };
}

export async function ensureComposioTriggerDelivery(): Promise<TriggerDeliveryStatus> {
  const { url, source } = await resolveComposioPublicUrl();

  if (url) {
    const setup = await ensureComposioProjectWebhook(url);
    return {
      publicUrl: url,
      source,
      webhookRegistered: setup.ok,
      subscribeActive: false,
      error: setup.error,
    };
  }

  await ensureComposioTriggerListener();
  return {
    source: 'none',
    webhookRegistered: false,
    subscribeActive: isComposioTriggerListenerActive(),
    error: LOCAL_TRIGGER_HINT,
  };
}

export async function armRepoPrTrigger(input: {
  userId: string;
  fullName: string;
  connectedAccountId: string;
  hasWebhookScope: boolean;
}): Promise<{
  armed: string[];
  failed: Array<{ slug: string; error: string }>;
  delivery: TriggerDeliveryStatus;
}> {
  const delivery = await ensureComposioTriggerDelivery();
  const armed: string[] = [];
  const failed: Array<{ slug: string; error: string }> = [];

  if (!input.hasWebhookScope) {
    failed.push({ slug: 'GITHUB_PULL_REQUEST_EVENT', error: WEBHOOK_SCOPE_HINT });
    return { armed, failed, delivery };
  }

  if (!delivery.webhookRegistered) {
    failed.push({
      slug: 'GITHUB_PULL_REQUEST_EVENT',
      error: delivery.error || LOCAL_TRIGGER_HINT,
    });
    return { armed, failed, delivery };
  }

  const result = await armHealTriggers(
    input.userId,
    ['prOpened'],
    input.fullName,
    input.connectedAccountId
  );
  return { armed: result.armed, failed: result.failed, delivery };
}

/** On startup: register webhook (ngrok/env) and re-arm enrolled repos. */
export async function bootstrapComposioTriggers(): Promise<void> {
  if (!isComposioConfigured()) return;

  const delivery = await ensureComposioTriggerDelivery();
  if (delivery.webhookRegistered && delivery.publicUrl) {
    console.info(
      `[composio] project webhook → ${delivery.publicUrl}/api/webhooks/composio (${delivery.source})`
    );
  } else if (delivery.subscribeActive) {
    console.info('[composio] websocket subscribe active (run npm run tunnel, restart dev, then Watch PRs)');
  }

  const enrolled = await listEnrolledRepos();
  const watching = enrolled.filter((r) => r.watchPrs);
  if (watching.length === 0 || !delivery.webhookRegistered) return;

  for (const repo of watching) {
    const connection = await getActiveGithubConnection(repo.composioUserId);
    if (!connection) continue;

    const hasScope = githubConnectionHasWebhookScope(connection);
    const { armed, failed } = await armRepoPrTrigger({
      userId: repo.composioUserId,
      fullName: repo.fullName,
      connectedAccountId: connection.id,
      hasWebhookScope: hasScope,
    });

    if (armed.length > 0 || failed.length > 0) {
      await upsertEnrolledRepo({
        fullName: repo.fullName,
        htmlUrl: repo.htmlUrl,
        composioUserId: repo.composioUserId,
        watchPrs: repo.watchPrs,
        autoFix: repo.autoFix,
        triggerArmed: armed.length ? armed : repo.triggerArmed,
        triggerFailed: failed.length ? failed : undefined,
      });
      if (armed.length) {
        console.info(`[composio] re-armed ${repo.fullName}: ${armed.join(', ')}`);
      }
    }
  }
}
