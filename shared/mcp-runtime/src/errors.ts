// Tool-layer error model.
//
// Tools throw these to surface structured failures; the defineTool wrapper
// catches and converts to MCP CallToolResult with isError=true.

export class ToolWatchdogTimeoutError extends Error {
  readonly toolName: string;
  readonly ceilingMs: number;

  constructor(toolName: string, ceilingMs: number) {
    super(`Tool '${toolName}' exceeded its ${ceilingMs}ms watchdog ceiling`);
    this.name = 'ToolWatchdogTimeoutError';
    this.toolName = toolName;
    this.ceilingMs = ceilingMs;
  }
}

export class ToolCancelledError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool '${toolName}' was cancelled by the client`);
    this.name = 'ToolCancelledError';
    this.toolName = toolName;
  }
}

export class SessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session '${sessionId}' not found or no longer active`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

export class SessionTerminatedError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, reason?: string) {
    super(`Session '${sessionId}' has terminated${reason ? `: ${reason}` : ''}`);
    this.name = 'SessionTerminatedError';
    this.sessionId = sessionId;
  }
}

// Caller passed invalid input that schema validation didn't catch (e.g.
// referenced a non-existent session, requested a stream that's not open).
export class InvalidToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidToolInputError';
  }
}
