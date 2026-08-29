import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';

export const COMPOSIO_USER_COOKIE = 'openheal_composio_user';

export async function ensureComposioUserId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COMPOSIO_USER_COOKIE)?.value?.trim();
  if (existing && /^oh_[a-f0-9]{16,64}$/.test(existing)) return existing;

  const userId = `oh_${randomBytes(16).toString('hex')}`;
  jar.set(COMPOSIO_USER_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 400,
    secure: process.env.NODE_ENV === 'production',
  });
  return userId;
}
