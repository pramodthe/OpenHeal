/**
 * Local-dev trigger delivery via Composio Pusher subscribe (no public URL needed).
 * Trigger instances must still be armed; events route through the project subscription.
 */
import { isComposioConfigured } from './client.ts';
import { handleComposioTriggerPayload } from './handle-trigger.ts';

let started = false;
let starting: Promise<void> | null = null;

export function isComposioTriggerListenerActive(): boolean {
  return started;
}

/** Idempotent — safe to call from enroll, instrumentation, or webhook routes. */
export function ensureComposioTriggerListener(): Promise<void> {
  if (started) return Promise.resolve();
  if (starting) return starting;

  starting = (async () => {
    if (!isComposioConfigured()) return;

    const publicUrl = process.env.OPENHEAL_PUBLIC_URL?.trim();
    const { resolveComposioPublicUrl } = await import('./webhook-setup.ts');
    const resolved = await resolveComposioPublicUrl();
    if (resolved.url || publicUrl) {
      // HTTPS webhook delivery (production or ngrok) — no duplicate Pusher stream.
      return;
    }

    try {
      const { getComposio } = await import('./client.ts');
      const composio = getComposio();
      await composio.triggers.subscribe(async (data) => {
        const payload =
          data && typeof data === 'object' ? (data as Record<string, unknown>) : { data };
        const result = await handleComposioTriggerPayload(payload, { useAfter: false });
        if (result.acted) {
          console.info('[composio-subscribe] started run', result.sessionId, result.repo);
        }
      });
      started = true;
      console.info('[composio-subscribe] listening for trigger events (local websocket)');
    } catch (err) {
      console.error('[composio-subscribe] failed to start', err);
    } finally {
      starting = null;
    }
  })();

  return starting;
}
