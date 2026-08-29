export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { bootstrapComposioTriggers } = await import('./lib/composio/webhook-setup.ts');
    bootstrapComposioTriggers().catch((err) => {
      console.error('[instrumentation] composio trigger bootstrap failed', err);
    });
  }
}
