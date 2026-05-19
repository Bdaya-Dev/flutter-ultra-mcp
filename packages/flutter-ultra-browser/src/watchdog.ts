// Per-tool watchdog wrapper (plan §17.4). Local copy until
// @flutter-ultra/mcp-runtime is published; the contract here matches plan
// §17.4 exactly so the eventual shared import is a drop-in swap.

import { log } from './logger.js';

export type ToolTimeoutClass = 'instant' | 'quick' | 'long' | 'marathon';

export interface ToolMeta {
  name: string;
  ceilingMs: number;
  class: ToolTimeoutClass;
}

export interface ProgressUpdate {
  progress: number;
  total?: number;
  message?: string;
}

export interface ToolContext {
  signal: AbortSignal;
  sendProgress: (p: ProgressUpdate) => void;
}

export class ToolWatchdogTimeout extends Error {
  constructor(
    public toolName: string,
    public ceilingMs: number,
  ) {
    super(`Tool '${toolName}' exceeded ${ceilingMs}ms ceiling`);
    this.name = 'ToolWatchdogTimeout';
  }
}

export interface ToolReturn {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  structuredContent?: unknown;
  isError?: boolean;
}

type ProgressFn = (p: ProgressUpdate) => void;

const noopProgress: ProgressFn = () => {};

function envOverrideMs(toolName: string): number | undefined {
  const envKey = `FLUTTER_ULTRA_TOOL_TIMEOUT_${toolName.toUpperCase()}`;
  const raw = process.env[envKey];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function applyMultiplier(base: number): number {
  const raw = process.env['FLUTTER_ULTRA_TIMEOUT_MULTIPLIER'];
  if (!raw) return base;
  const mult = Number.parseFloat(raw);
  if (!Number.isFinite(mult) || mult <= 0) return base;
  return Math.round(base * mult);
}

export function withWatchdog<Args, Result extends ToolReturn>(
  meta: ToolMeta,
  handler: (args: Args, ctx: ToolContext) => Promise<Result>,
): (args: Args, ctx?: Partial<ToolContext>) => Promise<Result> {
  return async (args, ctx) => {
    const perToolOverride = envOverrideMs(meta.name);
    const ceilingMs = perToolOverride !== undefined ? perToolOverride : applyMultiplier(meta.ceilingMs);

    const controller = new AbortController();
    const upstream = ctx?.signal;
    if (upstream) {
      if (upstream.aborted) {
        controller.abort();
      } else {
        upstream.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    const sendProgress = ctx?.sendProgress ?? noopProgress;

    let timeoutHandle: NodeJS.Timeout | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new ToolWatchdogTimeout(meta.name, ceilingMs));
      }, ceilingMs);
    });

    const start = Date.now();
    try {
      const result = await Promise.race([
        handler(args, { signal: controller.signal, sendProgress }),
        watchdog,
      ]);
      log.debug('tool_ok', { tool: meta.name, ms: Date.now() - start });
      return result;
    } catch (err) {
      if (err instanceof ToolWatchdogTimeout) {
        log.warn('tool_watchdog_timeout', { tool: meta.name, ceilingMs });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Tool '${meta.name}' exceeded its ${ceilingMs}ms ceiling. Internal resources cleaned up. Override via FLUTTER_ULTRA_TOOL_TIMEOUT_${meta.name.toUpperCase()}.`,
            },
          ],
          isError: true,
        } as Result;
      }
      throw err;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };
}
