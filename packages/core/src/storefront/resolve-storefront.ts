export interface StorefrontModuleOptions {
  enabled?: boolean;
  port?: number;
  targetUrl?: string;
}

export interface ResolvedStorefront {
  enabled: boolean;
  targetUrl: string;
  port: number;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function portFromUrl(url: string): number {
  try {
    const p = new URL(url).port;
    if (p) return Number(p);
    return url.startsWith('https:') ? 443 : 80;
  } catch {
    return 3000;
  }
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveStorefront(
  opts: StorefrontModuleOptions | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedStorefront {
  const flag = env.OPENCMS_STOREFRONT_ENABLED?.trim().toLowerCase();
  const enabled = flag === 'true' ? true : flag === 'false' ? false : (opts?.enabled ?? true);

  const envUrl = env.OPENCMS_STOREFRONT_URL?.trim();
  const optUrl = opts?.targetUrl?.trim();
  let targetUrl: string;
  let port: number;

  if (envUrl) {
    targetUrl = stripSlash(envUrl);
    port = portFromUrl(targetUrl);
  } else if (optUrl) {
    targetUrl = stripSlash(optUrl);
    port = portFromUrl(targetUrl);
  } else {
    port = parsePort(env.OPENCMS_STOREFRONT_PORT, opts?.port ?? 3000);
    targetUrl = `http://127.0.0.1:${port}`;
  }

  return { enabled, targetUrl, port };
}
