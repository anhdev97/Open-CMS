import { AuthError } from '../errors';

export function assertSameOrigin(originHeader: string | undefined, publicUrl: string): void {
  try {
    if (originHeader && new URL(originHeader).origin === new URL(publicUrl).origin) return;
  } catch {
    /* fall through */
  }
  throw new AuthError('origin_mismatch', 403, 'Origin not allowed');
}
