// Editor tools: get_active_location — reads the IDE cursor position via DTD.
//
// The Dart Tooling Daemon (DTD) exposes a `getActiveLocation` RPC that returns
// the editor's current cursor position (file URI, line, column). This is the
// same mechanism used by `dart mcp-server` to provide editor context.
//
// DTD is started automatically by VS Code (Dart extension) and IntelliJ.
// It is NOT available when the user launched Flutter from a terminal without
// an IDE open.

import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { FlutterUltraServer } from '@flutter-ultra/mcp-runtime';
import { findDartSdkPath, parseDtdList } from '../discovery.js';

const exec = promisify(execCb);

// Result shape returned by DTD's getActiveLocation RPC.
interface DtdActiveLocationResult {
  uri?: string;
  line?: number;
  column?: number;
}

interface ActiveLocationResponse {
  result?: DtdActiveLocationResult;
  error?: { code: number; message: string };
}

/**
 * Connect to a DTD instance and call getActiveLocation.
 * Returns null if the DTD does not respond, times out, or returns an error.
 */
async function queryDtdActiveLocation(
  dtdUri: string,
  timeoutMs: number,
): Promise<DtdActiveLocationResult | null> {
  const { WebSocket } = await import('ws');
  return new Promise<DtdActiveLocationResult | null>((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve(null);
    }, timeoutMs);

    const ws = new WebSocket(dtdUri);

    ws.on('error', () => {
      clearTimeout(timer);
      ws.close();
      resolve(null);
    });

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getActiveLocation',
          params: {},
        }),
      );
    });

    ws.on('message', (data: Buffer | string) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(data.toString()) as ActiveLocationResponse;
        ws.close();
        if (msg.error || !msg.result) {
          resolve(null);
          return;
        }
        resolve(msg.result);
      } catch {
        ws.close();
        resolve(null);
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
    });
  });
}

/**
 * Convert a file:// URI to a local filesystem path.
 * e.g. file:///D:/projects/foo/bar.dart → D:\projects\foo\bar.dart (Windows)
 *      file:///home/user/foo/bar.dart   → /home/user/foo/bar.dart  (Unix)
 */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  const withoutScheme = uri.slice('file://'.length);
  if (process.platform === 'win32') {
    // file:///D:/path → /D:/path → D:\path
    const unixStyle = withoutScheme.startsWith('/') ? withoutScheme.slice(1) : withoutScheme;
    return unixStyle.replace(/\//g, '\\');
  }
  // Unix: file:///home/... → /home/...
  return withoutScheme.startsWith('/') ? withoutScheme : `/${withoutScheme}`;
}

const DTD_TIMEOUT_MS = 3_000;

export function registerEditorTools(opts: { server: FlutterUltraServer }): void {
  const { server } = opts;

  server.defineTool(
    {
      name: 'get_active_location',
      description:
        "Get the active cursor location from the user's IDE (VS Code, IntelliJ) via the Dart " +
        'Tooling Daemon. Returns the file path, line number, and column of the current cursor ' +
        'position. Requires the IDE to have a DTD instance running (automatic in VS Code with ' +
        'the Dart extension). Returns an error when no IDE is open or no DTD instances are found.',
      inputShape: {},
      timeoutClass: 'quick',
      ceilingMs: 5_000,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const log = server.logger.child({ component: 'editor' });

      // Step 1: find DTD instances via `dart tooling-daemon --list`
      const dartPath = await findDartSdkPath();
      if (!dartPath) {
        return {
          ok: false,
          error: 'Dart SDK not found in PATH. Is Dart installed and on your PATH?',
        };
      }

      let stdout: string;
      try {
        const result = await exec(`"${dartPath}" tooling-daemon --list`, { timeout: 8_000 });
        stdout = result.stdout;
      } catch (err) {
        log.debug('get_active_location: dart tooling-daemon --list failed', { err: String(err) });
        return {
          ok: false,
          error:
            'No DTD instances found. Open a Dart/Flutter project in VS Code or IntelliJ to start the Dart Tooling Daemon.',
        };
      }

      const dtdInstances = parseDtdList(stdout);
      if (dtdInstances.length === 0) {
        return {
          ok: false,
          error:
            'No DTD instances found. Open a Dart/Flutter project in VS Code or IntelliJ to start the Dart Tooling Daemon.',
        };
      }

      log.debug('get_active_location: querying DTD instances', { count: dtdInstances.length });

      // Step 2: try each DTD instance, return the first successful response
      for (const dtd of dtdInstances) {
        const location = await queryDtdActiveLocation(dtd.uri, DTD_TIMEOUT_MS);
        if (!location) continue;

        const uri = location.uri ?? '';
        const filePath = uri ? fileUriToPath(uri) : '';

        // DTD returns 0-based line and column numbers (same as LSP convention).
        // We expose them as-is and document this in the response.
        return {
          ok: true,
          uri,
          filePath,
          line: location.line ?? 0,
          column: location.column ?? 0,
          note: 'Line and column are 0-based (LSP convention). Add 1 for display.',
          dtdUri: dtd.uri,
        };
      }

      return {
        ok: false,
        error:
          'All DTD instances were reachable but none returned an active location. ' +
          'Make sure a file is open and the cursor is placed in your IDE.',
      };
    },
  );
}
