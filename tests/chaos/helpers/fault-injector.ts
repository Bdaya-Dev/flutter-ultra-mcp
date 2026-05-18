// Fault injection utilities for chaos tests.
// Provides deterministic fault patterns rather than random failures,
// so tests are reproducible.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function corruptJsonFile(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '{invalid json <<<CORRUPT>>>', 'utf8');
}

export async function writeValidJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

export async function writeTruncatedJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const full = JSON.stringify(data, null, 2);
  await writeFile(path, full.slice(0, Math.floor(full.length / 2)), 'utf8');
}

export function corruptJsonRpcFrame(validFrame: string): string {
  return validFrame.slice(0, Math.floor(validFrame.length / 2)) + '<<<CORRUPT>>>';
}

export function makeJsonRpcRequest(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

export function makeJsonRpcResponse(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

export function makeJsonRpcError(id: number, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

export class DeterministicFaultPattern {
  private callCount = 0;
  constructor(private pattern: ('pass' | 'fail' | 'delay' | 'drop')[]) {}

  next(): 'pass' | 'fail' | 'delay' | 'drop' {
    const action = this.pattern[this.callCount % this.pattern.length]!;
    this.callCount++;
    return action;
  }

  reset(): void {
    this.callCount = 0;
  }
}
