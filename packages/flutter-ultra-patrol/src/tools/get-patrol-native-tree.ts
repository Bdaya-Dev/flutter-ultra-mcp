import { request } from 'node:http';
import { z } from 'zod';
import { defineTool } from './types.js';

interface NativeNode {
  [key: string]: unknown;
  children?: NativeNode[];
}

const KEEP_FIELDS = new Set([
  'identifier',
  'label',
  'title',
  'value',
  'placeholderValue',
  'resourceName',
  'text',
  'contentDescription',
  'className',
  'elementType',
  'children',
]);

const IDENTITY_FIELDS = [
  'identifier',
  'label',
  'title',
  'value',
  'text',
  'contentDescription',
  'resourceName',
] as const;

function trimNode(node: NativeNode): NativeNode {
  const out: NativeNode = {};
  for (const key of Object.keys(node)) {
    if (!KEEP_FIELDS.has(key)) continue;
    if (key === 'children') continue;
    const v = node[key];
    if (v === null || v === undefined || v === '') continue;
    out[key] = v;
  }
  const rawChildren = node.children;
  if (Array.isArray(rawChildren) && rawChildren.length > 0) {
    const trimmed = flattenChildren(rawChildren);
    if (trimmed.length > 0) out.children = trimmed;
  }
  return out;
}

function flattenChildren(nodes: NativeNode[]): NativeNode[] {
  const result: NativeNode[] = [];
  for (const raw of nodes) {
    const trimmed = trimNode(raw);
    if (shouldFlatten(trimmed)) {
      if (Array.isArray(trimmed.children)) {
        result.push(...trimmed.children);
      }
    } else {
      result.push(trimmed);
    }
  }
  return result;
}

function shouldFlatten(node: NativeNode): boolean {
  if (node.elementType !== 'other') return false;
  return IDENTITY_FIELDS.every((f) => node[f] === undefined);
}

function postJson(port: number, body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/getNativeViews',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 512)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Failed to parse response JSON: ${(err as Error).message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

export const getPatrolNativeTreeTool = defineTool({
  name: 'get_patrol_native_tree',
  description:
    "Fetch the native platform UI hierarchy via Patrol's test server /getNativeViews endpoint during an active develop session. Optionally compacts the tree by stripping non-essential fields and flattening anonymous wrapper nodes.",
  inputSchema: z.object({
    testServerPort: z
      .number()
      .int()
      .default(8081)
      .describe('Port of the Patrol test server (default 8081).'),
    compact: z
      .boolean()
      .default(true)
      .describe('Strip non-essential fields and flatten anonymous wrapper nodes.'),
  }),
  async handler(input, ctx) {
    const session = ctx.develop.get();
    if (!session) return { ok: false, reason: 'no_develop_session' };

    let raw: unknown;
    try {
      raw = await postJson(input.testServerPort, {
        selector: null,
        iosInstalledApps: [],
        appId: '',
      });
    } catch (err) {
      return {
        ok: false,
        reason: 'test_server_unreachable',
        message: (err as Error).message,
        port: input.testServerPort,
      };
    }

    const tree = input.compact ? compactTree(raw) : raw;

    if (isEmptyTree(tree)) {
      return { ok: false, reason: 'empty_tree', taskId: session.id };
    }

    return { ok: true, taskId: session.id, tree };
  },
});

function isEmptyTree(tree: unknown): boolean {
  if (tree == null) return true;
  if (Array.isArray(tree)) return tree.length === 0;
  if (typeof tree === 'object') {
    const obj = tree as Record<string, unknown>;
    if (Array.isArray(obj.roots)) return obj.roots.length === 0;
  }
  return false;
}

function compactTree(raw: unknown): unknown {
  if (Array.isArray(raw)) return flattenChildren(raw as NativeNode[]);
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.roots)) {
      return { ...obj, roots: flattenChildren(obj.roots as NativeNode[]) };
    }
    return trimNode(raw as NativeNode);
  }
  return raw;
}
