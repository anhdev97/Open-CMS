import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthError } from '../errors';

const MAX_LENGTH = 256;

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  constructor(private readonly opts: { minLength: number }) {}

  validate(password: string, email: string): void {
    const len = [...password].length;
    if (len < this.opts.minLength) {
      throw new AuthError('weak_password', 422, `Password must be at least ${this.opts.minLength} characters`);
    }
    if (len > MAX_LENGTH) {
      throw new AuthError('weak_password', 422, `Password must be at most ${MAX_LENGTH} characters`);
    }
    if (password.toLowerCase() === email.trim().toLowerCase()) {
      throw new AuthError('weak_password', 422, 'Password must not equal the email');
    }
  }

  hash(p: string): Promise<string> {
    return argon2.hash(p, { type: argon2.argon2id });
  }

  async verify(hash: string, p: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, p);
    } catch {
      return false;
    }
  }

  /** Burns comparable time against a cached hash when the account does not exist. */
  async verifyDummy(p: string): Promise<false> {
    this.dummyHash ??= this.hash('opencms-dummy-password');
    await this.verify(await this.dummyHash, p);
    return false;
  }
}
