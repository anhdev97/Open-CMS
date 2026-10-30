import { describe, expect, it } from 'vitest';
import { classifyHealth } from '../../src/sso-management/provider-health.service';

describe('SSO health classification', () => {
  it('starts unknown then healthy after first successful discovery', () => {
    expect(classifyHealth(0, 1, 'UNKNOWN')).toBe('HEALTHY');
  });

  it('is degraded after 1–2 technical failures and unavailable after 3', () => {
    expect(classifyHealth(1, 0, 'HEALTHY')).toBe('DEGRADED');
    expect(classifyHealth(2, 0, 'DEGRADED')).toBe('DEGRADED');
    expect(classifyHealth(3, 0, 'DEGRADED')).toBe('UNAVAILABLE');
  });

  it('needs two successful probes to recover from a degraded or unavailable state', () => {
    expect(classifyHealth(0, 1, 'UNAVAILABLE')).toBe('DEGRADED');
    expect(classifyHealth(0, 1, 'DEGRADED')).toBe('DEGRADED');
    expect(classifyHealth(0, 2, 'DEGRADED')).toBe('HEALTHY');
    expect(classifyHealth(0, 2, 'UNAVAILABLE')).toBe('HEALTHY');
  });
});
