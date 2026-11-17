import { createHash, randomBytes } from 'node:crypto';

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const TOKEN_BYTES = 6;

interface PendingConfirmation {
  fingerprint: string;
  expiresAt: number;
}

/**
 * Single-use tokens that tie a confirmed action to the exact arguments the
 * user was shown. Tokens live only in this server process.
 */
export class ConfirmationStore {
  private readonly pending = new Map<string, PendingConfirmation>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(fingerprint: string): string {
    this.prune();
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    this.pending.set(token, { fingerprint, expiresAt: this.now() + CONFIRMATION_TTL_MS });
    return token;
  }

  consume(token: string, fingerprint: string): void {
    this.prune();
    const entry = this.pending.get(token);
    if (!entry) {
      throw new Error('confirmation_token is invalid or has expired. Call again without it to request a new confirmation.');
    }
    if (entry.fingerprint !== fingerprint) {
      throw new Error(
        'confirmation_token was issued for a different space, title or status. Call again without it to request a new confirmation.',
      );
    }
    this.pending.delete(token);
  }

  private prune(): void {
    const now = this.now();
    for (const [token, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(token);
    }
  }
}

export function fingerprintOf(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}
