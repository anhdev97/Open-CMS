import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { OAuth2Config } from '../config/schema';
import { OAUTH2_CONFIG } from '../constants';
import { AuthError } from '../errors';
import { normalizeEmail } from '../security/email';
import { PasswordService } from '../security/password';
import { SUPER_ADMIN_GROUP } from '../permissions';
import { UserService } from '../users/user.service';

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export interface BootstrapLogger {
  log(msg: string): void;
  warn(msg: string): void;
}

@Injectable()
export class BootstrapService {
  private readonly logger: BootstrapLogger;

  constructor(
    @Inject(OAUTH2_CONFIG) private readonly cfg: OAuth2Config,
    @Inject(UserService) private readonly users: UserService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() logger?: BootstrapLogger,
  ) {
    this.logger = logger ?? new Logger('OAuth2');
  }

  /** Spec §6.1 steps 4-6. Throws BootstrapError to refuse startup. */
  async run(): Promise<void> {
    const { email, password, forceReset } = this.cfg.admin;
    if (email && password) {
      if (forceReset) await this.forceReset(normalizeEmail(email), password);
      else await this.seed(normalizeEmail(email), password);
    }
    if ((await this.users.countUsers()) === 0) {
      this.logger.warn(
        `Chưa có tài khoản admin. Mở ${this.cfg.publicUrl}/admin/setup để tạo. Bất kỳ ai truy cập được URL này trước sẽ trở thành admin.`,
      );
    }
  }

  private wrap(e: unknown): never {
    if (e instanceof AuthError) throw new BootstrapError(`Admin bootstrap failed (${e.code}): ${e.message}`);
    throw e;
  }

  private async seed(email: string, password: string): Promise<void> {
    let seeded = false;
    try {
      await this.users.withSetupLock(async (trx) => {
        if ((await this.users.countUsers(trx)) > 0) return;
        const u = await this.users.create(
          { email, name: this.cfg.admin.name ?? 'Admin', password },
          trx,
        );
        await this.audit.record({ type: 'admin_seeded_from_env', userId: u.id, meta: { email } }, trx);
        seeded = true;
      });
    } catch (e) {
      this.wrap(e);
    }
    if (seeded) this.logger.log(`Seeded admin ${email} from environment.`);
    else this.logger.log('OPENCLOUDCMS_ADMIN_EMAIL/OPENCLOUDCMS_ADMIN_PASSWORD ignored: users already exist.');
  }

  private async forceReset(email: string, password: string): Promise<void> {
    try {
      await this.users.withSetupLock(async (trx) => {
        const user = await this.users.findByEmail(email, trx);
        if (!user) throw new BootstrapError(`OPENCLOUDCMS_ADMIN_FORCE_RESET: user ${email} does not exist`);
        await this.users.setPassword(user.id, password, trx);
        await trx
          .updateTable('auth_users')
          .set({ status: 'active', updated_at: new Date() })
          .where('id', '=', user.id)
          .execute();
        await sql`insert into auth_user_groups (user_id, group_id) select ${user.id}, id from auth_groups where key = ${SUPER_ADMIN_GROUP} on conflict do nothing`.execute(
          trx,
        );
        await this.users.revokeAll(user.id, undefined, trx);
        await this.audit.record({ type: 'admin_force_reset', userId: user.id, meta: { email } }, trx);
      });
    } catch (e) {
      this.wrap(e);
    }
    this.logger.warn(
      `Admin ${email} was force-reset from environment. Remove OPENCLOUDCMS_ADMIN_FORCE_RESET (and the password variable) now, or it will reset on every boot.`,
    );
  }
}
