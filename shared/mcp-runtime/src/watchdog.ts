// withWatchdog — wraps a tool handler with a hard timeout ceiling and
// cancellation propagation (plan §17.4).
//
// Semantics:
//   - Every tool gets an AbortSignal scoped to the call.
//   - The signal aborts when (a) the watchdog ceiling fires, or
//     (b) the MCP client sends a CancelledNotification.
//   - On timeout the wrapper returns a structured error result instead of
//     letting the handler hang forever.
//   - Per-tool override via env var: FLUTTER_ULTRA_TOOL_TIMEOUT_<NAME_UPPER>.

import { ToolWatchdogTimeoutError } from './errors.js';

export type TimeoutClass = 'instant' | 'quick' | 'long' | 'marathon';

export const DEFAULT_CEILINGS_MS: Record<TimeoutClass, number> = {
  instant: 10_000,
  quick: 30_000,
  long: 55_000, // soft cap below the 60s MCP timeout
  marathon: 55_000, // marathon should use split-tool; this is a defensive fallback
};

export interface WatchdogConfig {
  name: string;
  timeoutClass: TimeoutClass;
  // Optional explicit override; otherwise DEFAULT_CEILINGS_MS[timeoutClass].
  ceilingMs?: number;
}

export interface ProgressUpdate {
  progress: number;
  total?: number;
  message?: string;
}

export interface ToolContext {
  signal: AbortSignal;
  sendProgress(update: ProgressUpdate): void;
}

export type ToolBody<Args, Result> = (args: Args, ctx: ToolContext) => Promise<Result>;

function resolveCeiling(config: WatchdogConfig): number {
  const envKey = `FLUTTER_ULTRA_TOOL_TIMEOUT_${config.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const envOverride = process.env[envKey];
  if (envOverride) {
    const parsed = Number.parseInt(envOverride, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return config.ceilingMs ?? DEFAULT_CEILINGS_MS[config.timeoutClass];
}

// Wraps the supplied body so an AbortController fires after `ceilingMs`
// OR when externalSignal aborts. Whichever happens first.
export async function runWithWatchdog<Args, Result>(
  config: WatchdogConfig,
  args: Args,
  externalSignal: AbortSignal | undefined,
  sendProgress: (update: ProgressUpdate) => void,
  body: ToolBody<Args, Result>,
): Promise<Result> {
  const ceilingMs = resolveCeiling(config);
  const controller = new AbortController();

  const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const watchdog = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      controller.abort(new ToolWatchdogTimeoutError(config.name, ceilingMs));
      reject(new ToolWatchdogTimeoutError(config.name, ceilingMs));
    }, ceilingMs);
    // unref so the watchdog timer doesn't keep the process alive after
    // the handler resolves normally.
    timer.unref?.();
    controller.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
      },
      { once: true },
    );
  });

  try {
    return await Promise.race([body(args, { signal: controller.signal, sendProgress }), watchdog]);
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
