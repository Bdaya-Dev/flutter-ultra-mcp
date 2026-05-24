/**
 * LSP integration tools — hover, signature help, workspace symbols, go-to-definition.
 *
 * Manages a singleton Dart analysis server (dart language-server --protocol=lsp)
 * per workspace root. The server is lazy-started on first tool call, kept alive
 * across calls, and auto-restarted if the process dies.
 *
 * LSP wire format: Content-Length framing over stdio.
 * All positions: tools accept 1-based line/column (developer convention),
 * converted to 0-based for LSP protocol calls.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTool } from './register.js';
import { okJson, err, errFromException } from '../runtime/result.js';
import { resolveCli } from '../util/cli.js';

// ─── LSP message framing ─────────────────────────────────────────────────────

function encodeMessage(body: unknown): Buffer {
  const json = JSON.stringify(body);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(json, 'utf8')]);
}

interface ParseResult {
  message: unknown;
  consumed: number;
}

function tryParseMessage(buf: Buffer): ParseResult | null {
  const str = buf.toString('utf8');
  const headerEnd = str.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;
  const header = str.slice(0, headerEnd);
  const m = header.match(/Content-Length:\s*(\d+)/i);
  if (!m || !m[1]) return null;
  const length = Number(m[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + length;
  if (buf.length < bodyEnd) return null;
  const bodyStr = buf.slice(bodyStart, bodyEnd).toString('utf8');
  return {
    message: JSON.parse(bodyStr) as unknown,
    consumed: bodyEnd,
  };
}

// ─── Analysis server singleton ────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const INIT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

export class DartAnalysisServer {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private initialized = false;
  private initializing = false;
  private initPromise: Promise<void> | null = null;
  private rawBuf = Buffer.alloc(0);
  private workspaceRoot = '';
  private openedFiles = new Set<string>();

  async ensureRunning(workspaceRoot: string): Promise<void> {
    // If already initialized for this workspace, nothing to do.
    if (this.process && this.initialized && this.workspaceRoot === workspaceRoot) return;

    // If switching workspace, dispose and reinitialize.
    if (this.workspaceRoot && this.workspaceRoot !== workspaceRoot) {
      this.dispose();
    }

    // Deduplicate concurrent initialization calls.
    if (this.initializing && this.initPromise) return this.initPromise;

    this.initializing = true;
    this.initPromise = this._initialize(workspaceRoot).finally(() => {
      this.initializing = false;
    });
    return this.initPromise;
  }

  private async _initialize(workspaceRoot: string): Promise<void> {
    this.workspaceRoot = workspaceRoot;
    this.openedFiles = new Set();

    const dart = resolveCli('dart');
    const proc = spawn(dart, ['language-server', '--protocol=lsp'], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process = proc;

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.rawBuf = Buffer.concat([this.rawBuf, chunk]);
      this._drainBuffer();
    });

    proc.stderr!.on('data', () => {
      // Swallow stderr — analysis server logs go there, not useful for callers.
    });

    proc.on('exit', () => {
      this.process = null;
      this.initialized = false;
      this.initPromise = null;
      // Reject all pending requests.
      for (const { reject } of this.pending.values()) {
        reject(new Error('Dart analysis server exited unexpectedly'));
      }
      this.pending.clear();
    });

    // Send LSP initialize request.
    const rootUri = pathToFileURL(workspaceRoot).href;
    const initResult = await this._sendRequest(
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'flutter-ultra-build', version: '0.0.0' },
        rootUri,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['plaintext'] },
            signatureHelp: {},
            definition: {},
          },
          workspace: {
            symbol: {},
          },
        },
        initializationOptions: {},
      },
      INIT_TIMEOUT_MS,
    );

    if (!initResult) throw new Error('LSP initialize returned null');

    // Send initialized notification (no response expected).
    this._notify('initialized', {});
    this.initialized = true;
  }

  private _drainBuffer(): void {
     
    while (true) {
      const result = tryParseMessage(this.rawBuf);
      if (!result) break;
      this.rawBuf = this.rawBuf.slice(result.consumed);
      this._handleMessage(result.message);
    }
  }

  private _handleMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as Record<string, unknown>;
    const id = m['id'];
    if (id !== undefined && id !== null) {
      const pending = this.pending.get(id as number);
      if (pending) {
        this.pending.delete(id as number);
        if (m['error']) {
          pending.reject(new Error(JSON.stringify(m['error'])));
        } else {
          pending.resolve(m['result']);
        }
      }
    }
    // Notifications (no id) are silently ignored.
  }

  private _sendRequest(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    const message = { jsonrpc: '2.0', id, method, params };
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Clear timer when resolved/rejected.
      const originalResolve = resolve;
      const originalReject = reject;
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); originalResolve(v); },
        reject: (e) => { clearTimeout(timer); originalReject(e); },
      });

      const buf = encodeMessage(message);
      this.process!.stdin!.write(buf);
    });
  }

  private _notify(method: string, params: unknown): void {
    const message = { jsonrpc: '2.0', method, params };
    const buf = encodeMessage(message);
    this.process?.stdin?.write(buf);
  }

  async ensureFileOpen(filePath: string): Promise<void> {
    if (this.openedFiles.has(filePath)) return;
    let text = '';
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      // File may not exist — open with empty content so the server doesn't crash.
    }
    const uri = pathToFileURL(filePath).href;
    this._notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'dart',
        version: 1,
        text,
      },
    });
    this.openedFiles.add(filePath);
  }

  async hover(filePath: string, line: number, character: number): Promise<unknown> {
    await this.ensureFileOpen(filePath);
    const uri = pathToFileURL(filePath).href;
    return this._sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async signatureHelp(filePath: string, line: number, character: number): Promise<unknown> {
    await this.ensureFileOpen(filePath);
    const uri = pathToFileURL(filePath).href;
    return this._sendRequest('textDocument/signatureHelp', {
      textDocument: { uri },
      position: { line, character },
      context: { triggerKind: 1 },
    });
  }

  async workspaceSymbols(query: string): Promise<unknown> {
    return this._sendRequest('workspace/symbol', { query });
  }

  async definition(filePath: string, line: number, character: number): Promise<unknown> {
    await this.ensureFileOpen(filePath);
    const uri = pathToFileURL(filePath).href;
    return this._sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  dispose(): void {
    this.initialized = false;
    this.initPromise = null;
    this.openedFiles = new Set();
    for (const { reject } of this.pending.values()) {
      reject(new Error('DartAnalysisServer disposed'));
    }
    this.pending.clear();
    if (this.process) {
      try { this.process.kill(); } catch { /* ignore */ }
      this.process = null;
    }
  }
}

// ─── Singleton instance ──────────────────────────────────────────────────────

let _server: DartAnalysisServer | null = null;

function getServer(): DartAnalysisServer {
  if (!_server) _server = new DartAnalysisServer();
  return _server;
}

// Clean up on process exit.
process.on('exit', () => { _server?.dispose(); });
process.on('SIGTERM', () => { _server?.dispose(); });
process.on('SIGINT', () => { _server?.dispose(); });

// ─── Shared input schemas ────────────────────────────────────────────────────

const filePositionSchema = {
  filePath: z
    .string()
    .min(1)
    .describe('Absolute path to the Dart/Flutter source file.'),
  line: z
    .number()
    .int()
    .min(1)
    .describe('1-based line number.'),
  column: z
    .number()
    .int()
    .min(1)
    .describe('1-based column number.'),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatHoverResult(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'No hover information available.';
  const r = raw as Record<string, unknown>;
  const contents = r['contents'];
  if (!contents) return 'No hover information available.';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === 'string' ? c : (c as Record<string, unknown>)['value'] ?? ''))
      .filter(Boolean)
      .join('\n\n');
  }
  if (typeof contents === 'object') {
    const c = contents as Record<string, unknown>;
    return String(c['value'] ?? c['language'] ?? JSON.stringify(contents));
  }
  return JSON.stringify(raw);
}

function formatSignatureHelp(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return { signatures: [], activeSignature: 0, activeParameter: 0 };
  }
  const r = raw as Record<string, unknown>;
  const signatures = (r['signatures'] as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    activeSignature: r['activeSignature'] ?? 0,
    activeParameter: r['activeParameter'] ?? 0,
    signatures: signatures.map((sig) => ({
      label: sig['label'] ?? '',
      documentation: sig['documentation'] ?? null,
      parameters: (sig['parameters'] as Array<Record<string, unknown>> | undefined)?.map((p) => ({
        label: p['label'] ?? '',
        documentation: p['documentation'] ?? null,
      })) ?? [],
    })),
  };
}

interface SymbolInfo {
  name: string;
  kind: number;
  kindName: string;
  location: { uri: string; range: unknown };
  containerName?: string;
}

const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
  6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
  11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant',
  15: 'String', 16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object',
  20: 'Key', 21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event',
  25: 'Operator', 26: 'TypeParameter',
};

function formatWorkspaceSymbols(raw: unknown, maxResults: number): SymbolInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, maxResults).map((sym) => {
    const s = sym as Record<string, unknown>;
    const kind = Number(s['kind'] ?? 0);
    const base: SymbolInfo = {
      name: String(s['name'] ?? ''),
      kind,
      kindName: SYMBOL_KIND_NAMES[kind] ?? 'Unknown',
      location: s['location'] as { uri: string; range: unknown },
    };
    if (s['containerName']) base.containerName = String(s['containerName']);
    return base;
  });
}

function formatDefinition(raw: unknown): Array<{ uri: string; range: unknown }> {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((loc) => {
      const l = loc as Record<string, unknown>;
      return { uri: String(l['uri'] ?? ''), range: l['range'] };
    });
  }
  if (typeof raw === 'object') {
    const l = raw as Record<string, unknown>;
    return [{ uri: String(l['uri'] ?? ''), range: l['range'] }];
  }
  return [];
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer): void {
  // dart_hover
  defineTool<{ filePath: string; line: number; column: number }>(server, {
    name: 'dart_hover',
    description:
      'Get type information and documentation at a position in a Dart/Flutter file. ' +
      'Uses the Dart analysis server (LSP). Returns the hover content as plain text.',
    inputSchema: filePositionSchema,
    watchdog: { name: 'dart_hover', ceilingMs: 20_000, toolClass: 'quick' },
    handler: async ({ filePath, line, column }, _ctx) => {
      try {
        if (!existsSync(filePath)) {
          return err(`File not found: ${filePath}`);
        }
        const srv = getServer();
        // Determine workspace root — walk up to find pubspec.yaml or use file's directory.
        const workspaceRoot = resolveWorkspaceRoot(filePath);
        await srv.ensureRunning(workspaceRoot);
        const raw = await srv.hover(filePath, line - 1, column - 1);
        return okJson({
          filePath,
          line,
          column,
          hover: formatHoverResult(raw),
        });
      } catch (e) {
        return errFromException(
          e,
          'Ensure dart is installed and the file is part of a valid Dart/Flutter project.',
        );
      }
    },
  });

  // dart_signature_help
  defineTool<{ filePath: string; line: number; column: number }>(server, {
    name: 'dart_signature_help',
    description:
      'Get function/method signature help (parameter info) at a call site in a Dart/Flutter file. ' +
      'Returns the active signature, active parameter, and all overloads.',
    inputSchema: filePositionSchema,
    watchdog: { name: 'dart_signature_help', ceilingMs: 20_000, toolClass: 'quick' },
    handler: async ({ filePath, line, column }, _ctx) => {
      try {
        if (!existsSync(filePath)) {
          return err(`File not found: ${filePath}`);
        }
        const srv = getServer();
        const workspaceRoot = resolveWorkspaceRoot(filePath);
        await srv.ensureRunning(workspaceRoot);
        const raw = await srv.signatureHelp(filePath, line - 1, column - 1);
        return okJson({
          filePath,
          line,
          column,
          signatureHelp: formatSignatureHelp(raw),
        });
      } catch (e) {
        return errFromException(
          e,
          'Ensure dart is installed and the file is part of a valid Dart/Flutter project.',
        );
      }
    },
  });

  // dart_workspace_symbols
  defineTool<{ query: string; workspaceRoot: string; maxResults?: number }>(server, {
    name: 'dart_workspace_symbols',
    description:
      'Search for symbols (classes, functions, methods, enums, etc.) across the workspace. ' +
      'Returns name, kind, and location for each matching symbol.',
    inputSchema: {
      query: z.string().describe('Symbol name or prefix to search for.'),
      workspaceRoot: z
        .string()
        .min(1)
        .describe('Absolute path to the Flutter/Dart project root.'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(20)
        .describe('Maximum number of results to return (default 20, max 200).'),
    },
    watchdog: { name: 'dart_workspace_symbols', ceilingMs: 30_000, toolClass: 'quick' },
    handler: async ({ query, workspaceRoot, maxResults }, _ctx) => {
      try {
        const srv = getServer();
        await srv.ensureRunning(workspaceRoot);
        const raw = await srv.workspaceSymbols(query);
        const symbols = formatWorkspaceSymbols(raw, maxResults ?? 20);
        return okJson({ query, symbols, total: symbols.length });
      } catch (e) {
        return errFromException(
          e,
          'Ensure dart is installed and workspaceRoot contains a valid pubspec.yaml.',
        );
      }
    },
  });

  // dart_go_to_definition
  defineTool<{ filePath: string; line: number; column: number }>(server, {
    name: 'dart_go_to_definition',
    description:
      'Find where a symbol is defined in a Dart/Flutter codebase. ' +
      'Returns file URI and range for each definition location.',
    inputSchema: filePositionSchema,
    watchdog: { name: 'dart_go_to_definition', ceilingMs: 20_000, toolClass: 'quick' },
    handler: async ({ filePath, line, column }, _ctx) => {
      try {
        if (!existsSync(filePath)) {
          return err(`File not found: ${filePath}`);
        }
        const srv = getServer();
        const workspaceRoot = resolveWorkspaceRoot(filePath);
        await srv.ensureRunning(workspaceRoot);
        const raw = await srv.definition(filePath, line - 1, column - 1);
        const locations = formatDefinition(raw);
        return okJson({
          filePath,
          line,
          column,
          definitions: locations,
        });
      } catch (e) {
        return errFromException(
          e,
          'Ensure dart is installed and the file is part of a valid Dart/Flutter project.',
        );
      }
    },
  });
}

// ─── Workspace root resolution ────────────────────────────────────────────────

import { dirname, join } from 'node:path';

/**
 * Walk up from filePath to find the nearest directory containing pubspec.yaml.
 * Falls back to the file's own directory if no pubspec is found.
 */
function resolveWorkspaceRoot(filePath: string): string {
  let dir = dirname(filePath);
   
  while (true) {
    if (existsSync(join(dir, 'pubspec.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return dirname(filePath);
}
