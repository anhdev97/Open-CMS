import { Logger } from '@nestjs/common';
import type { OAuth2Config, Ttls } from '../config/schema';

export interface AuthSettingsProvider {
  getTtls(): Promise<Ttls>;
}

export class ConfigAuthSettingsProvider implements AuthSettingsProvider {
  private readonly ttls: Ttls;

  constructor(config: Pick<OAuth2Config, 'ttl'>, logger: { warn(msg: string): void } = new Logger('OAuth2')) {
    const ttl = { ...config.ttl };
    if (ttl.refreshToken > ttl.sessionAbsolute) {
      logger.warn(
        `auth refreshToken TTL (${ttl.refreshToken}s) exceeds sessionAbsolute (${ttl.sessionAbsolute}s); using ${ttl.sessionAbsolute}s`,
      );
      ttl.refreshToken = ttl.sessionAbsolute;
    }
    this.ttls = ttl;
  }

  async getTtls(): Promise<Ttls> {
    return { ...this.ttls };
  }
}
