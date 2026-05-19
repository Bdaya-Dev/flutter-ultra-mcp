// Runtime diagnostics collector + dump_diagnostics tool factory.
//
// Usage:
//   const collector = new DiagnosticsCollector();
//   // wrap defineTool calls to record:
//   collector.recordToolCall('my_tool');
//   // expose the tool:
//   server.defineTool(createDiagnosticsTool(collector), async () => collector.snapshot());

export interface DiagnosticsSnapshot {
  uptimeMs: number;
  pid: number;
  memoryMb: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  toolCallCounts: Record<string, number>;
  totalToolCalls: number;
}

export class DiagnosticsCollector {
  private readonly toolCallCounts = new Map<string, number>();
  private readonly startedAt: number;

  constructor(now?: () => number) {
    this.startedAt = (now ?? Date.now)();
  }

  recordToolCall(name: string): void {
    this.toolCallCounts.set(name, (this.toolCallCounts.get(name) ?? 0) + 1);
  }

  snapshot(): DiagnosticsSnapshot {
    const mem = process.memoryUsage();
    const counts = Object.fromEntries(this.toolCallCounts);
    const total = [...this.toolCallCounts.values()].reduce((a, b) => a + b, 0);
    return {
      uptimeMs: Date.now() - this.startedAt,
      pid: process.pid,
      memoryMb: {
        rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        external: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      },
      toolCallCounts: counts,
      totalToolCalls: total,
    };
  }
}

// Returns a DefineToolConfig-compatible descriptor for use with
// FlutterUltraServer.defineTool().
export function createDiagnosticsTool(collector: DiagnosticsCollector) {
  return {
    name: 'dump_diagnostics',
    description:
      'Returns runtime statistics for this MCP server: uptime, memory usage, per-tool call counts, and PID. Useful for observability and debugging.',
    timeoutClass: 'instant' as const,
    annotations: {
      title: 'Dump Diagnostics',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  } as const;
}
