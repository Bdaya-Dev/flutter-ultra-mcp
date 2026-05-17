export class ToolWatchdogTimeout extends Error {
  constructor(
    public readonly toolName: string,
    public readonly ceilingMs: number,
  ) {
    super(`Tool '${toolName}' exceeded its ${ceilingMs}ms ceiling.`);
    this.name = 'ToolWatchdogTimeout';
  }
}

export class FlutterCliMissingError extends Error {
  constructor(public readonly cli: 'dart' | 'flutter') {
    super(
      `Required CLI '${cli}' not found on PATH. Install from https://dart.dev / https://flutter.dev and retry.`,
    );
    this.name = 'FlutterCliMissingError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly root: string) {
    super(`No Flutter/Dart project (pubspec.yaml) found at or above '${root}'.`);
    this.name = 'ProjectNotFoundError';
  }
}
