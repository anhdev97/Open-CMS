import { execFileSync } from 'node:child_process';
import type * as http from 'node:http';

/** If Nest/Next graceful shutdown stalls (open HMR sockets, hung next.close), force exit. */
export const SHUTDOWN_HARD_EXIT_MS = 4_000;

let hardDeadlineInstalled = false;

/** Test-only: allow re-installing the hard deadline in unit tests. */
export function resetHardShutdownDeadlineForTests(): void {
  hardDeadlineInstalled = false;
}

/** SIGKILL direct children of this process (Next Turbopack/PostCSS / esbuild). No-op on Windows. */
export function killDirectChildProcesses(): void {
  if (process.platform === 'win32') return;
  let out: string;
  try {
    out = execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
  } catch {
    return;
  }
  for (const line of out.split('\n')) {
    const pid = Number(line.trim());
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already exited
    }
  }
}

/**
 * On the first SIGINT/SIGTERM, start a hard deadline. Nest's enableShutdownHooks run in parallel;
 * if they hang (HTTP `close()` waiting on keep-alive/HMR, or Next cleanup), we still exit.
 */
export function installHardShutdownDeadline(ms = SHUTDOWN_HARD_EXIT_MS): void {
  if (hardDeadlineInstalled) return;
  hardDeadlineInstalled = true;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      const code = sig === 'SIGINT' ? 130 : 143;
      setTimeout(() => {
        killDirectChildProcesses();
        process.exit(code);
      }, ms).unref();
    });
  }
}

/** Drop keep-alive and WebSocket clients so Nest's `server.close()` does not hang. */
export function forceCloseHttpConnections(server: http.Server | undefined): void {
  if (!server) return;
  const anyServer = server as http.Server & { closeAllConnections?: () => void };
  if (typeof anyServer.closeAllConnections === 'function') {
    anyServer.closeAllConnections();
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
