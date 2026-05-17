/**
 * Per-tool watchdog wrapper (plan §17.4).
 *
 * Wraps every handler in `Promise.race([handler, watchdog])` and propagates
 * cancellation from MCP host to the handler's `AbortSignal`. Returns a
 * structured tool-result (`isError: true`) when the ceiling fires rather than
 * throwing, so Claude can read the error message and retry.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { log } from './logger.js';
import { ToolWatchdogTimeout } from './errors.js';

// The MCP SDK doesn't publicly export the exact type of `extra`; we describe
// only the surface we use. Casting at the call boundary keeps this honest
// without depending on internal-package type re-exports.
interface ExtraLike {
  signal: AbortSignal;
  _meta?: Record<string, unknown> | undefined;
  sendNotification?: (n: { method: string; params?: Record<string, unknown> }) => Promise<void>;
}

export type ToolClass = 'instant' | 'quick' | 'long' | 'marathon';

export interface WatchdogConfig {
  name: string;
  ceilingMs: number;
  toolClass: ToolClass;
}

export interface ProgressUpdate {
  progress: number;
  total?: number;
  message?: string;
}

export interface HandlerContext {
  signal: AbortSignal;
  sendProgress: (p: ProgressUpdate) => void;
}

export type WatchedHandler<Args> = (args: Args, ctx: HandlerContext) => Promise<CallToolResult>;

function envCeilingOverride(name: string, fallbackMs: number): number {
  const key = `FLUTTER_ULTRA_TOOL_TIMEOUT_${name.toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return parsed;
}

export function withWatchdog<Args>(
  config: WatchdogConfig,
  handler: WatchedHandler<Args>,
): (args: Args, extra: unknown) => Promise<CallToolResult> {
  return async (args, extraUnknown) => {
    const extra = extraUnknown as ExtraLike;
    const ceilingMs = envCeilingOverride(config.name, config.ceilingMs);
    const controller = new AbortController();

    const onHostAbort = () => controller.abort();
    extra.signal.addEventListener('abort', onHostAbort);

    let watchdogTimer: NodeJS.Timeout | undefined;
    const watchdog = new Promise<CallToolResult>((_resolve, reject) => {
      watchdogTimer = setTimeout(() => {
        controller.abort();
        reject(new ToolWatchdogTimeout(config.name, ceilingMs));
      }, ceilingMs);
    });

    const sendProgress: HandlerContext['sendProgress'] = (p) => {
      const meta = extra._meta;
      const token = meta?.['progressToken'];
      if (token === undefined || token === null) return;
      const params: Record<string, unknown> = {
        progressToken: token as string | number,
        progress: p.progress,
      };
      if (p.total !== undefined) params['total'] = p.total;
      if (p.message !== undefined) params['message'] = p.message;
      extra
        .sendNotification?.({
          method: 'notifications/progress',
          params,
        })
        .catch(() => {
          // Stdio closed — swallow; nothing to do.
        });
    };

    const started = Date.now();
    try {
      return await Promise.race([
        handler(args, { signal: controller.signal, sendProgress }),
        watchdog,
      ]);
    } catch (err) {
      if (err instanceof ToolWatchdogTimeout) {
        log.warn('tool watchdog fired', {
          event: 'watchdog_timeout',
          tool: config.name,
          ceilingMs,
          elapsedMs: Date.now() - started,
        });
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                `Tool '${config.name}' exceeded its ${ceilingMs}ms ceiling. ` +
                'Internal resources were cleaned up. If this is expected for your workload, ' +
                `override via env var FLUTTER_ULTRA_TOOL_TIMEOUT_${config.name.toUpperCase()}=<ms>.`,
            },
          ],
        };
      }
      log.error('tool handler threw', {
        event: 'tool_error',
        tool: config.name,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      extra.signal.removeEventListener('abort', onHostAbort);
    }
  };
}
